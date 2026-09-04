---
title: "13. Parallel children and tools: runSteps()"
eyebrow: BasicFlow tutorial
lede: runSteps() fans out independent registered Steps through an isolated fork/join barrier. A parallel child may call tools and return typed JSON to its parent with directResult().
source: pico-demo/src/myflow/basic-flow/incontext-step.ts, pico-demo/src/myflow/basic-flow/concur-step1.ts, pico-demo/src/myflow/basic-flow/concur-step2.ts
---

`runStep()` calls one nested child. `runSteps()` calls independent children concurrently. The
caller's class-based syntax is unchanged: use the registered Step classes directly. The runtime
creates a fresh worker for every branch; there is no decorator, factory hook, or other parallel
registration to add to the child class.

## Fan-out from `onEnter()`

`InContextStep` starts two follow-up Steps at the same time:

```ts
protected override async onEnter() {
  await super.onEnter();

  const batch = await this.runSteps([
    { step: ConcurStep1, userMessage: "Run the 1st concurrent follow-up task." },
    { step: ConcurStep2, userMessage: "Run the 2nd concurrent follow-up task." },
  ]);

  if (batch.rejected.length > 0) {
    throw new Error(batch.rejected.map(({ error }) => error.message).join("; "));
  }

  this.saveState({
    concurStep1: batch.fulfilled[0]?.output ?? null,
    concurStep2: batch.fulfilled[1]?.output ?? null,
  });
}
```

The result is a `ParallelBatchResult`, not an array of message content. Its `branches`,
`fulfilled`, and `rejected` collections are in request order. The default policy,
`retain-successes`, preserves successful branches even if a sibling rejects. Pass
`{ failurePolicy: "atomic" }` when any rejected branch should prevent all state publication.

## What each branch can do

At the fork, each worker gets an immutable snapshot of the session document, context, and other
Step states, plus a mutable private copy of its own state and memory. A worker may call
`saveState()` or `removeState()` only for itself. It cannot update another Step, move the
cursor, complete the session, write the session document, alter shared Flow memory, or save the
session; those attempts raise `ParallelMutationError`.

Successful child state is merged into the caller's authoritative session document before
`runSteps()` resolves. The caller can therefore immediately inspect it with `getStepState()` or
`getSessionDoc()`. The normal outer turn persists it. Use `{ checkpoint: "root-join" }` only
when a root-level join must request an immediate durable save.

Raw child memory is deliberately not merged. It is private while the branch runs and discarded
at branch end. A child communicates through its returned output and its published Step state,
not by leaking an in-progress transcript into its siblings.

## Tools are allowed in parallel children

Parallel execution does **not** make a Step tool-free. A child may expose a normal Zod-backed
tool with `defineTool()` and handle it with `@Tool`, just as `NameStep` or `DOBStep` does. The
tool call is made by that child's model and the handler may validate input, call a service, and
save state owned by that child.

The difference is the tool's result: a parallel child cannot change the shared cursor. Use
`directResult(json)` to return a JSON value to the `runSteps()` caller. Do not return `go()`,
`stay()`, or `direct()` from that handler; those are routing or user-response builders and throw
inside a parallel child.

## A `directResult()` tool call from `ConcurStep1`

`ConcurStep1` first starts `ConcurStep3` as a nested child from `onEnter()`. Once that inner
barrier completes, its model makes one tool call; the handler saves child-owned state and
returns a JSON result directly to `InContextStep`:

```ts
protected override async onEnter() {
  await super.onEnter();
  this.saveState({ concurStep1: "Starting nested ConcurStep3." });
  const batch = await this.runSteps([
    { step: ConcurStep3, userMessage: "Run the ConcurStep3." },
  ]);
  if (batch.rejected.length > 0) {
    throw new Error(batch.rejected[0]!.error.message);
  }
}

public override getPrompt(): string {
  return `
    You are ConcurStep1.
    Immediately call 'complete_concurrent_step1' with no arguments.
    Do not return prose.
  `;
}

@Tool
protected async complete_concurrent_step1(): Promise<ToolResponseType> {
  const result = { completed: true };
  this.saveState({ concurStep1: result });
  return directResult(result);
}
```

The marker is part of `ConcurStep3`'s fork snapshot. The completion tool later replaces it with
`{ completed: true }`, which is the value published to the outer caller.

`directResult(result)` finishes only this branch. It does not move the durable cursor and it
does not make the usual follow-up model call. The caller receives the same object at
`batch.fulfilled[0].output`; `InContextStep` saves it as its own `concurStep1` state. This is
the child-only alternative to `direct()`, `go()`, and `stay()`, which are still invalid inside a
parallel branch because they attempt a cursor transition.

Every `directResult(...)` call has four rules:

1. Return it from an `@Tool` or `@Tools` handler in an active `runSteps()` child.
2. Pass only JSON-compatible data: string, number, boolean, `null`, array, or object.
3. Save any child-owned state before returning it; the successful branch publishes that state at
   the join.
4. Return at most one `directResult(...)` for a single model tool turn.

The direct-result path is deliberately terminal for the child:

```text
ConcurStep1 model call
  -> complete_concurrent_step1 tool call
  -> handler saves ConcurStep1 state
  -> directResult({ completed: true })
  -> batch.fulfilled[0].output in InContextStep
```

There is no second model call, no `onResponse()` call for `ConcurStep1`, and no cursor change.

## Nested fan-out

BasicFlow also retains a nested fan-out example:

- `ConcurStep1` starts `ConcurStep3` from `onEnter()`, before its own model call.
- `ConcurStep2` starts `ConcurStep4` from `onEnter()`, before its own model call.

Use `onEnter()` for prerequisite work needed by the parent prompt. The nested call checks its
structured batch result before continuing.

If B changes its private state and then calls `B.runSteps([D, E])`, D and E both see B's
materialized pre-fork state. They do not see each other's in-flight changes. Successful D/E
state becomes visible to B at the inner join, and reaches the root session document only if B
itself succeeds at the outer join.

## Repeating one Step class

The same Step class may occur more than once in one batch. Give every repeated invocation a
non-empty, batch-unique key:

```ts
await this.runSteps([
  { step: QuoteStep, key: "basic", params: { plan: "basic" } },
  { step: QuoteStep, key: "premium", params: { plan: "premium" } },
]);
```

Each request receives a separate `QuoteStep` state copy. If two copies replace the same state
field, the barrier raises `ParallelStateConflictError`; the framework will not choose a winner
based on timing. When combining copies is intentional, declare a reducer channel and contribute
to it explicitly:

```ts
protected override parallelStateChannels() {
  return { quoteByPlan: StepChannels.keyedByBranch() };
}

public override async run() {
  const quote = await this.quote(this.getParallelInvocation().params);
  this.contributeState("quoteByPlan", quote);
  return quote;
}
```

Reducers run in request order, not completion order.

## The resulting tree

```text
NameStep.user_name                         (top level)
  runStep(InContextStep)
    InContextStep.onEnter
      runSteps([ConcurStep1, ConcurStep2])       (parallel barrier)
        ConcurStep1.onEnter -> runSteps([ConcurStep3])
                    then -> complete_concurrent_step1 -> directResult({ completed: true })
        ConcurStep2 -> onEnter    -> runSteps([ConcurStep4])
    InContextStep model call
  go(DOBStep)                               (the owner moves the cursor)
```

`ConcurStep1` and `ConcurStep2` run concurrently. Their nested branches can overlap, but no
branch may change the durable cursor. Only the owning top-level Step decides a transition.

## Common mistakes

- **Treating the result as an array.** Inspect `batch.rejected` and use `batch.fulfilled` or
  `batch.branches`.
- **Depending on a sibling's write.** Siblings see snapshots, not each other's live work.
  Sequence dependent work with `runStep()`.
- **Writing another Step's state.** Publish only the worker's own state; use a reducer for
  deliberate fan-in from repeated copies.
- **Returning `go()`, `stay()`, or `direct()` from a parallel tool.** Tools are allowed; only
  their routing-style results are not. Use `directResult(json)` when the parent needs a branch
  result.
- **Using raw memory as the result channel.** Branch histories are private and discarded.
- **Assuming a successful branch is immediately durable.** It is immediately visible to the
  caller, then persists with the outer turn unless a root-join checkpoint is requested.

## Next

`InContextStep` reads a value with `getTransientState()`.
[14. Transient state and context](/docs/tutorials/basic-flow/transient-state/) explains where
that came from and what survives persistence.
