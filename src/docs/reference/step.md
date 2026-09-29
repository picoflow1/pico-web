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
| `configLlmCallPolicy()` | `protected configLlmCallPolicy(): LlmCallPolicyOverride` | `{}` — inherits the Flow policy | This Step needs another `timeoutMs`, or `{ timeoutMs: null }` to remove the Flow deadline |
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
| `onLlmBlocked()` | `public async onLlmBlocked(context: LlmBlockedContext): Promise<LlmBlockedResponse \| null>` | `null` — delegate to the Flow | The provider refuses or blocks a prompt or candidate and the Step can return a safe response or route |
| `shouldRetryLlmError()` | `public shouldRetryLlmError(context: LlmAttemptErrorContext): boolean \| undefined` | `undefined` — delegate to the Flow, then framework default | A thrown invocation error should stop early or use another configured attempt |
| `onLlmError()` | `public async onLlmError(context: LlmErrorContext): Promise<LlmErrorResponse \| null>` | `null` — delegate to the Flow | Exhausted or declined model work needs a final response, route, or one temporary alternate model |
| `structOutputSchema()` | `public structOutputSchema(): object \| null` | `null` | The provider should use constrained structured output |
| `isLogic()` | `public isLogic(): boolean` | `false` | Never directly — extend `LogicStep` instead |
| `isEnd()` | `public isEnd(): boolean` | `flow.getSessionDoc().runStatus === 'completed'` | A specialised terminal step reports completion differently |

`checkResponse()` has inverted semantics on purpose: `false` accepts, `true` asks the retry
loop to run again. It runs before tool dispatch, so a rejected candidate's tool calls are not
executed. Keep it deterministic and side-effect free; it can be evaluated more than once per
turn.

### Model refusal, retry, and recovery hooks

The three model-failure hooks have distinct jobs and precedence. They apply to ordinary
chat-model `Step`s; [`DecisionStep`](/docs/reference/decision-step/) uses its separate
`onDecisionError()` chain.

#### onLlmBlocked()

```ts
public async onLlmBlocked(
  context: LlmBlockedContext,
): Promise<LlmBlockedResponse | null>;
```

Handles a provider refusal or safety block. The context includes `provider`, normalized
`reason`, provider `rawReason`, `phase: "prompt" | "candidate"`, and optional safety ratings
or provider details. Returning a string or normal Step transition handles the block. Returning
`null` delegates to `Flow.onLlmBlocked()`; when both return `null`, PicoFlow propagates the
block.

Blocked responses do not enter ordinary invocation-error retry or `onLlmError()` recovery.
Use this hook for an honest safe response or a bounded application route, not to disguise a
provider refusal as a successful model answer.

#### shouldRetryLlmError()

```ts
public shouldRetryLlmError(
  context: LlmAttemptErrorContext,
): boolean | undefined;
```

Runs only when the model invocation throws an ordinary error. The context contains Step ID,
provider, model, original `Error`, one-based `attempt`, `maxAttempts`, and the request signal.

- `true` uses the next configured attempt when one remains;
- `false` stops immediately and proceeds to terminal recovery;
- `undefined` delegates to `Flow.shouldRetryLlmError()`, then the framework's ordinary-error
  default.

The hook cannot extend the attempt budget or change the delay, model, or deadline.
`retryAttempts` is the total model-call attempt budget, with a framework default of three.

#### onLlmError()

```ts
public async onLlmError(
  context: LlmErrorContext,
): Promise<LlmErrorResponse | null>;
```

Runs once after retry is declined or the attempt budget cannot produce an accepted response.
The Step's non-null result wins; `null` delegates to `Flow.onLlmError()`. When both return
`null`, PicoFlow propagates the existing error.

`context.kind` describes the terminal failure:

| Kind | Meaning | Additional fields |
| --- | --- | --- |
| `invocation_error` | The provider invocation threw | original `error`; `stoppedBecause` is `retry_declined` or `attempts_exhausted` |
| `empty_response` | The provider returned no usable content or tool call | `lastResponse`; attempts exhausted |
| `response_rejected` | `checkResponse()` requested another candidate | `lastResponse`; attempts exhausted |

The hook may return an ordinary final Step response, including routing or `finish(...)`.
It may also return `retryWithModel(selection)` to continue the same Step temporarily with
another registered model. The alternate model gets one attempt per model call; if it calls a
tool, the follow-up model call remains on that alternate selection. The fallback keeps the
current prompt, memory, tools, structured output contract, request signal, and completed tool
history; it does not change the Step's configured model for later turns. A second model fallback
in the same recovery sequence is rejected, and its selection may not include `retryAttempts`.

```ts
async onLlmError(context: LlmErrorContext) {
  if (this.getState<boolean>('actionRecorded')) {
    return directTo(ReviewStep, 'The action was recorded; review is pending.');
  }
  if (context.kind === 'invocation_error' && context.model === 'gpt-5.6-luna') {
    return retryWithModel({
      provider: 'openai',
      name: 'gpt-5.1',
      params: { reasoning: { effort: 'high' } },
    });
  }
  return null;
}
```

Cancellation bypasses all recovery output, including cancellation while an asynchronous hook
is pending. Prompt construction, token accounting, tool handlers, `checkResponse()` exceptions,
and `onResponse()` exceptions are outside these model-failure hooks. A tool may already have
changed state or caused an external effect before a follow-up model call fails; recovery should
read the saved effect or route to review, never blindly repeat it.

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

Erasing history does not erase step state. During `runSteps()`, `getMemory()` is an
invocation-private clone of the history visible at the fork. Nested children inherit the
calling branch's current clone; raw child history is discarded after the branch completes.

## Model and output helpers

| API | Signature |
| --- | --- |
| `useModel` | `useModel<const Provider extends string, const Name extends string>(selection: ModelSelectionFor<Provider, Name>): this` |
| `getModel` | `getModel(): string \| undefined` |
| `getModelSelection` | `getModelSelection(): ResolvedModelSelection` |
| `getLlmCallPolicy` | `getLlmCallPolicy(): LlmCallPolicy` |
| `getLLMType` | `getLLMType(): LLMType` |
| `contentType` | `get contentType(): HttpContentType` / `set contentType(ctType: HttpContentType)` |

`useModel()` marks a real override. `getModelSelection()` merges params with the flow's only
when the provider **and** name are identical; a cross-model override replaces params
entirely. An override equal to the flow selection is not persisted on the step document.

`getLlmCallPolicy()` resolves the Step override against the Flow policy. An omitted
`timeoutMs` inherits the Flow value, a positive integer replaces it, and `null` removes
it. This code-owned policy is not part of the persisted model selection.

`getLLMType()` maps the resolved model name prefix to `LLMType.GEMINI`, `LLMType.OPENAI`,
`LLMType.ANTHROPIC`, or `LLMType.UNSUPPORTED`, and is used for provider-side file uploads.

`contentType` defaults to `HttpContentType.Plain`. Prefer `.withContentType(...)` on a
transition over assigning it directly — see [go() / stay() / direct()](/docs/reference/response-builders/).

## Nested execution and completion

| API | Signature | Purpose |
| --- | --- | --- |
| `runStep` | `runStep(stepClass: StepClassType, userMessage?: string): Promise<MessageContent \| null>` | Run one registered child in an in-memory frame |
| `runSteps` | `runSteps(requests: readonly RunStepRequest[], options?: RunStepsOptions): Promise<ParallelBatchResult>` | Run isolated child instances through a bounded fork/join barrier |
| `sessionCompleted` | `sessionCompleted(): void` | Set `runStatus` to `completed` |
| `isEnd` | `isEnd(): boolean` | Report completion for the response envelope |

```ts
type RunStepRequest = {
  step: StepClassType;
  key?: string;
  params?: JsonObject;
  userMessage?: string;
};

type RunStepsOptions = {
  failurePolicy?: "retain-successes" | "atomic";
  checkpoint?: "none" | "root-join";
  maxConcurrency?: number;
  signal?: AbortSignal;
};
```

`runSteps()` creates a fresh worker for every request internally. There is no decorator,
factory hook, or other caller-side registration syntax: pass the same Step classes that are
already registered with the Flow. `parallelParamsSchema()` may return a Zod-compatible
validator for `params`; `getParallelInvocation()` exposes the frozen params, branch key,
request index, scope path and cancellation signal inside the worker.

One class may appear repeatedly. Every repeated request then needs a non-empty, batch-unique
`key`. Each invocation has private Step state and memory. A successful worker's `saveState()`
becomes a proposed replacement of its own top-level field. Multiple branches replacing the
same field conflict; declare a reduced channel and call `contributeState()` when combining
copies is intentional:

```ts
protected override parallelStateChannels() {
  return {
    total: StepChannels.sum(),
    resultByKey: StepChannels.keyedByBranch(),
  };
}

public override async run() {
  const { params } = this.getParallelInvocation<{ amount: number }>();
  this.contributeState("total", params.amount);
  this.contributeState("resultByKey", params.amount);
  return params.amount;
}
```

Built-in channel helpers are `singleWriter()`, `reduced(...)`, `sum()`, `append()`,
`appendUniqueBy(...)`, `keyedByBranch()`, and `mergeRecord()`. Reducers run in stable request
order, never completion order.

`ParallelBatchResult.branches`, `.fulfilled`, and `.rejected` remain in request order.
The default `retain-successes` policy publishes fulfilled state even when another child
fails. `atomic` publishes none when any child rejects. Framework failures—such as a shared
mutation, invalid JSON, factory error, conflict, or reducer failure—throw and publish none of
that barrier's application state.

Publication happens before `runSteps()` returns, so the caller immediately sees child state
through `getStepState()` and `getSessionDoc()`. The default `checkpoint: "none"` waits for the
normal outer save; `root-join` performs one immediate session save and rolls the in-memory
application state back if that requested checkpoint fails.

Workers receive read-only snapshots of the session document, context, and other Steps.
Attempts to mutate those surfaces, move the cursor, complete the session, replace Flow
memory, or call `saveSession()` raise `ParallelMutationError`. The worker may change only its
own private state and private memory. Raw child histories are discarded; published Step state
and returned output are the communication mechanism.

Nested `runStep()` and `runSteps()` fork from the calling branch's materialized view. Thus a
parent worker's pre-fork state is visible to its children, inner successful state is visible
to that parent at the inner join, and descendants reach canonical state only if the containing
outer branch succeeds.

Cancellation is cooperative. Running model calls and workers receive the signal, queued work
does not start, and a worker that ignores cancellation loses publication rights after the
Flow's `cancellationGraceMs` deadline. Arbitrary external side effects are not rolled back;
make them idempotent by branch key.

A sequential `runStep()` keeps its existing behavior. When called inside a parallel worker it
uses a one-child atomic barrier and receives the same isolation guarantees.
Nested execution increments the sequence level recorded in the session document but never
moves the durable cursor.

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
