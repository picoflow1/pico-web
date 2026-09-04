---
title: "Nested execution: runStep / runSteps"
eyebrow: Guides
lede: Run a registered step as a child of the current one, inside the same session and the same HTTP turn. Children compute; they do not decide where the flow goes next.
source: pico-demo/docs/step-authoring-contract.md
---

Use nested execution when one turn needs sub-work whose result belongs to the calling step: a
classification, an enrichment, a second model with a different prompt or a different model
override. The child runs in-process, belongs to the same session, and returns control to its
owner. A sequential `runStep()` uses the registered child directly; `runSteps()` gives each
parallel worker an isolated snapshot and publishes validated state at its join.

If the sub-work deserves its own session document, its own history and its own retry budget,
you want [Concurrent batch mode](/docs/guides/concurrent-steps/) instead.

## runStep(): one child

```ts
// inside a @Tool handler on NameStep
this.flow.saveTransientStepState(InContextStep, {
  msg: "transient variable passed from NameStep",
});

const answer = await this.runStep(InContextStep);

this.saveState({ inContext: JSON.parse(JSON.stringify(answer)) as JsonValue });
return go(DOBStep);
```

`runStep(StepClass, userMessage?)` returns `Promise<MessageContent | null>` — the child's
model content, not a step or a transition. The parent decides what to do with it.

The child must be registered in `defineSteps()`. Otherwise:

```text
Step 'InContextStep' is not defined in flow 'BasicFlow'.
```

## Execution frames versus the durable cursor

There is exactly one durable cursor, `flow.currentStep`, and nested execution never touches
it. Instead the runtime pushes an in-memory **execution frame**:

```text
runStep(Child)
  -> sequence level += 1
  -> push Child onto the execution stack
  -> Child.onEnter()
  -> Child.run(userMessage)
  -> Child.onExit()            (in a finally)
  -> pop the execution stack
  -> parent resumes; flow.currentStep never changed
```

That is why `Flow` has two families of accessors:

| Accessor | Returns |
| --- | --- |
| `getCurrentStep()` / `requireCurrentStep()` | The step named by the durable cursor |
| `getExecutingStep()` / `requireExecutingStep()` | The innermost step on the execution stack, falling back to the cursor |

Outside nested execution they return the same object. Inside a child they do not. The model
runner uses `requireExecutingStep()`, which is how the child's own prompt, tools, memory
namespace and model override are applied.

The child's activation is recorded in the session `sequence` at `level: 2`, so a nested run
is visible in the persisted execution trace without being confused with a real transition.

## Children cannot route or persist

`Flow.gotoByName()` refuses to run inside an execution frame:

```text
Cannot goto 'SomeStep' from a child execution frame.
Return a result to the owning step instead.
```

<div class="callout callout--danger"><span class="callout__title">A nested child must not use tools</span><p>Every tool-handler result is applied through <code>gotoByName()</code> — including <code>stay()</code>, which routes to the current step, and <code>direct()</code>, which routes to the current step with a message. All three therefore throw inside a nested child. Design child steps with a prompt and <code>onResponse()</code> only, exactly as <code>InContextStep</code> and the <code>ConcurStep</code> classes do. The same applies to returning a <code>Step</code> class from a child's <code>onResponse()</code>.</p></div>

Children also do not persist the session. The cross-step save that the runner performs on a
real transition does not fire for a nested call, because the child is both the prior step and
the executing step. Everything a child saves with `saveState()` is written when the *parent's*
turn is persisted at the end of the request.

The division is deliberate:

- children **compute** — they may call models, read state and `saveState()`;
- owners **decide** — only the owner returns `go(...)` and moves the cursor.

## runSteps(): isolated children in parallel

`runSteps()` creates a fresh worker internally for every request. The caller keeps the same
class-based syntax used by sequential nesting—there is no decorator, factory hook, or
parallel-only registration:

```ts
export class ConcurStep1 extends Step {
  public override async run() {
    const { params } = this.getParallelInvocation<{ topic: string }>();
    this.saveState({ result: await this.lookup(params.topic) });
    return this.getState("result");
  }
}
```

The caller sends immutable per-invocation parameters and receives a structured batch:

```ts
const batch = await this.runSteps([
  { step: ConcurStep1, key: "plot", params: { topic: "plot" } },
  { step: ConcurStep2, key: "cast", params: { topic: "cast" } },
]);

if (batch.rejected.length > 0) {
  this.saveState({ warnings: batch.rejected });
}

const plot = this.flow.getStepState(ConcurStep1, "result");
```

`branches`, `fulfilled`, and `rejected` remain in request order. State from fulfilled
branches is reduced and published before the promise resolves, so the caller can immediately
read it from the authoritative session document.

### Snapshot and mutation boundary

At the fork, each worker receives:

- an immutable logical snapshot of the session document, context, and all other Step states;
- a mutable private copy of its own Step state;
- a private memory history cloned from the namespace visible to the caller; and
- frozen `params`, a stable branch key, request index, scope path, and cancellation signal.

The worker may use `saveState()` and `removeState()` only on itself. Attempts to modify a
session/context snapshot, another Step, the cursor, completion status, Flow memory, or storage
raise `ParallelMutationError`. This makes an accidental shared write a visible framework
failure instead of a timing-dependent race.

Child memory is intentionally disposable. Two workers may inherit the same namespace without
sharing an array: each changes its own clone, and neither raw transcript is appended to the
parent. Return an output or publish Step state when the parent needs information from a child.

### Repeating one Step class

One Step class may run more than once in a batch. Every repeated invocation needs a unique
key:

```ts
await this.runSteps([
  { step: QuoteStep, key: "basic", params: { plan: "basic" } },
  { step: QuoteStep, key: "premium", params: { plan: "premium" } },
]);
```

Each request gets a fresh `QuoteStep`. If both copies replace the same field with
`saveState()`, the barrier raises `ParallelStateConflictError`. Declare how that field merges
and contribute values explicitly:

```ts
protected override parallelStateChannels() {
  return {
    quoteByPlan: StepChannels.keyedByBranch(),
    total: StepChannels.sum(),
  };
}

public override async run() {
  const quote = await this.quote(this.getParallelInvocation().params);
  this.contributeState("quoteByPlan", quote);
  this.contributeState("total", quote.total);
  return quote;
}
```

Reducers receive updates in request order. Completion timing never decides persisted state.

### Failures and persistence

The default `retain-successes` policy returns every branch result and publishes successful
state even if a sibling throws. Use `{ failurePolicy: "atomic" }` when any rejected branch
should prevent all application-state publication.

Configuration, mutation, validation, conflict, reducer, and requested-checkpoint errors are
framework failures. They throw and publish none of that barrier's state. External side effects
cannot be rolled back, so make them idempotent using the branch key.

By default the join changes only in-memory authoritative state; the normal outer turn saves
it. `{ checkpoint: "root-join" }` requests one immediate session save after a root join.
Nested barriers publish into their parent scope and never checkpoint storage directly.

Cancellation is cooperative. The runtime stops queued work, forwards the signal to running
workers and model calls, waits the configured grace period, then closes an unresponsive
scope. Late state and memory cannot reach the parent.

## Passing data in and out

| Direction | Sequential `runStep()` | Parallel `runSteps()` |
| --- | --- | --- |
| Owner to child | state/transient state or `userMessage` | immutable `params` or `userMessage` |
| Child to owner | returned content or child state | branch output and published child state |
| Raw memory | normal namespace behavior | private clone, discarded at branch end |

Avoid preparing parallel inputs by mutating the canonical child immediately before the fork.
Put request-specific data in `params`; use the child's existing canonical state only as the
shared base snapshot.

<div class="callout callout--note"><span class="callout__title">Children do not get a crossing message</span><p>Nested execution calls the child directly, so it is not treated as a top-level cross-step transition. Pass an explicit <code>userMessage</code>, or prepare the child in its <code>onEnter()</code>. Do not rely on <code>onCrossing()</code> to synthesise a starting message.</p></div>

## Nested barriers

If B changes its private state and then calls `B.runSteps([D, E])`, D and E fork from B's
materialized view and both see B's pre-fork change. They do not see each other's in-flight
changes. Successful D/E state becomes visible to B at the inner join. It reaches canonical
session state only if B itself fulfills at the outer join.

`runStep()` inside a parallel worker uses the same mechanism as an atomic one-child barrier.
The defaults cap nesting depth at 8
and total invocations at 256; a Flow can override `configParallelExecution()`.

## Failure modes

| Symptom | Cause |
| --- | --- |
| `ParallelDuplicateKeyError` | Two immediate requests used the same branch key |
| `ParallelStateConflictError` | More than one branch replaced the same Step field |
| `ParallelMutationError` | A worker attempted to modify shared/canonical state or lifecycle |
| A rejected branch has no state | Failed invocation updates are deliberately discarded |
| A late branch is rejected | It did not honor cancellation before the grace deadline |
| Request latency is a multiple of expectation | Nested `runStep()` chains are sequential model calls |

Related: [Nested execution: runStep()](/docs/tutorials/basic-flow/nested-runstep/),
[Parallel children and tools: runSteps()](/docs/tutorials/basic-flow/parallel-runsteps/), and
[Concurrent batch mode](/docs/guides/concurrent-steps/).
