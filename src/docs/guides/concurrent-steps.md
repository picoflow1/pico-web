---
title: Concurrent batch mode
eyebrow: Guides
lede: One coordinator session fans work out to N worker sessions over self-HTTP. Each worker gets its own session document, and the coordinator owns completion, retry and partial-failure policy itself.
source: picoflow/src/picoflow/flow/flow.ts, picoflow/src/picoflow/flow/step.ts, pico-demo/docs/picoflow-workflow-developer-guide.md
---

Use batch mode when you have N independent work items and each deserves its own session
document — its own history, token accounting, run status and error log. Extracting fifty
invoices, scoring a queue of documents, running the same interview against a list of subjects.

<div class="callout callout--note">
  <span class="callout__title">Choose your concurrency API</span>
  <p>Use <code>runStep()</code> for one nested child, <code>runSteps()</code> for parallel children within the caller's session, and <code>concurrentSteps()</code> for independent flow requests with separate sessions. This guide covers <code>concurrentSteps()</code>. For isolated parallel workers, reducers, and join policies, start with <a href="/docs/guides/nested-execution/#runsteps-isolated-children-in-parallel">runSteps(): isolated children in parallel</a>.</p>
</div>

## Selecting the coordinator

Batch mode is chosen by the first request's config, not by a different flow class:

```json
{
  "flowName": "InvoiceFlow",
  "message": "start",
  "config": { "_concurrent": true }
}
```

`Flow.run()` reads that flag from flow context and takes the other branch:

```ts
const isConcurrent = this.getContext<boolean>("config._concurrent");
const resp = isConcurrent
  ? await this.spawnSteps()
  : await this.requireCurrentStep().run(message);
```

The same flow class is therefore both the coordinator and the worker. A worker is simply an
ordinary run of that flow, started with a config that does *not* contain `_concurrent`.

## spawnSteps()

Override `spawnSteps()` to describe the fan-out. Its return value becomes the coordinator's
response message.

```ts
protected async spawnSteps(): Promise<string> {
  const step = await this.goto(PresidentStep);
  const nths = ["10th", "11th", "12th", "13th", "14th", "15th", "16th"];

  await this.concurrentSteps<string>({
    items: nths,
    batchSize: 3,
    onConfig: (item) => ({ nth: item, isPresident: true }),
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

Note the last two lines. Logging and completion are explicit; nothing does them for you.

## concurrentSteps()

```ts
public async concurrentSteps<T>({
  items,
  batchSize,
  onConfig,
  onBotResponse,
}: {
  items: T[];
  batchSize: number;
  onConfig: (item: T) => object;
  onBotResponse: (item: T, response: any) => void;
}): Promise<void>
```

| Parameter | Meaning |
| --- | --- |
| `items` | The work list. Each element becomes one worker session |
| `batchSize` | How many items run concurrently. Batches run **sequentially**; items within a batch run with `Promise.all` |
| `onConfig(item)` | Builds the `config` object sent to that worker. This is the only input a worker receives |
| `onBotResponse(item, response)` | Called once per **successful** item with the HTTP client's response object |

Progress is written to the coordinator's session log:

```text
Processing batch 1/3 (batch size:3)
Batch 1 completed.
```

<div class="callout callout--warning"><span class="callout__title">onBotResponse receives the HTTP response, not the flow envelope</span><p>The callback argument is the client's response object, so the PicoFlow body is under <code>response.data</code>. <code>BasicFlow.spawnSteps()</code> reads <code>response["message"]</code> directly, which is <code>undefined</code> — it should be <code>response.data.message</code>. Verify the shape you actually receive before saving it.</p></div>

There is a second wrinkle. When a worker step sets a non-plain content type, the demo
controller sends the raw payload instead of the standard envelope. `InvoiceFlow` workers
return `HttpContentType.Json`, so `response.data` is the invoice JSON itself, not
`{ success, completed, message, session }`.

## SELF_URL and worker sessions

Each item becomes an HTTP POST built by `SelfClient`, whose base URL is `SELF_URL`:

```ts
const body = {
  flowName: this.id,
  config: { ...onConfig(item) },
};
await selfCaller.post("", body);
```

```bash
SELF_URL=http://localhost:8000/ai/run
```

Because the path is empty, `SELF_URL` must be the **complete run endpoint**, not the service
root. Three properties follow from this design:

1. **No session ID is sent.** Every worker creates a brand-new session document, bound to the
   same registered flow name and starting from that flow's initial step.
2. **Nothing is shared.** The coordinator's context, state and memory are invisible to a
   worker. Everything a worker needs must go through `onConfig`.
3. **It is a real HTTP request.** It crosses the load balancer, so in a multi-instance
   deployment the worker may run in a different process from the coordinator.

<div class="callout callout--danger"><span class="callout__title">Never return _concurrent from onConfig</span><p>A worker whose config contains <code>_concurrent: true</code> becomes another coordinator and spawns its own workers, recursively. Build the worker config explicitly; do not spread the coordinator's own context into it.</p></div>

## What the coordinator must own

`concurrentSteps()` provides batching and error logging. Everything else is yours.

| Concern | What the framework does | What you must add |
| --- | --- | --- |
| Completion | Nothing. The coordinator session stays `running` | `sessionCompleted()` on a step, or `flow.markCompleted()` |
| Failure | Catches per item, logs to the session `error` array and `console.error`, continues | Detect that fewer results arrived than items, and decide the outcome |
| Retry | None | Re-drive failed items, through an idempotent path |
| Partial success | No aggregation, no rollback | Record which items succeeded; decide whether partial is acceptable |
| Idempotency | None | Stable per-item keys, so a re-run does not duplicate side effects |
| Timeouts | The client is constructed with no timeout | Bound the work at the worker level, or in your HTTP stack |
| Concurrency limit | `batchSize` only | Size it against provider rate limits and your own connection pool |
| Result storage | Only what `onBotResponse` saves | Save enough to reconstruct which items are outstanding |

A failed item never reaches `onBotResponse`. If you only count callbacks, a batch where every
worker failed looks exactly like a batch that was never started.

`InvoiceFlow.spawnSteps()` illustrates the gap: it fans out correctly, but never marks the
coordinator session complete, so that session remains `running` forever.

## isBatch()

```ts
public isBatch(): boolean {
  return false;
}
```

Despite the name, this does **not** select `spawnSteps()`. Returning `true` makes the engine
call `saveSession()` once before `run()` begins, so a long-running coordinator has a persisted
document that its `SessionLogger` writes can land in. Only `config._concurrent` chooses the
batch dispatch path.

## Contrast with nested execution

| Question | `runStep()` | `runSteps()` | `concurrentSteps()` |
| --- | --- | --- | --- |
| Started by | Calling Step | Calling Step supplies a request array | Coordinator calls the helper, usually from `spawnSteps()` selected by `config._concurrent` |
| Session documents | Caller's session | One durable session; private worker snapshots | One new session per item |
| Transport | In-process child call | In-process fork/join | HTTP POST to `SELF_URL` |
| What runs | One registered child | A fresh worker instance for each Step request | The whole flow, from its initial Step |
| Input | Optional `userMessage`; prepared child state or transient state | Immutable `params`, optional `userMessage`, branch keys | `onConfig(item)` |
| State visibility | Registered child state is available to the caller | Selected worker state is published at the join | Separate child state; coordinator records HTTP results |
| Can move the cursor? | Child cannot move the durable parent cursor | Workers cannot move the durable parent cursor | Each worker controls its own session cursor |
| Ordinary failure | Throws to caller unless handled | Returns rejected branch results; default retains successful state | Caught and logged per item |
| Concurrency bound | One child per awaited call | `maxConcurrency` bounds each batch | `batchSize`; each chunk finishes before the next starts |
| Persistence | Normal session save boundaries | Outer save by default; optional `root-join` checkpoint | Each worker saves its own session |
| Tokens | Charged to caller's session | Charged to caller's session | Charged to each worker session |
| Result | Child output or `null` | `ParallelBatchResult`: `branches`, `fulfilled`, `rejected`, publication metadata | Helper returns no aggregate; `onBotResponse` handles each successful response |

The `runStep()` column describes a sequential call outside a parallel worker. Inside a
`runSteps()` worker, `runStep()` uses an isolated, atomic one-child barrier and propagates a
child failure to its caller.

Choose nested execution when child work belongs to the caller's decision within one session.
Choose batch mode when each item needs its own independently saved flow session.

### A small runSteps() example

Suppose a registered `InventoryLookupStep` reads a SKU from
`this.getParallelInvocation().params`. Its tool returns JSON through `directResult(...)`.
It returns each lookup as branch output, so repeated workers do not need to replace the same
Step state field. The calling Step can collect available results and failures:

```ts
const batch = await this.runSteps(
  [
    { step: InventoryLookupStep, key: "shirt", params: { sku: "SHIRT-01" } },
    { step: InventoryLookupStep, key: "hat", params: { sku: "HAT-02" } },
  ],
  { maxConcurrency: 2 },
);

this.saveState({
  inventoryChecks: {
    results: batch.fulfilled.map((branch) => ({
      key: branch.key,
      output: branch.output,
    })),
    failures: batch.rejected.map((branch) => ({
      key: branch.key,
      error: branch.error,
    })),
  },
});
```

Distinct keys are required when a Step class appears more than once. Results remain in
request order. This example records partial success; the caller must decide whether the
available inventory checks are sufficient for its next action.

The default `retain-successes` policy publishes successful worker state at the join.
`{ failurePolicy: "atomic" }` suppresses that batch's application-state publication if any
branch fails; it still returns branch outcomes. Invalid shared mutations, conflicting writes,
and other framework failures throw. Neither policy rolls back external side effects.

For nested calls, publication reaches the immediate caller's private scope first; canonical
session state changes only when the enclosing outer join accepts those updates. A join is
also distinct from a durable save: `checkpoint: "root-join"` requests a session save after a
root join applies state, but does not provide automatic per-child crash recovery.

Continue with [Nested execution](/docs/guides/nested-execution/) for state isolation, explicit
reducer contributions, nested joins, and cancellation; the [Step reference](/docs/reference/step/)
for API contracts; and [Parallelism and fan-out](/docs/resources/parallelism-and-fanout/) for
the contrast with LangGraph's scheduling and recovery boundaries.

## Failure modes

| Symptom | Cause |
| --- | --- |
| Coordinator session never completes | Nothing called `sessionCompleted()` or `markCompleted()` |
| `onBotResponse` saves `undefined` | The callback receives the HTTP response; read `response.data` |
| Worker returns `FlowClass 'X' not registered.` | `SELF_URL` points at a different deployment |
| `connect ECONNREFUSED` in the session error log | `SELF_URL` unset or wrong; it must be the full run endpoint |
| Runaway session creation | `onConfig` leaked `_concurrent: true` into the worker config |
| Provider rate-limit errors | `batchSize` too large for the account's limits |
| Batch appears to hang | No client timeout is configured; a stuck worker blocks its whole batch |
| Silent data loss | Items failed, were logged, and never reappeared because no retry exists |

Related: [Sessions, migration, batch mode](/docs/tutorials/basic-flow/sessions-and-batch/),
[Raw JSON and batch fan-out](/docs/tutorials/invoice-flow/json-and-batch/), and
[Error handling and completion](/docs/guides/error-handling/).
