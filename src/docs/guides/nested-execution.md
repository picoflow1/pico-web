---
title: "Nested execution: runStep / runSteps"
eyebrow: Guides
lede: Run a registered step as a child of the current one, inside the same session and the same HTTP turn. Children compute; they do not decide where the flow goes next.
source: picoflow-demo/docs/step-authoring-contract.md
---

Use nested execution when one turn needs sub-work whose result belongs to the calling step: a
classification, an enrichment, a second model with a different prompt or a different model
override. The child runs in-process, shares the session document, and returns its content to
its owner.

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

## runSteps(): independent children in parallel

```ts
protected async onEnter() {
  await super.onEnter();
  const [concurStep1, concurStep2] = await this.runSteps([
    { step: ConcurStep1, userMessage: "Run the 1st concurrent follow-up task." },
    { step: ConcurStep2, userMessage: "Run the 2nd concurrent follow-up task." },
  ]);
  this.saveState({
    concurStep1: JSON.parse(JSON.stringify(concurStep1)) as JsonValue,
    concurStep2: JSON.parse(JSON.stringify(concurStep2)) as JsonValue,
  });
}
```

Each request creates its own execution frame; the results are joined with `Promise.all` and
returned in the order given.

### Independence requirements

`runSteps()` gives you no ordering, no isolation and no rollback. Every child must be safe to
run at the same time as every other child in the array:

- no child may read state that another child in the same call writes;
- no two children may write the same step's state, or the same key;
- no two children should share a memory namespace;
- side effects must be independent — one child failing rejects the whole `Promise.all` while
  the others keep running to completion;
- children must not depend on each other's output. If they do, chain `runStep()` calls
  instead.

### Duplicate classes are rejected

```ts
throw new Error("runSteps() cannot execute the same step class twice.");
```

The check is on the class ID, before anything runs. There is no way to run one step class
twice in parallel — a step is a singleton within a flow instance, with one state object and
one memory namespace, so two concurrent instances would corrupt each other. If you need
fan-out over N items, that is batch mode.

## Memory namespace hazards

This is the failure that is hardest to see in a transcript.

A step's memory namespace is a shared array in the flow's memory container. On every model
call the runner **overwrites index 0** with the freshly built system message and then pushes
request and response messages onto the end.

Two children sharing a namespace, running under `Promise.all`, will:

- overwrite each other's system prompt, so one child may run against the other's prompt;
- interleave their human, AI and tool messages in one transcript;
- produce a persisted history that neither child would produce alone.

```ts
// Safe: distinct namespaces
new ConcurStep1(this),                      // default namespace: "ConcurStep1"
new ConcurStep2(this),                      // default namespace: "ConcurStep2"

// Dangerous: one shared transcript, written concurrently
new ConcurStep1(this).useMemory("shared"),
new ConcurStep2(this).useMemory("shared"),
```

The default namespace is the step's class name, so parallel children are safe unless you
opt into sharing. Do not opt in for `runSteps()` children.

## Passing data in and out

| Direction | Mechanism |
| --- | --- |
| Owner to child, this request only | `flow.saveTransientStepState(ChildClass, json)`, read with `getTransientState()` |
| Owner to child, durable | `flow.saveStepState(ChildClass, json)`, read with `getState()` |
| Owner to child, as a message | The `userMessage` argument |
| Child to owner | The returned `MessageContent`, or state the owner reads with `flow.getStepState(ChildClass, key)` |

Transient state is the right default for handing a child its inputs: it is visible for the
rest of the invocation and is stripped before the session document is written.

<div class="callout callout--note"><span class="callout__title">Children do not get a crossing message</span><p>Nested execution calls the child directly, so it is not treated as a top-level cross-step transition. Pass an explicit <code>userMessage</code>, or prepare the child in its <code>onEnter()</code>. Do not rely on <code>onCrossing()</code> to synthesise a starting message.</p></div>

## Nesting depth

Children may themselves nest — `ConcurStep1.onResponse()` calls `runSteps([{ step: ConcurStep3 }])`.
Each level increments the recorded sequence level and pushes another frame. There is no depth
limit in the framework, so the limits are yours: latency, token spend, and the fact that every
level runs inside one HTTP request.

## Failure modes

| Symptom | Cause |
| --- | --- |
| `Cannot goto 'X' from a child execution frame.` | The child used a tool handler, `stay()`, `direct()`, or returned a Step class from `onResponse()` |
| `Step 'X' is not defined in flow 'Y'.` | The child class is missing from `defineSteps()` |
| `runSteps() cannot execute the same step class twice.` | Duplicate class in the request array |
| Child state missing after the request | The child saved state but the parent's turn threw before persistence |
| Garbled or duplicated transcript | Parallel children sharing a memory namespace |
| One child's failure loses all results | `Promise.all` rejects on the first failure; catch inside the child's own logic if partial results matter |
| Request latency is a multiple of expectation | Deeply nested `runStep()` chains are sequential model calls |

Related: [Nested execution: runStep()](/docs/tutorials/basic-flow/nested-runstep/),
[Parallel children: runSteps()](/docs/tutorials/basic-flow/parallel-runsteps/), and
[Concurrent batch mode](/docs/guides/concurrent-steps/).
