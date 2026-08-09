---
title: "13. Parallel children: runSteps()"
eyebrow: BasicFlow tutorial
lede: runSteps() executes independent registered children concurrently and returns their results in order. Independence is your responsibility, and memory namespaces are where it usually breaks.
source: picoflow-demo/src/myflow/basic-flow/incontext-step.ts, picoflow-demo/src/myflow/basic-flow/concur-step1.ts, picoflow-demo/src/myflow/basic-flow/concur-step2.ts
---

`runStep()` calls one child. `runSteps()` calls several at once with `Promise.all`.
The API difference is trivial; the correctness requirements are not. BasicFlow builds a
two-level nested tree specifically so you can see both the mechanism and the hazards.

## The goal

- Fan out to independent children and collect ordered results.
- Nest from `onEnter()` versus from `onResponse()`, and why the choice matters.
- Understand the duplicate-class restriction.
- Recognise the memory-namespace hazard before it bites.

## Fan-out from onEnter()

From `picoflow-demo/src/myflow/basic-flow/incontext-step.ts`:

```ts
protected async onEnter() {
  await super.onEnter();
  const msg = this.getTransientState<string>("msg");
  console.log("InContextStep.transient msg=", msg);
  const [concurStep1, concurStep2] = await this.runSteps([
    {
      step: ConcurStep1,
      userMessage: "Run the 1st concurrent follow-up task.",
    },
    {
      step: ConcurStep2,
      userMessage: "Run the 2nd concurrent follow-up task.",
    },
  ]);
  this.saveState({
    concurStep1: JSON.parse(JSON.stringify(concurStep1)) as JsonValue,
    concurStep2: JSON.parse(JSON.stringify(concurStep2)) as JsonValue,
  });
}
```

`runSteps` takes an array of `{ step, userMessage }` requests and returns
`Promise<(MessageContent | null)[]>` in the same order, which is why array
destructuring works. Each request gets its own execution frame:

```ts
private async executeParallel(
  stepRequests: RunStepRequest[],
): Promise<(MessageContent | null)[]> {
  const uniqueSteps = new Set(stepRequests.map(({ step }) => step.id));
  if (uniqueSteps.size !== stepRequests.length) {
    throw new Error("runSteps() cannot execute the same step class twice.");
  }
  return await Promise.all(
    stepRequests.map(({ step, userMessage }) =>
      this.executeChild(step, userMessage),
    ),
  );
}
```

Each child goes through the same `executeChild` path as `runStep()` — nested sequence
level, execution scope, `onEnter`, `run`, `onExit` in a `finally`. The only difference
is that the promises are joined rather than awaited one at a time.

### The duplicate restriction

`runSteps()` rejects the same class twice in one call. It is not an arbitrary
limitation: a `Step` instance is a singleton within the flow, holding one `state`
object and one memory namespace. Two concurrent invocations of the same instance would
interleave writes to both. If you need the same logic on two inputs, either call it
twice sequentially, or use batch mode ([lesson 17](/docs/tutorials/basic-flow/sessions-and-batch/))
which gives each item its own session.

## Two places to nest from

BasicFlow deliberately nests from a different hook in each branch.

`ConcurStep2` nests from `onEnter()` — before its own model call:

```ts
protected async onEnter() {
  await super.onEnter();
  const [_concurStep3] = await this.runSteps([
    {
      step: ConcurStep4,
      userMessage: "Run the ConcurStep3.",
    },
  ]);
}
```

`ConcurStep1` nests from `onResponse()` — after it:

```ts
public async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  this.saveState({ concurStep1: llmResult as JsonValue });
  const [_concurStep3] = await this.runSteps([
    {
      step: ConcurStep3,
      userMessage: "Run the ConcurStep3.",
    },
  ]);

  return llmResult as string;
}
```

The distinction is about data flow:

| Hook | Runs | Use when |
| --- | --- | --- |
| `onEnter()` | before `getPrompt()` and the model call | the child produces input the parent's prompt needs |
| `onResponse()` | after the model replied, before the result is returned | the child's work depends on what the model said |

`ConcurStep2` discards its child's result into `_concurStep3` and never uses it, so
`onEnter` versus `onResponse` makes no observable difference there; both are present to
show the two shapes. In real code, the choice is forced: prerequisite lookups go in
`onEnter`, follow-up work goes in `onResponse`.

<div class="callout callout--note"><span class="callout__title">Note</span><p>The variable in <code>ConcurStep2</code> is named <code>_concurStep3</code> but the step it runs is <code>ConcurStep4</code>, and its <code>userMessage</code> also says &ldquo;Run the ConcurStep3&rdquo;. That is a copy-paste slip in the demo, not a behaviour: the class in the <code>step</code> field is what executes.</p></div>

## The resulting tree

One `runStep(InContextStep)` from `NameStep`'s tool handler produces five nested model
calls:

```text
NameStep.user_name                        (top level, cursor = NameStep)
  runStep(InContextStep)                                       depth 2
    InContextStep.onEnter
      runSteps([ConcurStep1, ConcurStep2])       -- Promise.all, depth 3
        ConcurStep1: model call
          onResponse -> runSteps([ConcurStep3])               depth 4
        ConcurStep2: onEnter -> runSteps([ConcurStep4])       depth 4
                     then its own model call
    InContextStep: getPrompt + structured model call
  go(DOBStep)                             (cursor moves, once, here)
```

`ConcurStep1` and `ConcurStep2` are genuinely concurrent. `ConcurStep3` and
`ConcurStep4` are concurrent with each other as a side effect of their parents being
concurrent. All five children write their own state; none of them moves the cursor.

## Independence requirements

`Promise.all` gives no ordering guarantees between branches, so children must not
depend on each other's effects. Concretely:

**No shared step state.** Two children calling `flow.saveStepState(SameStep, ...)`
race. Each child writing only to its own slot, as all four `ConcurStep`s do, is safe.

**No transition attempts.** Every child is inside an execution scope, so `goto()`
throws. This is enforced, not merely advised.

**No ordering assumptions.** If B needs A's output, they are not independent. Call them
in sequence with two `runStep()` calls.

**No shared memory namespace.** This is the one that is not enforced.

## The memory-namespace hazard

Each of `ConcurStep1` through `ConcurStep4` is registered with no `.useMemory(...)`:

```ts
new ConcurStep1(this),
new ConcurStep2(this),
new ConcurStep3(this),
new ConcurStep4(this),
```

so each falls back to `this.memorySpace = this.id` — its own class name. Four separate
histories, no interleaving. That is why the fan-out is safe here.

Now consider what would happen if two of them shared `.useMemory("default")`. A
step's memory is a plain array fetched from the flow:

```ts
public getMemory(): MessageTypes[] {
  const history = this.flow.getMemory(this.memorySpace);
  // ...
}
```

and the runner mutates it in place — it overwrites `history[0]` with the system
message, pushes the user message, pushes tool-call and tool-result messages, and pushes
the AI reply:

```ts
const systemMessage = new SystemMessage({
  content: (await step.getPrompt()) ?? "",
  id: step.genMessageId(),
});
history[0] = systemMessage;
```

Two concurrent children sharing that array would each overwrite slot 0 with their own
system prompt and interleave their turns into one transcript. The second child's model
call could see the first child's half-finished exchange. Nothing throws; you get a
corrupted history and non-deterministic replies.

<div class="callout callout--danger"><span class="callout__title">Danger</span><p>Never put two steps that share a memory namespace in the same <code>runSteps()</code> call. Nothing in the framework prevents it, the failure is intermittent, and the damage is written to the persisted document. If children must share context, run them sequentially.</p></div>

The parent's namespace is the same hazard one level up. `InContextStep` is registered
with `.useMemory("separate")`, so its transcript — and, through the tree, its
children's — stays out of the `default` namespace that `NameStep`, `DOBStep`, and
`AddressStep` share. Without that, five machine-generated exchanges about sci-fi movie
ideas would be in the conversation history of the step that is about to ask for a date
of birth.

## Why it is written this way

`runSteps()` is deliberately thin — a duplicate check and a `Promise.all` — and pushes
the correctness burden onto the caller. That is the right split, because independence
is a property of your domain that the framework cannot infer. What it *can* enforce, it
does: duplicate classes throw immediately, and `goto()` from a child throws with an
explanatory message.

Results are returned positionally rather than as a map because the caller already knows
the order it asked for, and destructuring reads better than key lookups.

The two-level nesting in BasicFlow exists to prove the frames compose. Execution scope
is an `AsyncLocalStorage` stack, so a child's child pushes another frame and
`getExecutingStep()` always returns the innermost. The sequence trail records the depth,
which is what makes a nested failure diagnosable after the fact.

## Common mistakes

- **Fanning out steps that share a memory namespace.** Silent history corruption. This
  is the failure mode to watch for.
- **Passing the same class twice.** Throws
  `runSteps() cannot execute the same step class twice.`
- **Assuming ordering.** Results are ordered; execution is not. If B reads what A
  wrote, sequence them.
- **Nesting from the wrong hook.** A prerequisite fetched in `onResponse()` is too
  late for `getPrompt()`, which already ran.
- **Ignoring child results and asserting only on the parent's reply.** A fluent outer
  response can hide a failed branch. Assert on each child's persisted state, as the
  end-to-end test does.

## Next

`InContextStep` read a value with `getTransientState`.
[14. Transient state and context](/docs/tutorials/basic-flow/transient-state/) explains where
that came from and what survives persistence.
