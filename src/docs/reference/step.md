---
title: Step
eyebrow: Reference
lede: "The Step customization boundary: every override hook with its real signature, the state, memory, model and nested-execution helpers, and the runtime plumbing you should leave alone."
source: pf/src/picoflow/flow/step.ts
---

`Step` is the class you subclass for each stage of a workflow. It owns a prompt, a set of
exposed tools, its own persistent state, a memory namespace, an optional model override, and
the transitions it returns.

```ts
export abstract class Step {
  static get id(): string;                     // defaults to the class name
  protected constructor(flow: Flow);
  protected get id(): string;
  public getName(): string;                    // returns id
}
```

<div class="callout callout--note"><span class="callout__title">The constructor takes only the flow</span><p>The signature is <code>protected constructor(flow: Flow)</code>. The initial cursor comes from the order of <code>defineSteps()</code> or from <code>Flow.initialStep()</code>; it is not selected by a constructor flag.</p></div>

## Override hooks

| Hook | Signature | Default | Override when |
| --- | --- | --- | --- |
| `getPrompt()` | `public getPrompt(): string \| null` | Returns the `_prompt` state value saved by `.withPrompt(...)`, else `null` | The step needs a system prompt |
| `defineTool()` | `public defineTool(): ToolType[]` | `[]` | The flow needs a tool registered with a name, description, and Zod object schema |
| `useTool()` | `public useTool(): string[]` | `[]` | The step exposes a tool defined elsewhere, or keeps an undecorated legacy handler |
| `onStart()` | `public async onStart(): Promise<MessageTypes \| null>` | Calls `onEnter()`, then `onCrossing(null)` | A new session's starting step needs custom bootstrap |
| `onRestore()` | `public async onRestore(): Promise<void>` | No operation | Runtime-only caches must be rebuilt on resume |
| `onEnter()` | `protected async onEnter(): Promise<void>` | No operation | Setup runs every time the step becomes active |
| `onExit()` | `protected async onExit(): Promise<void>` | No operation | Cleanup runs when the step is deactivated |
| `onCrossing()` | `public onCrossing(langMessage: MessageTypes \| null \| undefined, _priorStep?: string): MessageTypes \| null` | Synthesises `HumanMessageEx(this, 'Start')` when there is no incoming message and history does not already end on this step | A stage must rewrite, replace, or suppress the crossing message |
| `onResponse()` | `public async onResponse(llmResult: string \| object): Promise<LastResponseType>` | `JSON.stringify` for objects, otherwise the value unchanged | Free-form or structured output needs validation, rewriting, or routing |
| `checkResponse()` | `public checkResponse(_llmResult: string \| object): boolean` | `false` | A bad response should be retried — return `true` to retry |
| `structOutputSchema()` | `public structOutputSchema(): object \| null` | `null` | The provider should use constrained structured output |
| `isLogic()` | `public isLogic(): boolean` | `false` | Never directly — extend `LogicStep` instead |
| `isEnd()` | `public isEnd(): boolean` | `flow.getSessionDoc().runStatus === 'completed'` | A specialised terminal step reports completion differently |

`checkResponse()` has inverted semantics on purpose: `false` accepts, `true` asks the retry
loop to run again. Keep it deterministic; it can be evaluated more than once per turn.

### run()

```ts
public async run(userMessage?: string): Promise<MessageContent | null>;
```

Wraps a non-empty `userMessage` in a `HumanMessageEx` and hands control to the shared model
runner. Override it only to prepare state, and call `super.run(message)` unless you are
deliberately replacing the whole model loop.

### LastResponseType

`onResponse()` may return a string, a `Step` class, a registered step name, or a transition
object:

```ts
type LastResponseType =
  | {
      step: StepTarget;
      message?: MessageTypes;
      prompt?: string;
      state?: JsonObject;
      contentType?: HttpContentType;
    }
  | StepTarget;          // a Step class or a registered step name
```

Returning a target activates it and continues execution in the same HTTP turn.

## State and context helpers

| API | Signature | Purpose |
| --- | --- | --- |
| `getState` | `getState<T = JsonObject>(key?: string, stateType?: SaveStateType): T` | Read persistent state, or one lodash path inside it |
| `getTransientState` | `getTransientState<T = JsonObject>(key?: string): T` | Read invocation-only state |
| `saveState` | `saveState(json: JsonObject, stateType?: SaveStateType): void` | Replace the first top-level key in `json`, then merge; stamps `_saveOn` |
| `saveTransientState` | `saveTransientState(json: JsonObject): void` | Save under `_transient`, never persisted |
| `removeState` | `removeState(key: string): void` | Drop a durable key |
| `getContext` | `getContext<T>(key: string): T` | Delegates to `Flow.getContext` |

`SaveStateType.persistent` is the default. `saveState()` reads `Object.keys(json)[0]`, omits
that key from the existing state, and then merges — so passing a single top-level key replaces
that subtree rather than deep-merging into it.

Cross-step access goes through the flow: `flow.getStepState(OtherStep)`,
`flow.saveStepState(OtherStep, json)`, `flow.saveTransientStepState(OtherStep, json)`.

## Memory and message helpers

| API | Signature | Purpose |
| --- | --- | --- |
| `useMemory` | `useMemory(nameSpace: string): this` | Select the namespace; validated against `/^[A-Za-z][A-Za-z0-9_-]{0,127}$/` |
| `getMemorySpace` | `getMemorySpace(): string` | The selected namespace; defaults to the step's `id` |
| `getMemory` | `getMemory(): MessageTypes[]` | The live history array; seeds an empty `SystemMessage` slot at index 0 |
| `getLastMessage` | `getLastMessage(): MessageTypes \| null` | The newest message, without seeding |
| `eraseMemory` | `protected eraseMemory(): MessageTypes[]` | Truncate the namespace in place |
| `genMessageId` | `genMessageId(): string` | Step name, UTC timestamp, and a 10-digit suffix joined by pipes — the format crossing detection parses |

The runner overwrites `history[0]` with the system message built from `getPrompt()` on every
model call, which is why the placeholder slot exists. Message IDs carry step attribution, so
custom raw LangChain messages should always use `genMessageId()`. `HumanMessageEx`,
`AiMessageEx`, `ToolMessageEx`, and `DirectMessage` do this for you.

Erasing history does not erase step state.

## Model and output helpers

| API | Signature |
| --- | --- |
| `useModel` | `useModel<const Provider extends string, const Name extends string>(selection: ModelSelectionFor<Provider, Name>): this` |
| `getModel` | `getModel(): string \| undefined` |
| `getModelSelection` | `getModelSelection(): ResolvedModelSelection` |
| `getLLMType` | `getLLMType(): LLMType` |
| `contentType` | `get contentType(): HttpContentType` / `set contentType(ctType: HttpContentType)` |

`useModel()` marks a real override. `getModelSelection()` merges params with the flow's only
when the provider **and** name are identical; a cross-model override replaces params
entirely. An override equal to the flow selection is not persisted on the step document.

`getLLMType()` maps the resolved model name prefix to `LLMType.GEMINI`, `LLMType.OPENAI`,
`LLMType.ANTHROPIC`, or `LLMType.UNSUPPORTED`, and is used for provider-side file uploads.

`contentType` defaults to `HttpContentType.Plain`. Prefer `.withContentType(...)` on a
transition over assigning it directly — see [go() / stay() / direct()](/docs/reference/response-builders/).

## Nested execution and completion

| API | Signature | Purpose |
| --- | --- | --- |
| `runStep` | `runStep(stepClass: StepClassType, userMessage?: string): Promise<MessageContent \| null>` | Run one registered child in an in-memory frame |
| `runSteps` | `runSteps(stepRequests: RunStepRequest[]): Promise<(MessageContent \| null)[]>` | Run independent children with `Promise.all`, preserving order |
| `sessionCompleted` | `sessionCompleted(): void` | Set `runStatus` to `completed` |
| `isEnd` | `isEnd(): boolean` | Report completion for the response envelope |

```ts
type RunStepRequest = {
  step: StepClassType;
  userMessage?: string;
  params?: Record<string, any>;
};
```

`runSteps()` throws `runSteps() cannot execute the same step class twice.` when two requests
name the same class. A child frame calls the child's `onEnter()`, runs it, and calls `onExit()`
in a `finally`. Children may save state, but calling `goto()` from a child frame throws.
Nested execution also increments the sequence level recorded in the session document.

For normal user-facing completion, transition to `TerminateSessionStep`. Use
`sessionCompleted()` for workers and coordinators that finish without a closing conversation.
See [Nested execution](/docs/guides/nested-execution/).

## Runtime plumbing — do not override

These are public because the runtime shares the class. Application steps should not call or
override them:

- **Execution frames:** `pushExecutionFrame()`, `Step.hasExecutionScope()`,
  `Step.getCurrentExecutionStep()`, `enterCurrentStep()`, `exitCurrentStep()`.
- **Persistence:** `createDoc()`, `readDoc(stepDoc)`, `writeDoc(stepDoc)`.
- **Tool dispatch:** `obtainTools()`, `isToolAvailable(name)`, `hasToolHandler(nameOrNames)`,
  `invokeToolHandler(toolOrTools)`.
- **Model plumbing:** `inheritModel(model)`.
- **Identity:** `getName()`, `getMemorySpace()`.

`invokeTool(_tools: ToolCall[]): Promise<[string, boolean]>` still exists on the class and
returns `['', false]`, but the runner never calls it. Dispatch goes through
`invokeToolHandler(...)`. Do not build anything new on `invokeTool`.

Override `isLogic()` only by extending [`LogicStep`](/docs/reference/logic-and-terminal-steps/);
claiming an ordinary `Step` is logic-backed bypasses the `runLogic()` contract and will fail
in `LogicRunner`.
