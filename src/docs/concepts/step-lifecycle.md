---
title: Step lifecycle
eyebrow: Concepts
lede: Four scenarios — new session, restored session, top-level transition, and nested execution — and exactly which of onStart, onRestore, onEnter, onExit and onCrossing fires in each.
source: picoflow-demo/docs/step-authoring-contract.md
---

Five hooks decide when a step gets to prepare itself. They look similar and they are not
interchangeable. The rule that resolves almost every question is: **entry hooks fire on
activation, restore fires on rehydration, and crossing fires on message hand-off** — and
those are three different events.

## The five hooks

| Hook | Visibility | Default behaviour |
| --- | --- | --- |
| `onStart()` | public | Calls `onEnter()`, then returns `onCrossing(null)` |
| `onRestore()` | public | No operation |
| `onEnter()` | protected | No operation |
| `onExit()` | protected | No operation |
| `onCrossing(message, priorStep?)` | public | Synthesises a `HumanMessageEx("Start")` when there is no incoming message and the last message in this namespace did not come from this step; otherwise passes the message through |

## Scenario 1: new session

A request arrives with no session ID, or with an ID that is missing, expired, completed or
aborted.

```text
Flow creates step documents, currentStep = initialStep()
  -> initialStep.onStart()
       -> onEnter()
       -> onCrossing(null)
  -> the resulting message is pushed into the step's memory namespace
  -> session is saved
  -> Step.run(userMessage)
       -> getPrompt()
       -> obtain selected tools
       -> structOutputSchema()
       -> model call
            -> tool calls: @Tool handler -> stay/go -> continue or cross
            -> no tool call: checkResponse() -> onResponse()
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

`runSteps([...])` creates one independent frame per child and joins them with `Promise.all`.
It rejects duplicate step classes.

<div class="callout callout--warning"><span class="callout__title">Nested execution is not a cross-step transition</span><p>The child is called directly, so <code>onCrossing()</code> is not invoked for it. Pass an explicit <code>userMessage</code>, or do the child's setup in <code>onEnter()</code>. Do not assume its <code>onCrossing()</code> will synthesise a starting message.</p></div>

Children may call `saveState()`, and that state persists with the turn. They may not call
`goto()`:

```text
Cannot goto 'SomeStep' from a child execution frame.
Return a result to the owning step instead.
```

Transition authority belongs to the owner. Parallel children sharing one memory namespace
will interleave their history writes, so isolate namespaces unless interleaving is what you
want.

## Summary table

| Event | `onStart` | `onEnter` | `onCrossing` | `onExit` | `onRestore` |
| --- | :---: | :---: | :---: | :---: | :---: |
| New session, initial step | yes | yes (via `onStart`) | yes (via `onStart`, with `null`) | no | no |
| Restored session, current step | no | no | no | no | yes |
| `go(Other)` — leaving step | no | no | no | yes | no |
| `go(Other)` — arriving step | no | yes | yes | no | no |
| `stay()` | no | no | no | no | no |
| `runStep(Child)` — child | no | yes | no | yes | no |
| Direct response to another step | no | yes | usually not | yes | no |

## Choosing a hook

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
