---
title: "12. Nested execution: runStep()"
eyebrow: BasicFlow tutorial
lede: runStep() executes a registered child step inline and hands its result back to the caller. The durable cursor never moves, so the parent keeps control of routing.
source: pico-demo/src/myflow/basic-flow/name-step.ts, pico-demo/src/myflow/basic-flow/incontext-step.ts
---

`go()` hands the conversation to another step. `runStep()` borrows one. The difference
is who owns the next user turn afterwards, and it is the single most important
distinction in PicoFlow's composition model.

## The goal

- Call a child step from inside a tool handler with `runStep()`.
- Use the child's return value in the parent.
- Understand why `flow.currentStep` does not move.
- Know what a child may and may not do.

## The call site

From `pico-demo/src/myflow/basic-flow/name-step.ts`:

```ts
@Tool
protected async user_name(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const name = typeof args?.name === "string" ? args.name.trim() : "";

  if (name.toLowerCase() === "john doe") {
    return stay("Cannot accept John Doe, please choose a different name.");
  } else {
    this.saveState({ name });
    const runData = this.flow.getContext<JsonObject>("myRunData");
    this.saveState(runData);

    this.flow.saveTransientStepState(InContextStep, {
      msg: "transient variable passed from NameStep",
    });
    const answer = await this.runStep(InContextStep);
    this.saveState({
      inContext: JSON.parse(JSON.stringify(answer)) as JsonValue,
    });
    return go(DOBStep);
  }
}
```

Read the last six lines as a function call with a preamble. `saveTransientStepState`
sets up an argument for the child ([lesson 14](/docs/tutorials/basic-flow/transient-state/)),
`runStep` invokes it, `answer` is the return value, and then `NameStep` — still in
charge — routes to `DOBStep`.

`runStep(StepClass, userMessage?)` returns `Promise<MessageContent | null>`, LangChain's
message-content type. The `JSON.parse(JSON.stringify(answer))` round-trip converts it
into something that satisfies `JsonValue` for `saveState`. It is blunt but honest: the
value came from outside the JSON type system and has to be normalised before it is
persisted.

## What happens inside

```ts
public async runStep(
  stepClass: StepClassType,
  userMessage?: string,
): Promise<MessageContent | null> {
  return await this.executeChild(stepClass, userMessage);
}

private async executeChild(
  stepClass: StepClassType,
  userMessage?: string,
): Promise<MessageContent | null> {
  return await this.flow.withNestedSequence(async () => {
    return await Step.withExecutionScope(this, async () => {
      const step = await this.flow.enterChild(stepClass);
      try {
        return await step.run(userMessage);
      } finally {
        await Step.exitExecutionFrame();
      }
    });
  });
}
```

Three mechanisms, all `AsyncLocalStorage`-based:

`withNestedSequence` bumps a level counter so the child's entry in the flow's
`sequence` audit trail is recorded at depth 2 rather than 1. The trail records that the
child ran without implying it was a top-level stage.

`withExecutionScope` pushes the parent onto an execution stack. From this point,
`flow.getExecutingStep()` returns the innermost frame rather than `getCurrentStep()`.
That is how the runner knows to invoke `InContextStep`'s prompt and schema while
`flow.currentStep` still says `NameStep`.

`enterChild` resolves the class through the step registry — throwing if it is not
registered — calls `pushExecutionFrame()`, which runs the child's `onEnter()`, and the
`finally` guarantees `onExit()` and the frame pop even if the child throws.

## The cursor does not move

This is the contract worth stating plainly.

```text
before:  flow.currentStep === "NameStep"
during:  flow.currentStep === "NameStep"   (executing frame: InContextStep)
after:   flow.currentStep === "NameStep"   -> then go(DOBStep) moves it
```

The scenario test asserts exactly this. The turn where the user sends `"John Wick"`
runs `user_name`, which runs `InContextStep`, which runs two more children — and the
persisted `currentStep` afterwards is `DOBStep`, never `InContextStep`.

The framework enforces it rather than trusting you:

```ts
public async gotoByName(stepName: string): Promise<Step> {
  if (Step.hasExecutionScope()) {
    throw new Error(
      `Cannot goto '${stepName}' from a child execution frame. Return a result to the owning step instead.`,
    );
  }
  // ...
}
```

A child that returns a `Step` from `onResponse()`, or calls `flow.goto()` directly,
throws. Transition authority belongs to the owner.

## runStep() versus go()

| | `go(Child)` | `runStep(Child)` |
| --- | --- | --- |
| Moves `flow.currentStep` | yes | no |
| Child handles the next user turn | yes | no |
| Returns a value to the caller | no | yes, the model content |
| Caller continues executing | no | yes, on the next line |
| Child may transition | yes | no — throws |
| Survives a process restart mid-way | yes, the cursor is persisted | no, the frame is in memory |
| Runs `onEnter` / `onExit` | yes | yes |
| Runs `onCrossing` | yes | not automatically |

The last two rows deserve care. A nested child gets `onEnter()` and `onExit()` but is
*not* entered through the top-level crossing path, so do not rely on `onCrossing()` to
synthesise its first message. Either pass `userMessage` explicitly, as
`InContextStep` does for its own children:

```ts
const [concurStep1, concurStep2] = await this.runSteps([
  { step: ConcurStep1, userMessage: "Run the 1st concurrent follow-up task." },
  { step: ConcurStep2, userMessage: "Run the 2nd concurrent follow-up task." },
]);
```

or do the setup in `onEnter()`. `NameStep` calls `runStep(InContextStep)` with no
message at all, which is viable because `InContextStep` also overrides `onCrossing` to
return a `HumanMessageEx(this, "Follow system prompt")` and its memory namespace is
isolated.

## What a child may do

Allowed:

- call the model, with its own prompt, tools, model override, and struct schema;
- `saveState()` into its own durable slot;
- run further nested children, which BasicFlow does two levels deep;
- return a value to its owner.

Not allowed:

- `flow.goto()` / `gotoByName()` — throws;
- returning a `Step` from `onResponse()` — reaches `goto`, throws;
- persisting the session independently — only the owner's request boundary saves.

State written by a child *is* persisted, because it lands in that step's slot and the
whole document is written at the end of the request. After the `"John Wick"` turn,
`InContextStep`, `ConcurStep1`, `ConcurStep2`, `ConcurStep3`, and `ConcurStep4` all have
non-empty state, none of them was ever the current step.

## Why it is written this way

The alternative — modelling a subroutine as a `go()` out and a `go()` back — costs you
three things. The cursor visits stages that are not really conversational stages, so a
resumed session can land in the middle of a subroutine. The parent's local variables
are gone by the time control returns, so anything it needed must be round-tripped
through state. And the return value has nowhere to live.

`runStep()` keeps the subroutine a subroutine: it has a call site, a return value, and
a stack frame, all in the same function. The trade is that it is not durable. If the
process dies during `runStep`, the whole turn is lost and the session resumes at
`NameStep` — the same as any other mid-turn failure. That is acceptable precisely
because nested work is scoped to one request; it is not acceptable for a stage that
waits on a user, which is why those must be `go()` targets.

## Common mistakes

- **Calling `goto()` from a child.** Throws with an explicit message. Return a value
  and let the owner route.
- **Expecting `onCrossing()` to seed a nested child.** Nested execution is a direct
  call, not a crossing. Pass `userMessage`, or set up in `onEnter()`.
- **Calling `runStep()` on an unregistered class.** `enterChild` resolves through
  `requireStep` and throws.
- **Assuming the child's memory is separate.** It uses its own configured namespace,
  which may be shared with the parent. `InContextStep` uses `"separate"` deliberately;
  a child sharing `default` would write its prompt and reply into the collection
  steps' history.
- **Forgetting the result is `MessageContent`, not JSON.** Normalise it before
  `saveState`, as `NameStep` does.

## Next

`InContextStep` runs two children at once.
[13. Parallel children: runSteps()](/docs/tutorials/basic-flow/parallel-runsteps/) covers the
fan-out and its hazards.
