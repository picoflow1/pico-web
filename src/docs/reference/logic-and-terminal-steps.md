---
title: LogicStep and TerminateSessionStep
eyebrow: Reference
lede: "The two specialised Step base classes PicoFlow ships: a deterministic step that runs without a model, and the standard terminal step that completes a session."
source: pf/src/picoflow/flow/logic-step.ts
---

Both classes are ordinary `Step` subclasses. They are registered in `defineSteps()` like any
other step, and they participate in the same cursor, state, memory, and sequence machinery.

## LogicStep

```ts
export abstract class LogicStep extends Step {
  constructor(flow: Flow);
  public isLogic(): boolean;                     // always true
  abstract runLogic(): Promise<LogicResponseType>;
}
```

A logic step never calls a model. When the runner reaches a step whose `isLogic()` is `true`,
it hands control to `LogicRunner` before building a prompt, a tool list, or a model instance.

### runLogic()

```ts
abstract runLogic(): Promise<LogicResponseType>;

type LogicResponseType = StepResponseType | StepTarget;
```

The return type is identical to a tool handler's, minus any use for tool feedback. Return a
`Step` class, a registered step name, or a transition object.

```ts
export class RouteByTierStep extends LogicStep {
  public async runLogic(): Promise<LogicResponseType> {
    const tier = this.flow.getStepState<{ tier?: string }>(ProfileStep).tier;
    return tier === "gold"
      ? { step: ConciergeStep, state: { priority: true } }
      : PlainSupportStep;
  }
}
```

Because `runLogic()` is abstract, a `LogicStep` subclass that does not implement it will not
compile. Extending `LogicStep` is also the only supported way to make `isLogic()` true —
overriding it on a plain `Step` sends the turn into `LogicRunner`, which throws
`Current step '<name>' is not a logic step.`

### Destination-state semantics

`LogicRunner` applies a transition object in the same order the tool path uses:

```text
1. goto the target                      -> onExit(), onEnter()
2. prompt      -> destination.saveState({ _prompt })
3. state       -> destination.saveState(state)
4. contentType -> destination.contentType
5. message     -> appended to the destination's memory
```

`state`, `prompt`, `contentType`, and `message` all land on the **destination**, never on the
logic step that produced them. The `tool` field is meaningless here — there is no tool call to
answer — and is ignored.

After applying the transition, the runner inspects the new step. If it is another logic step,
`LogicRunner` recurses; otherwise it hands off to `LlmRunner`.

<div class="callout callout--danger"><span class="callout__title">A logic step must move the cursor</span><p><code>LogicRunner</code> loops while the executing step is a logic step. Returning the current logic step, or building a cycle of logic steps that never reaches a model step, produces unbounded recursion inside a single HTTP turn. Always route to a different step.</p></div>

### Other runtime differences

- Before each `runLogic()` the runner performs crossing detection, calls `flow.saveSession()`
  when the prior step differs, and calls `onCrossing(...)`.
- The step's memory namespace still receives an entry — the incoming message, or a synthesised
  `HumanMessageEx(step, 'Continue to step:<name>')` — so the sequence remains readable.
- `Flow.bootstrap()` skips model validation for logic steps, and a logic step never persists a
  model override in its step document. Calling `useModel(...)` on one has no persisted effect.

## TerminateSessionStep

```ts
export class TerminateSessionStep extends Step {
  constructor(flow: Flow);
  public onCrossing(_userMessage, priorStep?: string): MessageTypes;
  public isEnd(): boolean;                            // always true
  protected async onEnter(): Promise<void>;
  public getPrompt(): string;
  public defineTool(): ToolType[];
  protected async terminate_session(): Promise<ToolResponseType>;
}
```

It is the default content of `Flow.defineSteps()`, which returns
`[new TerminateSessionStep(this).useMemory('temp')]` when a flow does not override it. Most
flows register it explicitly with their own namespace:

```ts
protected defineSteps(): Step[] {
  return [
    new ExploreStep(this).useMemory("hotel-explore"),
    new TerminateSessionStep(this).useMemory("end"),
  ];
}
```

### Its overrides

| Member | Behaviour |
| --- | --- |
| `onEnter()` | Calls `flow.markCompleted()`, setting `runStatus` to `completed` |
| `isEnd()` | Returns `true` unconditionally, rather than reading `runStatus` |
| `onCrossing(msg, priorStep?)` | Copies the prior step's `contentType` when a prior step is given, then returns `HumanMessageEx(this, "I'm done with chat")` |
| `getPrompt()` | Returns the `_prompt` saved by `.withPrompt(...)`, otherwise a built-in closing instruction |
| `defineTool()` | Registers `terminate_session`, whose schema is `z.object({ prompt: z.string() })` |

The built-in prompt is a single instruction telling the model to say the conversation has
ended as requested and to discuss nothing else. Supply your own closing copy with
`.withPrompt(...)` on the transition.

### Exposing terminate_session

`TerminateSessionStep` **registers** the `terminate_session` definition flow-wide, but it does
not expose it — it declares no `useTool()` entries and its own `terminate_session` method is
not decorated. Each conversational step that should be able to end the chat exposes and
handles the tool itself:

```ts
@Tool
protected async terminate_session(): Promise<ToolResponseType> {
  return go(TerminateSessionStep).withPrompt(ClosingPrompt);
}
```

Exposing the name with `useTool(["terminate_session"])` without a handler is not enough: the
runner logs `missing tool handler: terminate_session`, returns a success tool message, and the
cursor does not move.

## sessionCompleted() versus a terminal step

Both mark the session document `completed`. They differ in what the user sees.

| | `go(TerminateSessionStep)` | `sessionCompleted()` |
| --- | --- | --- |
| Cursor | Moves to the terminal step | Stays where it is |
| Model call | One more turn, producing a closing message | None triggered by the call itself |
| `completed` in the response | `true`, from `isEnd()` returning `true` | `true`, because `runStatus` is `completed` |
| Content type | Inherited from the prior step through `onCrossing` | Unchanged |
| Fits | Conversational flows that owe the user a goodbye | Workers, one-shot flows, batch coordinators |

`Flow.markCompleted()` is the flow-level equivalent of `Step.sessionCompleted()`; both write
`runStatus = 'completed'` on the session document.

A completed session does not resume. `FlowSession.fetch()` treats `completed` and `aborted`
documents as unusable and creates a new session, so the caller receives a new
`CHAT_SESSION_ID`. The old document is retained until it is deleted explicitly — see
[FlowEngine](/docs/reference/flow-engine/) and
[Error handling and completion](/docs/guides/error-handling/).
