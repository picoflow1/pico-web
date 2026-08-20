---
title: 9. Deterministic LogicStep
eyebrow: BasicFlow tutorial
lede: Not every stage needs a model. A LogicStep runs application code, returns a transition, and the runner moves straight on to the next step in the same request.
source: pico-demo/src/myflow/basic-flow/foo-logic.ts, pico-demo/src/myflow/basic-flow/goo-logic.ts
---

Between collecting the weather and asking for favourites, BasicFlow passes through two
steps that make no model call at all. They exist to demonstrate the smallest possible
non-LLM stage, and to show where destination state lands.

## The goal

- Subclass `LogicStep` and implement `runLogic()`.
- Return a transition, with optional state for the destination.
- Understand that `withState` writes to the **target**, not to the logic step.
- Know when a deterministic stage is worth a step of its own.

## Both steps in full

`pico-demo/src/myflow/basic-flow/foo-logic.ts`:

```ts
export class FooLogicStep extends LogicStep {
  constructor(flow: Flow) {
    super(flow);
  }

  public async runLogic(): Promise<LogicResponseType> {
    return go(GooLogicStep).withState({ fooData: 'fooValue' });
  }
}
```

`pico-demo/src/myflow/basic-flow/goo-logic.ts`:

```ts
export class GooLogicStep extends LogicStep {
  constructor(flow: Flow) {
    super(flow);
  }

  public async runLogic(): Promise<LogicResponseType> {
    return go(FavoritesStep).withState({ gooData: 'gooValue' });
  }
}
```

No `getPrompt()`, no `defineTool()`, no `onResponse()`. `LogicStep` is a thin subclass
of `Step`:

```ts
export abstract class LogicStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public isLogic(): boolean {
    return true;
  }

  abstract runLogic(): Promise<LogicResponseType>;
}
```

`isLogic()` returning `true` is the entire signal. The runner checks it and dispatches
to `LogicRunner` instead of `LlmRunner`.

## Where the state lands

This is the part worth slowing down for. `FooLogicStep` returns

```ts
go(GooLogicStep).withState({ fooData: 'fooValue' })
```

and `fooData` is written to **`GooLogicStep`**, not to `FooLogicStep`. The runner
transitions first and applies the builder afterwards:

```ts
} else if ('step' in result) {
  let step: Step;
  if (typeof result.step === 'string') {
    step = await flow.gotoByName(result.step);
  } else {
    step = await flow.goto(result.step);
  }

  if (result.prompt) {
    step.saveState({ _prompt: result.prompt });
  }
  if (result.state) {
    step.saveState(result.state);
  }
  // ...
}
```

`step` in that block is the **destination**. So after this pair runs, the persisted
document holds:

```json
{ "name": "GooLogicStep", "state": { "fooData": "fooValue" } }
{ "name": "FavoritesStep", "state": { "gooData": "gooValue" } }
```

`FooLogicStep`'s own state stays empty. If a logic step needs to record something for
itself, it calls `this.saveState(...)` before returning, exactly like a tool handler.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Read <code>go(X).withState(s)</code> as &ldquo;activate X, and hand it <code>s</code>&rdquo;. It is an argument to the destination, not a record of what just happened.</p></div>

## LogicResponseType

```ts
export type LogicResponseType = StepResponseType | StepTarget;
```

which means `runLogic()` may return any of:

- a `Step` constructor — `return GooLogicStep;`
- a registered step-name string — `return "GooLogicStep";`
- a builder object — `return go(GooLogicStep).withState({ ... });`

`LogicRunner` branches on `typeof result === "string"`, `typeof result === "function"`,
and `"step" in result` respectively. Unlike `onResponse()`, there is no
"return text to the user" branch — a logic step must route somewhere.

<div class="callout callout--note"><span class="callout__title">A doc discrepancy worth knowing</span><p>Some internal notes show <code>runLogic()</code> returning an object literal, <code>{ step: GooLogicStep, state: { fooData: "fooValue" } }</code>. That shape is still accepted by the runner, but the demo uses the builder form, <code>go(GooLogicStep).withState({...})</code>, and so should new code. The builders are typed and compose.</p></div>

## How it works

`FooLogicStep` and `GooLogicStep` are traversed inside the same HTTP request that
handled the second city temperature. `WeatherStep`'s tool handler returns
`go(FooLogicStep)`, and then:

```text
WeatherStep.get_weather -> go(FooLogicStep)
  flow.goto(FooLogicStep)
  runner sees step.isLogic() -> LogicRunner.send
    FooLogicStep.runLogic() -> go(GooLogicStep).withState({fooData})
    flow.goto(GooLogicStep); GooLogicStep.saveState({fooData})
    next step is still logic -> LogicRunner.send again
      GooLogicStep.runLogic() -> go(FavoritesStep).withState({gooData})
      flow.goto(FavoritesStep); FavoritesStep.saveState({gooData})
      next step is not logic -> LlmRunner.send
        FavoritesStep.onCrossing(...) -> getPrompt() -> model call
  response returned to the user
```

`LogicRunner` recurses while the new step is also logic and hands over to `LlmRunner`
the moment it is not. The user never sees a turn boundary at a logic step; from the
outside, one message went in and the favourites question came back.

Two smaller details. `LogicRunner` still pushes a message into the step's memory
namespace — `Continue to step:GooLogicStep` when no crossing message exists — so the
history records that the stage was traversed. And it calls `flow.saveSession()` before
a crossing, so a crash inside `runLogic()` does not lose the fact that the previous
step completed.

## Why it is written this way

A deterministic stage could obviously be a plain function call at the top of the next
step's handler. Making it a registered step buys three things:

**It appears in the cursor.** `flow.currentStep` passes through `FooLogicStep`, and the
`sequence` array records it. If the process dies during a slow database lookup, the
resumed session knows where it was.

**It gets a state slot.** A logic step that computes pricing, resolves entitlements, or
calls an authorization service can persist the result under its own name, and later
steps read it with `getStepState`.

**It is substitutable.** Because it is a `go()` target like any other, you can branch to
one of several logic steps and the calling handler does not change shape.

The cost is a step in `defineSteps()` and a class file. For the trivial case — as with
`fooData`/`gooValue` here, which are placeholders — that cost is not worth paying in
real code. Use a `LogicStep` when the work is asynchronous, fallible, or worth
recording; inline it when it is a two-line pure calculation.

## Common mistakes

- **Expecting `withState` to write to the logic step.** It writes to the destination.
  Use `this.saveState(...)` for the step's own record.
- **Returning nothing.** `runLogic()` must route. There is no text branch and no
  implicit stay.
- **Calling `stay()` inside `runLogic()`.** It throws — `stay()` requires a tool-handler
  scope, and a logic step has none. To loop, return `go(ThisStep)`, and make sure the
  loop terminates.
- **Implementing `getPrompt()` on a `LogicStep`.** It is never called. Nothing about
  the step reaches the model.
- **Building an unbounded logic chain.** `LogicRunner` recurses for each consecutive
  logic step. Two hops, as here, is fine; a cycle is a stack overflow.

## Next

`GooLogicStep` hands off to a step with no tools at all.
[10. Response-driven steps](/docs/tutorials/basic-flow/response-driven-steps/) shows how that
one routes.
