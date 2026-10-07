---
title: Step lifecycle
eyebrow: Concepts
lede: "When each Step hook runs: configuration, tool registration, activation, model-call preparation, response handling, recovery, and completion."
source: pico-demo/docs/step-authoring-contract.md
---

The Step lifecycle includes configuration, tool registration, activation, execution, recovery,
and completion. The framework calls your override hooks at different points in that sequence;
helpers such as `saveState()` and `runStep()` are operations your code chooses to call.

Five activation hooks decide when a step gets to prepare itself. They look similar and they are not
interchangeable. The rule that resolves almost every question is: **entry hooks fire on
activation, restore fires on rehydration, and crossing fires on message hand-off** — and
those are three different events.

## Hook map

This table covers every override hook in the [Step reference](/docs/reference/step/#override-hooks).
It describes timing; the reference holds signatures and return contracts.

| Phase | Hook | When the framework calls it |
| --- | --- | --- |
| Configuration | `configLlmCallPolicy()` | During ordinary Step bootstrap validation, and when resolving effective policy for model calls; inherits the Flow policy |
| Execution-kind checks | `isLogic()` | During model validation and runner dispatch; extend `LogicStep` rather than override it directly |
| Tool registration | `defineTool()` | During Flow tool composition after hydration, for every registered Step; DecisionSteps also query it during configuration validation |
| New session | `onStart()` | Once for the initial Step of a newly created session |
| Restore | `onRestore()` | On the current Step when a running session is rehydrated |
| Activation | `onEnter()` | Via default `onStart()`, on entry through a different top-level Step, or before nested execution |
| Message hand-off | `onCrossing()` | Via default `onStart()` and the runner's cross-step message path |
| Model-call preparation | `useTool()` | While resolving exposed tools or checking tool availability; DecisionSteps also query it to reject chat-tool configuration |
| Model-call preparation | `getPrompt()` | When preparing the chat-model call; also used by the Decision runner |
| Model-call preparation | `structOutputSchema()` | After binding tools, before invoking the chat model; DecisionSteps also query it to reject structured chat output |
| Candidate validation | `checkResponse()` | For a usable, unblocked model candidate, before tool dispatch or `onResponse()` |
| Final model response | `onResponse()` | After a candidate is accepted and has no tool calls |
| Invocation-error retry | `shouldRetryLlmError()` | When an ordinary chat-model invocation throws |
| Terminal model recovery | `onLlmError()` | When chat-model retries are declined or exhausted without an accepted candidate |
| Provider refusal | `onLlmBlocked()` | When the chat provider refuses or blocks the prompt or candidate |
| Deactivation | `onExit()` | When leaving a top-level Step, or in nested-execution cleanup |
| Completion reporting | `isEnd()` | On the current Step when Flow builds the turn's response envelope |

Some hooks are queried repeatedly. Keep configuration and selection hooks free of external
side effects; do not treat them as once-per-session initialization. The activation scenarios
below explain entry and exit timing, followed by the execution and recovery paths.

## Configuration and tool registration

For each engine invocation, the Flow constructs its registered Steps through `defineSteps()`.
Before session hydration, it resolves model selections and validates ordinary Steps' effective
call policies. `configLlmCallPolicy()` supplies a Step override of the Flow policy; it can be
queried again during execution, so it must not assume hydrated state during bootstrap.
Step model overrides come from `useModel()` and persisted model settings rather than a
Step `configModel()` override hook.

After the initial Step's `onStart()` or the restored current Step's `onRestore()`, the Flow
composes its tool registry. It calls `defineTool()` on **every registered Step**, then on the
Flow, and combines those definitions into a shared registry. A Step does not have
to become active for its tools to be registered. Registration repeats on each engine invocation.

`defineTool()` declares tools for the shared registry; `useTool()` selects named tools for the
executing Step. Its own decorated `@Tool` and `@Tools` declarations are included automatically.
A tool defined elsewhere is exposed by naming it in `useTool()`. See
[Decorators](/docs/reference/decorators/) for declaration and handler details.

## Activation hooks

| Hook | Visibility | Default behaviour |
| --- | --- | --- |
| `onStart()` | public | Calls `onEnter()`, then returns `onCrossing(null)` |
| `onRestore()` | public | No operation |
| `onEnter()` | protected | No operation |
| `onExit()` | protected | No operation |
| `onCrossing(message, priorStep?)` | public | Synthesises a `HumanMessageEx("Start")` when there is no incoming message and the last message in this namespace did not come from this step; otherwise passes the message through |

## Scenario 1: new session

A request arrives with no session ID, or with an ID that is missing, completed, aborted, or
rejected by that Flow's restore policy.

```text
Flow creates step documents, currentStep = initialStep()
  -> initialStep.onStart()
       -> onEnter()
       -> onCrossing(null)
  -> the resulting message is pushed into the step's memory namespace
  -> session is saved
  -> Step.run(userMessage)
       -> resolve call policy and model
       -> obtain selected tools (useTool() + decorated tools)
       -> getPrompt()
       -> structOutputSchema()
       -> model call / retry / recovery
            -> accepted candidate: checkResponse() returns false
                 -> tool calls: @Tool handler -> stay/go -> continue or cross
                 -> no tool call: onResponse()
  -> persist currentStep, step state, memory, model overrides, session
```

Only the initial step gets `onStart()`. Other registered steps sit in the document with empty
state and no hooks fired at all.

`onCrossing(null)` is what lets a flow open the conversation. Its default creates a synthetic
`"Start"` human message so the model has something to respond to when the user's first
request carried no text — the pattern behind a bot that greets first.

Override `onStart()` only when the starting step needs bootstrap behaviour that differs from
"enter, then cross". Call `super.onStart()` unless you are deliberately replacing both.

## Scenario 2: restored session

A request arrives with a valid, running session ID for the same flow.

```text
Flow restores persisted step documents, memory, model settings and context
  -> currentStep.onRestore()
  -> currentStep.run(userMessage)
  -> normal prompt / model / tool / response lifecycle
  -> persist again
```

<div class="callout callout--warning"><span class="callout__title">onStart() and onRestore() are mutually exclusive</span><p><code>onStart()</code> is never called when an existing session is restored. <code>onRestore()</code> is never called for a new session. Setup that must happen exactly once per conversation belongs in <code>onStart()</code>; setup that must happen once per process belongs in <code>onRestore()</code>.</p></div>

Note what does **not** fire here: `onEnter()`. Restoring a session does not re-enter the
current step. The step was already active when the last turn ended; the document simply
records where it stopped.

That distinction matters when `onEnter()` has side effects. `HotelFlow`'s `CompareStep` calls
`eraseMemory()` in `onEnter()`:

```ts
protected async onEnter() {
  this.eraseMemory();
}
```

If restoring also called `onEnter()`, every resumed turn would wipe the comparison history.
It does not.

`onRestore()` is for rebuilding runtime-only resources — a cache, a client, a derived index
— from persisted state, without repeating normal entry work.

## Scenario 3: top-level step transition

A handler returns `go(TargetStep)`, or `onResponse()` returns a step class.

```text
current handler returns go(TargetStep)
  -> currentStep.onExit()
  -> sequence entry appended
  -> flow.currentStep = "TargetStep"
  -> targetStep.onEnter()
  -> session saved (mid-turn checkpoint)
  -> targetStep.onCrossing(message, priorStepName)
  -> targetStep.getPrompt()
  -> target model / tool loop
```

Three details are easy to get wrong.

**The transition happens before the builder effects.** `withPrompt(...)`, `withState(...)`
and `withContentType(...)` are applied to the destination *after* `onEnter()` has run. Code
in `onEnter()` cannot read state that the transition is about to attach.

**Transitioning to the current step is a no-op for entry hooks.** `Flow.goto(...)` returns
early when the target is already current. Since `stay()` is implemented as
`go(currentStep).withToolFeedback(...)`, a `stay()` does **not** fire `onExit()` or
`onEnter()`, and does not fire `onCrossing()` either. That is what makes `stay()` cheap
enough to use for every validation failure.

**A direct message can skip `onCrossing()`.** When a handler returns a direct AI message, the
current HTTP invocation ends without another model call. The target is activated and
`onEnter()` runs, but the normal cross-step model path — and therefore `onCrossing()` — may
not.

### onCrossing in detail

```ts
public onCrossing(
  message: MessageTypes | null | undefined,
  priorStep?: string,
): MessageTypes | null
```

It fires when the executing step differs from the step that was executing a moment ago, and
its job is to decide what the destination model sees as its incoming message. Four useful
behaviours:

| Intent | Implementation |
| --- | --- |
| Pass the user's message through | `return super.onCrossing(message, priorStep)` |
| Suppress it entirely | `return null` |
| Replace it with a synthetic command | `return new HumanMessageEx(this, "Summarise the selected hotel.")` |
| Branch on where the user came from | Switch on `priorStep` |

This is the right place for a stage that needs a starting instruction rather than the user's
literal words. A one-shot document step, for example, is entered with no useful user text and
synthesises its own.

Do not put durable state changes here. It is a message transformation hook, and it can be
reached more than once across a conversation.

## Scenario 4: nested step execution

`runStep(ChildStep, message?)` and `runSteps([...])` run a registered step inside the current
turn without moving the cursor.

```text
parent calls runStep(ChildStep, "message")
  -> sequence entry appended at level + 1
  -> child.onEnter()
  -> child.run("message")   (full prompt / model / tool loop)
  -> child.onExit()          (in a finally block)
  -> parent frame restored, child's content returned to the parent
```

`runSteps([...])` creates one fresh, isolated Step instance per request and joins them through
a bounded state barrier. Repeated classes are allowed with unique branch keys; fields written
by several copies require a Step-owned reducer.

<div class="callout callout--warning"><span class="callout__title">Nested execution is not a cross-step transition</span><p>The child is called directly, so <code>onCrossing()</code> is not invoked for it. Pass an explicit <code>userMessage</code>, or do the child's setup in <code>onEnter()</code>. Do not assume its <code>onCrossing()</code> will synthesise a starting message.</p></div>

Children may call `saveState()`, and that state persists with the turn. They may not call
`goto()`:

```text
Cannot goto 'SomeStep' from a child execution frame.
Return a result to the owning step instead.
```

Transition authority belongs to the owner. Parallel children receive private clones of the
history visible at their fork, even when their canonical Steps use the same namespace. Raw
child history is discarded rather than interleaved into the parent's transcript.

## Model-call and response lifecycle

The shared runner dispatches to chat, logic, or decision execution according to the Step's
kind. For an ordinary chat-model Step, one execution pass follows this order:

```text
resolve Flow + Step call policy and effective model
  -> cross-step checkpoint and onCrossing(), when applicable
  -> obtainTools(): useTool() + decorated tool names
  -> getPrompt(): install the system message
  -> bind selected tools
  -> structOutputSchema(): apply structured output, when supplied
  -> invoke model within the configured attempt budget
       -> refusal: blocked-response recovery
       -> empty candidate: retry
       -> usable candidate: checkResponse()
            -> true: reject and retry
            -> false: accept
  -> accepted candidate with tools: dispatch handlers
       -> direct response: return without another model call
       -> otherwise: apply feedback / transitions and continue execution
  -> accepted candidate without tools: onResponse()
       -> final response, completion, or transition
```

`getPrompt()`, `useTool()`, and `structOutputSchema()` prepare a model-call pass, not each
attempt inside its retry loop. A follow-up call after tool feedback or a transition prepares
another pass. A temporary alternate model also prepares a new pass with the same Step.

`checkResponse()` runs **before tool handlers**, including for candidates containing tool
calls. Returning `true` prevents those candidate tools from executing and requests another
attempt; returning `false` accepts the candidate. It can run several times, so keep it
deterministic and free of side effects. A thrown exception propagates outside model recovery.

`onResponse()` handles accepted responses without tool calls. It can rewrite output or return
a transition or `finish(...)`. Tool results and recovery results use normal response routing
without first passing through `onResponse()`.

### Logic and decision execution

`LogicStep` executes `stepLogic()` without a chat-model call. Its activation and crossing
behaviour still applies, but chat tool selection, structured output, candidate validation,
and chat-model recovery hooks do not run. See
[LogicStep and terminal Steps](/docs/reference/logic-and-terminal-steps/).

`DecisionStep` uses `getPrompt()`, `defineQuestions()`, and `decisionInput()` to prepare a
typed decision request; `decisionInput()` includes facts supplied by `getDecisionFacts()`.
It merges options supplied through `useDecision()` with the Flow's `configDecision()` defaults,
validates the returned answers, and calls `onDecision()` on success. It does not use
`useTool()`, `structOutputSchema()`, `checkResponse()`, or `onResponse()` for that decision.
During configuration validation, it does query the inherited chat-tool and structured-output
hooks to reject unsupported configuration. Its `onDecisionError()` path is described below;
full contracts are in the
[DecisionStep reference](/docs/reference/decision-step/).

## Completion and persistence

At the end of normal Flow execution, the Flow reads `isEnd()` from its **current** Step to
set the response's `completed` field. The default checks whether the session's `runStatus`
is `completed`. `isEnd()` reports completion; returning `true` from a custom override does
not itself mark the stored session completed. Use `finish(...)`, `sessionCompleted()`, or
the terminal Step's completion behaviour to update that state.

The engine then saves the session, including Step state, model overrides, memory, and Flow
context. `onExit()` is not an end-of-request hook: a conversational Step can remain current
across many turns without exiting. See
[Flow persistence](/docs/concepts/flow-lifecycle/#9-persistence) for save ordering and the
[completion guide](/docs/guides/error-handling/) for session status semantics.

## Failure and recovery lifecycle

Activation is only part of the lifecycle. During an ordinary chat-model Step's execution,
PicoFlow also gives the Step a chance to retry or recover from model failures. Each hook
runs on the executing Step first; delegation lets the Flow supply a shared policy.

```text
model invocation
  -> ordinary invocation error
       -> Step.shouldRetryLlmError(context)
       -> undefined: Flow.shouldRetryLlmError(context)
       -> undefined: framework retry default
       -> retry if permitted and an attempt remains
  -> empty response or checkResponse() returns true
       -> retry if an attempt remains (no shouldRetryLlmError() call)
  -> retries declined or exhausted without an accepted response
       -> Step.onLlmError(context)
       -> null: Flow.onLlmError(context)
       -> both null: propagate the error

provider refusal or safety block (separate path)
  -> Step.onLlmBlocked(context)
  -> null: Flow.onLlmBlocked(context)
  -> both null: propagate the block
```

`shouldRetryLlmError()` returns `true` to use another configured attempt, `false` to stop,
or `undefined` to delegate. It cannot extend the attempt budget. `onLlmError()` handles
terminal `invocation_error`, `empty_response`, and `response_rejected` outcomes. It may
return a final response, a normal transition, or `retryWithModel(...)` for one temporary
alternate model. The alternate gets one attempt per model call and does not change the
Step's configured model for later turns.

`onLlmBlocked()` may return a response or normal transition. Refusals do not enter ordinary
invocation-error retries or `onLlmError()` recovery. A handled result follows normal response
and routing behaviour; recovering does not itself complete the session.

### DecisionStep failures

`DecisionStep` uses a separate decision runner, not the chat-model failure hooks:

```text
decision provider call / answer validation
  -> eligible provider retries within the configured decision budget
  -> failure remains
       -> DecisionStep.onDecisionError(context)
       -> null: Flow.onDecisionError(context)
       -> both null: propagate the error
```

A non-null result supplies a decision recovery response or transition. Decision
`maxRetries` counts additional attempts after the first; chat `retryAttempts` counts total
attempts. Invalid decision answers are not retried.

### Errors outside model recovery

Cancellation bypasses recovery output. Errors in prompt construction, activation hooks,
token accounting, tool handlers, or exceptions thrown by `checkResponse()` or `onResponse()`
are outside the chat-model failure hooks. An unrecovered error reaches the engine's
[failure boundary](/docs/concepts/flow-lifecycle/#failure-and-recovery-lifecycle).

A tool may already have written state or caused an external effect before a later model
call fails. Recovery should inspect that state or route to review rather than repeat the
effect blindly. `onExit()` is not a general error handler: nested execution invokes it in
its cleanup path, while top-level transitions invoke it when leaving a step.

See the [Step recovery reference](/docs/reference/step/#model-refusal-retry-and-recovery-hooks)
and [DecisionStep recovery reference](/docs/reference/decision-step/#decision-failure-recovery)
for signatures, context fields, and return contracts.

## Activation summary table

| Event | `onStart` | `onEnter` | `onCrossing` | `onExit` | `onRestore` |
| --- | :---: | :---: | :---: | :---: | :---: |
| New session, initial step | yes | yes (via `onStart`) | yes (via `onStart`, with `null`) | no | no |
| Restored session, current step | no | no | no | no | yes |
| `go(Other)` — leaving step | no | no | no | yes | no |
| `go(Other)` — arriving step | no | yes | yes | no | no |
| `stay()` | no | no | no | no | no |
| `runStep(Child)` — child | no | yes | no | yes | no |
| Direct response to another step | no | yes | usually not | yes | no |

## Choosing an activation hook

Ask what the work depends on.

**Depends on the conversation being brand new** — `onStart()`. Seeding a first-turn message,
recording a conversation-start event.

**Depends on the process, not the conversation** — `onRestore()`. Rebuilding a client, warming
a cache, re-deriving a value you chose not to persist.

**Depends on the step becoming active** — `onEnter()`. Clearing memory, running a prerequisite
child, resetting stage-scoped state. Remember it fires on every activation, so make it
idempotent or accept that a user who navigates back re-runs it.

**Depends on the step going inactive** — `onExit()`. Releasing temporary resources, recording
stage duration.

**Depends on what the model should be told on arrival** — `onCrossing()`.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>If you find yourself overriding <code>run()</code> to observe a request, you almost certainly want <code>onEnter()</code> or <code>onCrossing()</code> instead. <code>run()</code> owns the model loop; an override that forgets <code>super.run(message)</code> silently disables the step.</p></div>

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/routing/">
		<span class="card__title">Routing</span>
		<span class="card__body">The transitions that trigger these hooks.</span>
	</a>
	<a class="card" href="/docs/concepts/flow-lifecycle/">
		<span class="card__title">Flow lifecycle</span>
		<span class="card__body">Where step hooks sit inside a complete invocation.</span>
	</a>
	<a class="card" href="/docs/guides/nested-execution/">
		<span class="card__title">Nested execution</span>
		<span class="card__body">runStep and runSteps in practice.</span>
	</a>
</div>
