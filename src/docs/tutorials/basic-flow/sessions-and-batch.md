---
title: 17. Sessions, migration, batch mode
eyebrow: BasicFlow tutorial
lede: Flow-level hooks decide where a new session starts, whether an old document may be restored, and whether this request is a conversation at all.
source: picoflow-demo/src/myflow/basic-flow/basic-flow.ts, picoflow-demo/src/myflow/basic-flow/president-step.ts
---

Everything so far has been about one conversation moving through steps. This lesson is
about the flow object around it: choosing the entry point at runtime, deciding what to
do with a session document from last month, and using the same flow as a batch worker.

## The goal

- Pick an entry point with `initialStep()`.
- Control restore and migration with `onRestoreSessionDoc()`.
- Run a fan-out of independent sessions with `spawnSteps()` and `concurrentSteps()`.
- Finish a session without a terminal step using `sessionCompleted()`.

## Conditional entry with initialStep()

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

The base implementation returns `null`, in which case the **first step returned from
`defineSteps()`** becomes the initial cursor. Override it only when the choice depends on
runtime context, which is exactly what BasicFlow needs: `config.isPresident` is supplied
by the caller on session creation.

`createFlowDoc()` resolves it and validates the result:

```ts
const configuredInitialStep = this.initialStep();
const firstStep = this.stepMap.values().next().value as Step | undefined;
const currentStep = configuredInitialStep?.id ?? firstStep?.getName() ?? null;
if (currentStep && !this.stepMap.has(currentStep)) {
  throw new Error(
    `Initial step '${currentStep}' is not defined in flow '${this.id}'.`,
  );
}
```

Note the ordering constraint: `initialStep()` reads context, and context is populated by
`flow.addContext(...)` before `bootstrap()` runs, so the read is safe. It runs only on
session **creation** — a restored session already has a `currentStep` in its document
and `initialStep()` is not consulted.

<div class="callout callout--note"><span class="callout__title">Choosing the entry point</span><p><code>Step</code> takes only the flow: <code>protected constructor(flow: Flow)</code>. The first entry in <code>defineSteps()</code> is the default entry point; override <code>initialStep()</code> when it depends on context.</p></div>

## The alternate entry point

`PresidentStep` is what `config.isPresident` selects:

```ts
export class PresidentStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public onCrossing(
    _langMessage: MessageTypes,
    _priorStep?: string,
  ): MessageTypes {
    const nth = this.getContext<string>("config.nth");
    this.sessionCompleted();
    return new HumanMessageEx(
      this,
      `Who is the ${nth} President of United State`,
    );
  }

  public getPrompt(): string {
    return `
      You are a U.S. Presidential historian";
    `;
  }

  public async onResponse(
    llmResult: string | object,
  ): Promise<LastResponseType> {
    this.saveState({ who: llmResult as JsonValue });
    return llmResult as string;
  }
}
```

It is a one-shot worker, not a conversation. `onCrossing` builds the entire question
from `config.nth` — no user input is involved — and calls `sessionCompleted()`
immediately:

```ts
public sessionCompleted() {
  const sd = this.flow.getSessionDoc();
  sd.runStatus = "completed";
}
```

`Flow.run()` reports `completed: step.isEnd()`, and the base `isEnd()` reads exactly that
status, so the response comes back with `completed: true` on the first and only turn.
This is the documented alternative to routing through `TerminateSessionStep`: use the
terminal step for user-facing conversations, and `sessionCompleted()` for workers and
coordinators that intentionally finish without a closing exchange.

## Restore policy

Every request for an existing session id passes through `onRestoreSessionDoc`. BasicFlow
overrides it and delegates:

```ts
protected async onRestoreSessionDoc(
  doc: SessionType,
): Promise<SessionType | null> {
  //you can call:
  //this.isSessionCurrent(doc)
  //this.isSessionExpired(doc)
  return super.onRestoreSessionDoc(doc);
}
```

The default policy it delegates to:

```ts
protected async onRestoreSessionDoc(
  sessionDoc: SessionType,
): Promise<SessionType | null> {
  if (this.isSessionExpired(sessionDoc)) {
    return null;
  }

  if (!this.isSessionCurrent(sessionDoc)) {
    // Do your migration here, or return null to create a new session.
    return null;
  }
  return sessionDoc;
}
```

and the two predicates:

```ts
protected isSessionCurrent(doc: SessionType): boolean {
  return doc.version === K.sessionDocVersion;
}

protected isSessionExpired(doc: SessionType): boolean {
  const savedAt = doc.saveOn.getTime();
  if (
    Number.isFinite(doc.expireAfter) &&
    Number.isFinite(savedAt) &&
    Date.now() - savedAt > doc.expireAfter * 1000
  ) {
    return true;
  }
  return false;
}
```

`expireAfter` is stamped into the document at creation from `SESSION_EXPIRATION`, default
600 seconds. `K.sessionDocVersion` is the framework's current schema version.

The contract in `bootstrap()`:

```ts
if (!isNewSession) {
  doc = await this.onRestoreSessionDoc(doc);
  if (!doc) {
    doc = await flowSession.create(this.createFlowDoc());
    isNewSession = true;
  } else {
    await flowSession.save(doc);
  }
}
```

Return the document to continue the session — it is persisted first, so a migration you
performed is durable before any step runs. Return `null` and a brand-new session
document is created; the caller keeps its old id in hand but is effectively starting
over.

Override this hook when you want to migrate in place rather than discard:

```ts
protected async onRestoreSessionDoc(
  doc: SessionType,
): Promise<SessionType | null> {
  if (this.isSessionExpired(doc)) return null;
  if (this.isSessionCurrent(doc)) return doc;

  if (doc.version === 1.4) {
    migrateStepStateFrom14(doc);
    doc.version = K.sessionDocVersion;
    return doc;
  }
  return null;
}
```

Keep the migration idempotent. The hook can run again on the next request if the write
fails.

The version comparison is worth a second look even so, because the mistake in it is easy
to repeat. `K.sessionDocVersion` is a **number**, currently `1.5`. Written as a decimal,
`1.5 < 1.14` is `false` — 1.5 is the larger number. If you read `1.14` as "version 1,
patch 14" the condition looks like it fires for anything older than 1.14; numerically it
fires for nothing at or above 1.14 in decimal terms, and `1.5` is above it. Use
`isSessionCurrent(doc)` for equality, or compare against explicit version constants, and
do not encode a two-part version in a float.

## Batch mode

`Flow.run()` has a branch before the conversational path:

```ts
public async run(message: string): Promise<RunResponseType> {
  const isConcurrent = this.getContext<boolean>("config._concurrent");
  let resp: MessageContent | null;
  if (isConcurrent) {
    resp = await this.spawnSteps();
  } else {
    const step = this.requireCurrentStep();
    resp = await step.run(message);
  }
  // ...
}
```

A request carrying `config._concurrent` never runs a step. It runs `spawnSteps()`, which
the base class defines as returning an empty string and BasicFlow overrides:

```ts
protected async spawnSteps(): Promise<string> {
  const step = await this.goto(PresidentStep);
  const nths = ["10th", "11th", "12th", "13th", "14th", "15th", "16th"];
  await this.concurrentSteps<string>({
    items: nths,
    batchSize: 3,
    onConfig: (item) => {
      return {
        nth: item,
        isPresident: true,
      };
    },
    onBotResponse(item, response) {
      step.saveState({ [item]: response["message"] });
    },
  });

  const msg = `Finished concurrent flow: ${this.id}`;
  new SessionLogger(this.getSessionDoc()).log(msg);
  step.sessionCompleted();
  return msg;
}
```

Seven presidents, three at a time.

### How concurrentSteps works

It is not in-process fan-out. It issues **HTTP requests back to your own service**:

```ts
public async concurrentSteps<T>({ items, batchSize, onConfig, onBotResponse }) {
  const selfCaller = new SelfClient();
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    new SessionLogger(this.getSessionDoc()).log(
      `Processing batch ${...} (batch size:${batch.length})`,
    );
    const promises = batch.map(async (item) => {
      const body = {
        flowName: this.id,
        config: { ...onConfig(item) },
      };
      try {
        const result = await selfCaller.post("", body);
        onBotResponse(item, result);
      } catch (error) {
        new SessionLogger(this.getSessionDoc()).error(
          `Error batch process flow: ${this.id}, error:${errorMessage(error)}`,
        );
      }
    });
    await Promise.all(promises);
    new SessionLogger(this.getSessionDoc()).log(`Batch ${...} completed.`);
  }
}
```

Each item becomes a separate POST with no `CHAT_SESSION_ID`, so each gets its **own new
session document** with its own context. That is why `onConfig` returns
`{ nth: item, isPresident: true }`: the child session reads `isPresident` in
`initialStep()`, starts at `PresidentStep`, and reads `nth` in `onCrossing()`.

Four consequences worth knowing.

`SelfClient` posts to `CoreConfig.selfURL`, read from the `SELF_URL` environment
variable. Batch mode does not work until that is set to your own `/ai/run` endpoint.

Batches are sequential; items within a batch are concurrent. `batchSize: 3` over seven
items is three, three, one — with a `Promise.all` join between each.

Failures are swallowed per item. A rejected request is logged to the coordinator's
session `error` array and the batch continues. `onBotResponse` is simply not called for
that item, so check for gaps rather than assuming success.

The coordinator is itself a session. It called `this.goto(PresidentStep)` first, which
gives it a current step, and it accumulates every child's reply into that step's state
via the closure:

```ts
onBotResponse(item, response) {
  step.saveState({ [item]: response["message"] });
}
```

Then `step.sessionCompleted()` marks the coordinator finished. Note `goto` is called at
top level here, not from a child frame — it would throw inside `runStep`.

## Why it is written this way

Batch mode goes over HTTP rather than looping in process for one reason: **isolation**.
Each item needs its own session document, its own memory, its own step state, and its own
error boundary. Re-entering the public endpoint gets all of that for free, including the
session lock and the persistence path, and it means a batch of 500 can be spread across
instances behind a load balancer rather than pinned to whichever process received the
coordinating request.

The cost is a configuration dependency (`SELF_URL`), real network overhead per item, and
the fact that your batch traffic is indistinguishable from user traffic at the edge. For
small fan-outs of expensive model work — which is the case this targets — that is a fair
trade.

Making `spawnSteps()` a flow method rather than a separate API keeps one registration,
one model configuration, and one set of steps for both modes. `PresidentStep` is a
normal registered step; nothing about it knows it is usually reached from a batch.

## Common mistakes

- **Overriding `initialStep()` to return an unregistered class.** Throws
  `Initial step 'X' is not defined in flow 'BasicFlow'.` at document creation.
- **Expecting `initialStep()` to run on a restored session.** It does not. The cursor
  comes from the document.
- **Writing a migration that is not idempotent.** `onRestoreSessionDoc` can run again if
  the subsequent save fails.
- **Encoding a two-part version in a float.** `1.14 < 1.5` numerically. Compare with
  `isSessionCurrent(doc)` or explicit constants.
- **Running batch mode without `SELF_URL`.** `SelfClient` has no base URL and every item
  fails, silently, into the coordinator's error log.
- **Calling `goto()` from a nested frame in `spawnSteps`.** The coordinator's `goto` is
  top level and legal; the same call inside `runStep` throws.

## Next

[18. Testing a flow end to end](/docs/tutorials/basic-flow/testing/) asserts that all of this
actually happens.
