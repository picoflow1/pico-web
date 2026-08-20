---
title: Choosing a workflow shape
eyebrow: Guides
lede: Four shapes cover almost every PicoFlow application. Picking the wrong one shows up late, as session churn or a coordinator that never completes, so decide before you write prompts.
source: pico-demo/docs/picoflow-workflow-developer-guide.md
---

Do this before writing any step. The shape determines whether the caller keeps a session ID,
whether the flow needs a terminal step, whether there is one session document or many, and
which APIs you will use. It is cheap now and expensive to change once prompts exist.

## Decision table

| Shape | Choose when | Demo flow | Key APIs |
| --- | --- | --- | --- |
| Conversational and resumable | The workflow needs several HTTP turns from a human | `BasicFlow`, `HotelFlow` | `go()`, `stay()`, `TerminateSessionStep`, `useMemory()`, `CHAT_SESSION_ID` |
| One-shot or document | One request carries everything the workflow needs | `InvoiceFlow` | `onCrossing()`, `direct()`, `HttpContentType`, `structOutputSchema()` |
| Batch coordinator | N independent work items, each deserving its own session | `BasicFlow.spawnSteps()`, `InvoiceFlow.spawnSteps()` | `config._concurrent`, `spawnSteps()`, `concurrentSteps()`, `SELF_URL` |
| Nested or parallel specialists | One turn needs sub-work whose result belongs to the caller | `BasicFlow` — `NameStep`, `InContextStep` | `runStep()`, `runSteps()`, transient state |

The shapes are not exclusive. `BasicFlow` is conversational, runs nested children inside a
tool handler, and can act as a batch coordinator when started with `_concurrent`.

## Conversational and resumable

The default. A human sends messages; the flow advances a durable cursor between named stages
and persists what it learns.

```ts
@Tool
protected async dob(args: Record<string, any>): Promise<ToolResponseType> {
  if (!isValidDate(args)) {
    return stay("That date is not valid. Ask for M/D/YYYY.");
  }
  this.saveState({ year: args.year, month: args.month, day: args.day });
  return go(AddressStep);
}
```

Design rules:

- one step per cohesive question or decision;
- `stay(...)` for incomplete or correctable input, `go(Next)` for accepted input;
- durable domain values live in the state of the step that owns them;
- memory namespaces isolate roles — share one deliberately, not accidentally;
- register `TerminateSessionStep` and route explicit exit requests to it;
- the caller reuses `CHAT_SESSION_ID` until the response reports `completed: true`.

`HotelFlow` adds the harder version of this shape: reversible stages. `PresentStep` can go
forward to `CompareStep` and `CompareStep` can return with `go(PresentStep)`, so both clear
their memory in `onEnter()` to avoid replaying a stale transcript.

## One-shot or document

One request contains the configuration or payload, the flow does its work, and the session
usually completes in that same invocation.

`InvoiceFlow` takes a file name from `config`, uploads it to the provider, extracts JSON, and
returns the raw object with a JSON content type:

```ts
@Tool
protected async capture_json(args: Record<string, any>): Promise<ToolResponseType> {
  this.saveState({ json: args?.json });
  this.flow.markCompleted();
  return direct(args?.json).withContentType(HttpContentType.Json);
}
```

Design rules:

- the worker step is the initial step; there is often no second stage;
- use `onCrossing()` to synthesise the opening message, since no human wrote one;
- use `direct(...)` when the answer is already computed and another model call adds nothing;
- set `HttpContentType.Json` when the caller wants the payload, not prose;
- a terminal step is optional — completion can come from `markCompleted()` or
  `sessionCompleted()`.

"One-shot" describes the HTTP contract, not the number of model calls. `InvoiceFlow` makes
several: request the file, attach it, extract, capture.

## Batch coordinator

N independent items, each of which should get its own session document, run history, token
accounting and failure record.

The coordinator is selected by the first request's config:

```json
{ "flowName": "InvoiceFlow", "config": { "_concurrent": true } }
```

`Flow.run()` sees `config._concurrent` and calls `spawnSteps()` instead of the current step:

```ts
protected async spawnSteps(): Promise<string> {
  const fileNames = ["data/Evergreen.png", "data/ACME.png"];

  await this.concurrentSteps<string>({
    items: fileNames,
    batchSize: 10,
    onConfig: (item) => ({ fileName: item }),
    onBotResponse(_item, response) {
      console.log(response);
    },
  });

  const msg = `Finished concurrent flow: ${this.id}`;
  new SessionLogger(this.getSessionDoc()).log(msg);
  return msg;
}
```

Each item becomes an HTTP POST back to `SELF_URL` with the same `flowName` and a fresh
config. The worker gets its **own** session document. Nothing is shared with the coordinator
except the flow class.

Choose this shape only when the items are genuinely independent and you are prepared to own
completion, retry and partial-failure policy yourself — see
[Concurrent batch mode](/docs/guides/concurrent-steps/).

## Nested or parallel specialists

One turn needs sub-work — a classification, an enrichment, a second opinion — whose result
belongs to the calling step rather than to the user.

```ts
// inside a @Tool handler on NameStep
this.flow.saveTransientStepState(InContextStep, {
  msg: "transient variable passed from NameStep",
});
const answer = await this.runStep(InContextStep);
this.saveState({ inContext: JSON.parse(JSON.stringify(answer)) as JsonValue });
return go(DOBStep);
```

For independent children, `runSteps()` runs them with `Promise.all` and preserves result
order:

```ts
const [first, second] = await this.runSteps([
  { step: ConcurStep1, userMessage: "Run the 1st concurrent follow-up task." },
  { step: ConcurStep2, userMessage: "Run the 2nd concurrent follow-up task." },
]);
```

Children run inside the same session document and the same HTTP request. They may call
`saveState()`, but they cannot move the durable cursor and cannot persist independently. The
owner decides where the flow goes next. Details in
[Nested execution](/docs/guides/nested-execution/).

## Nested execution versus batch mode

They are frequently confused. They share nothing.

| | `runStep()` / `runSteps()` | `concurrentSteps()` |
| --- | --- | --- |
| Session documents | One, shared with the parent | One new document per item |
| Transport | In-process function call | HTTP POST to `SELF_URL` |
| Registered steps | Child must be in `defineSteps()` | Worker runs the whole flow from its initial step |
| Can call `goto()` | No — throws | Yes, it is a normal top-level run |
| Result | `MessageContent` returned to the parent | Whatever `onBotResponse` extracts from the HTTP response |
| Failure | Propagates to the parent turn | Caught and logged per item by `concurrentSteps()` |
| Token accounting | Charged to the parent session | Charged to each worker session |

## Common wrong turns

<div class="callout callout--warning"><span class="callout__title">A coordinator that never finishes</span><p><code>concurrentSteps()</code> does not mark the outer session completed. Returning a string from <code>spawnSteps()</code> does not either. Call <code>sessionCompleted()</code> on a step, or <code>markCompleted()</code> on the flow, when the coordinator is genuinely done. <code>InvoiceFlow.spawnSteps()</code> is a live example of a coordinator that leaves its session running.</p></div>

<div class="callout callout--danger"><span class="callout__title">Infinite fan-out</span><p>Never return <code>_concurrent: true</code> from <code>onConfig</code>. Each worker would start another coordinator, which would spawn more workers.</p></div>

Other frequent mistakes:

- using nested execution when the child should own its own session — if the child needs its
  own history, retry behaviour or token budget, it wants batch mode;
- using batch mode for sub-work whose result the caller needs synchronously — you have added
  an HTTP hop, a second session document, and a serialisation boundary for nothing;
- building a conversational flow with no terminal step, so `completed` never turns true and
  clients loop forever;
- reusing one session ID across two different flows, which fails with
  `SESSION_FLOW_MISMATCH` rather than switching flows.

Next: [Authoring a step](/docs/guides/authoring-a-step/). For the shape-by-shape tutorials, see
[Choose a track](/docs/tutorials/).
