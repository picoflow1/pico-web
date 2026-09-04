---
title: Error handling and completion
eyebrow: Guides
lede: An unhandled error aborts the session permanently. This is what the engine does with a failure, how to end a workflow deliberately, and why throwing from a tool handler is rarely what you want.
source: pf/src/picoflow/services/flow-engine.ts
---

Two things share this page because they share a field: `runStatus`. A session is `running`,
`completed` or `aborted`, and only the first can be resumed. Understanding how each state is
reached is what stops a transient failure from destroying a conversation.

## What an unhandled error does

`FlowEngine` catches everything thrown during a run and converts it:

```ts
{
  success: false,
  completed: true,
  message: error.message,
  session: sessionId ?? "",
  contentType: HttpContentType.Plain,
}
```

Before returning that, it sets `runStatus = "aborted"` on the session, writes the message to
the document's `error` array with `SessionLogger`, and persists. If that persistence itself
fails, the returned message is extended with
`; failed to persist aborted session: <reason>`.

Two details catch people out:

<div class="callout callout--warning"><span class="callout__title">A failed run still reports completed: true</span><p>The failure envelope sets <code>completed: true</code> alongside <code>success: false</code>. Clients must branch on <code>success</code>, not on <code>completed</code>. Treating <code>completed</code> as "the workflow finished normally" will make an aborted session look like a successful one.</p></div>

<div class="callout callout--danger"><span class="callout__title">Aborted is terminal</span><p>An aborted session cannot be resumed. The next request carrying that session ID does not restore it — it silently creates a brand-new session with a new ID, exactly as it does for a completed one. A single thrown exception therefore discards the entire conversation.</p></div>

### The three errors handled differently

`SessionConflictError`, `SessionFlowMismatchError` and `SessionFlowInvariantError` are
returned as failures **without** marking the session aborted and without writing to it. The
winning document must remain untouched. See
[Concurrency and session conflicts](/docs/guides/concurrency/).

## Prefer stay() over throw

Because abortion is permanent, a thrown exception is the strongest possible reaction to a
problem. It is right for programmer errors and unrecoverable infrastructure failures. It is
wrong for anything the conversation could recover from.

```ts
// Recoverable: tell the model what to fix, keep the session alive
@Tool
protected async address(args: Record<string, any>): Promise<ToolResponseType> {
  const response = ValidateAddress(args?.address);
  if (!response) {
    return stay("Invalid address. Ask for street, city, two-letter state, and ZIP.");
  }
  this.saveState({ address: response });
  return go(TerminateSessionStep);
}
```

```ts
// Unrecoverable: the configured file cannot be read, so the run cannot continue
try {
  const result = await fileMgr.uploadFile(localPath);
  // ...
} catch (_error) {
  throw new Error(`read file ${fileName} failed`);
}
```

Rule of thumb: if a human could plausibly correct it in the next message, return `stay(...)`.
If they could not, throw — and accept that the session ends.

Transient downstream failures deserve a third treatment: retry inside the handler, then
degrade to `stay(...)` with an honest message. Do not let a 503 from a pricing API destroy a
twenty-turn booking conversation.

## Completing through TerminateSessionStep

For any user-facing workflow, complete through the terminal step:

```ts
@Tool
protected async terminate_session(): Promise<ToolResponseType> {
  return go(TerminateSessionStep).withPrompt(DemoPrompt.AbruptEnd);
}
```

`TerminateSessionStep` is bundled and does four things:

- `onEnter()` calls `flow.markCompleted()`, setting `runStatus = "completed"`;
- `isEnd()` returns `true`, so the response reports `completed: true`;
- `onCrossing()` inherits the prior step's content type and supplies its own closing message;
- `getPrompt()` returns `super.getPrompt() ?? AbruptEndPrompt`, so `withPrompt(...)` from the
  transition wins.

It also defines the `terminate_session` tool. Expose it on any step where the user should be
able to leave, with a `@Tool terminate_session` handler that routes to it.

It is included in the base `defineSteps()`, but the moment you override that method you own
the list — register it explicitly:

```ts
protected defineSteps(): Step[] {
  return [
    new CollectCustomerStep(this).useMemory("customer"),
    new TerminateSessionStep(this).useMemory("end"),
  ];
}
```

Give it its own memory namespace. Sharing one with a conversational step replays that
transcript into the closing turn.

## sessionCompleted() for workers and coordinators

A step can mark completion directly, without a terminal conversation turn:

```ts
step.sessionCompleted();       // on a Step
this.flow.markCompleted();     // on a Flow
```

Both set `runStatus = "completed"`. Use them where a closing message would be noise:

```ts
// A batch coordinator
protected async spawnSteps(): Promise<string> {
  const step = await this.goto(PresidentStep);
  await this.concurrentSteps({ /* ... */ });

  const msg = `Finished concurrent flow: ${this.id}`;
  new SessionLogger(this.getSessionDoc()).log(msg);
  step.sessionCompleted();
  return msg;
}
```

```ts
// A one-shot extraction that returns raw JSON
this.flow.markCompleted();
return direct(args?.json).withContentType(HttpContentType.Json);
```

`concurrentSteps()` does not mark the outer session completed. After all workers finish,
call `sessionCompleted()` on a step or `markCompleted()` on the flow before returning.
`InvoiceFlow.spawnSteps()` uses `markCompleted()` for its coordinator.

Note the interaction with the response envelope. `completed` is computed from
`requireCurrentStep().isEnd()`, and the default `isEnd()` reads `runStatus`. So calling
`sessionCompleted()` mid-turn makes the whole turn report `completed: true`.

## deleteSession()

Completion keeps the record; deletion destroys it.

```ts
const result = await flowEngine.deleteSession(sessionId);
// { success: true, session } | { success: false, message, session }
```

It takes the same per-session lock as a run and performs a revision-checked delete, so it
cannot race a local turn. Use it only when the stored record itself must not exist — a
retention policy or a privacy request — not as a way to end a conversation.

`endChat()` is a deprecated delegate to `deleteSession()`. Its name conflates the two ideas;
prefer the explicit call.

## Direct responses and content types

The response envelope carries the current step's content type, and the demo controller
branches on it:

```ts
if (result.session) {
  res.header(K.ChatSessionID, result.session);
}
if (!result.success) {
  res.status(HttpStatus.BAD_REQUEST);
}
if (result.contentType && result.contentType !== HttpContentType.Plain) {
  return res.type(result.contentType).send(result.message);
}
return res.send(result);
```

Consequences to design around:

- a non-plain content type sends the **raw message** instead of the envelope, so `success`,
  `completed` and `session` disappear from the body — the session ID remains in the header;
- error responses are always plain text, because the failure envelope sets
  `HttpContentType.Plain`, so a JSON client must handle a plain-text failure body;
- only set a content type the HTTP adapter and the caller both understand.

## Where to look when something fails

The session document is the log. `SessionLogger` writes structured entries into five arrays —
`log`, `error`, `warn`, `debug`, `verbose` — that persist with the session.

| Array | Written by |
| --- | --- |
| `error` | The engine's abort path; your own `SessionLogger` calls |
| `warn` | Missing tool handlers, hallucinated tools, model retry attempts, skipped memory compaction |
| `log` | Batch progress from `concurrentSteps()`; your own calls |

A model that "silently ignores" a tool almost always left `missing tool handler: x` or
`hallucinated tool: x` in `warn`.

## Failure modes

| Symptom | Cause |
| --- | --- |
| A conversation restarts after one bad turn | Something threw; the session was aborted and a new one was created |
| Client thinks a failure succeeded | It checked `completed` instead of `success` |
| `LLM call failed. Reason:length.` | Retries exhausted; often a truncated response — raise `maxTokens` |
| Sessions accumulate in `running` forever | A coordinator or worker never called `sessionCompleted()` |
| Terminal step replays an old transcript | It shares a memory namespace with a conversational step |
| `Flow 'X' has no current step.` | `flow.currentStep` is null — usually a migration that cleared it |
| Failure body is plain text where JSON was expected | The failure envelope always uses `HttpContentType.Plain` |
| No error detail anywhere | The abort save itself failed; check the appended `failed to persist aborted session` text |

Related: [Persistence and session stores](/docs/guides/persistence/),
[Concurrency and session conflicts](/docs/guides/concurrency/), and
[LogicStep and TerminateSessionStep](/docs/reference/logic-and-terminal-steps/).
