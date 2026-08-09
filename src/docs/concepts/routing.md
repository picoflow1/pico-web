---
title: Routing
eyebrow: Concepts
lede: Transitions are return values from your code. go() advances, stay() corrects, direct() answers without another model call, and five builder methods shape what the destination receives.
source: pf/src/picoflow/utils/tool-response.ts
---

PicoFlow has no routing DSL, no edge declarations, and no conditional graph. A step's next
position is whatever its handler returns. That single decision is why control flow is
readable: the validation that decided the route and the route itself are in the same
function, three lines apart.

```ts
@Tool
protected async dob(args: Record<string, any>): Promise<ToolResponseType> {
  const date = new Date(Date.UTC(args.year, args.month - 1, args.day));
  const isValidDate =
    date.getUTCFullYear() === args.year &&
    date.getUTCMonth() === args.month - 1 &&
    date.getUTCDate() === args.day;

  if (!isValidDate) {
    return stay("That date is not valid. Ask for a valid date of birth in M/D/YYYY format.");
  }

  this.saveState({ year: args.year, month: args.month, day: args.day });
  return go(AddressStep);
}
```

## The three helpers

### go(target)

Activates another registered step and moves the flow's one durable cursor.

```ts
return go(AddressStep);          // a Step class
return go("AddressStep");        // a registered step name
```

The class form is strongly preferred: it is checked by the compiler, it survives a rename by
your IDE, and it makes the transition graph greppable. The string form exists for dynamic
routing where the target genuinely is data.

An unregistered target throws at transition time:

```text
Step 'AddressStep' is not defined in flow 'BasicFlow'.
```

`go(...)` returns a builder, so it composes with the `with...` methods below. On its own it
transitions and returns the framework's standard tool-result text to the model.

### stay(feedback?)

Keeps the current step active and hands corrective text back to the model as the tool
result.

```ts
return stay("That address is outside our service area. Ask for another one.");
```

`stay()` is implemented as `go(currentStep).withToolFeedback(feedback)`. Because the target
is already current, the transition short-circuits: no `onExit()`, no `onEnter()`, no
`onCrossing()`. The model simply sees the tool result and continues the same turn.

Without an explicit argument it uses the framework's standard validated-tool message
(`input validated`), which is the right choice when the tool succeeded and you just want the
model to carry on.

<div class="callout callout--warning"><span class="callout__title">stay() is tool-handler-only</span><p><code>stay()</code> resolves the currently executing step from an async-local scope that is established only while a PicoFlow tool handler runs. Calling it from <code>onResponse()</code>, <code>onEnter()</code>, a service, or anywhere else throws: <code>Tool response helpers can only be used while a picoflow tool handler is running.</code></p></div>

The same restriction applies to `direct()`. `go()` has no such requirement — it takes its
target explicitly.

### direct(content)

Returns content to the caller immediately, without another model call, keeping the current
step active.

```ts
return direct(`${table}\nAnother comparison or ready to book?`);
```

```ts
return direct(args?.json).withContentType(HttpContentType.Json);
```

Use it when your handler already knows the exact answer and a second model turn would only
risk paraphrasing it: a rendered comparison table, an extracted JSON document, a generated
file.

Mechanically, `direct(content)` is `go(currentStep).withMessage(new DirectMessage(step, content))`.
The runner recognises the direct marker on that message, appends it to history, and returns
its content as the turn's result instead of calling the model again.

`content` may be a string or an object. Pair an object with `.withContentType(...)` so the
HTTP layer sends it correctly — see [Your first request](/docs/get-started/first-request/).

## The builders

Every helper returns a `ToolResponseBuilder`. The five methods are chainable and each returns
a new builder rather than mutating the previous one.

| Builder | Effect |
| --- | --- |
| `withToolFeedback(text)` | Returns `text` to the model as the tool result |
| `withState(json)` | Saves the JSON on the destination step |
| `withPrompt(text)` | Saves `_prompt` on the destination step |
| `withMessage(message)` | Appends an existing LangChain message after the tool result |
| `withContentType(type)` | Sets the destination step's response content type |

```ts
return go(ReviewStep)
  .withToolFeedback("Accepted")
  .withState({ recordId })
  .withPrompt("Review the accepted record.")
  .withContentType(HttpContentType.Json);
```

### Builder effects apply to the destination, after activation

This is the detail that catches people. The runner performs the transition first, then applies
the builder:

```text
goto(destination)
  -> destination.onExit() on the old step, destination.onEnter() on the new one
  -> withPrompt  -> destination.saveState({ _prompt: text })
  -> withState   -> destination.saveState(json)
  -> withContentType -> destination.contentType = type
  -> tool-result message(s) emitted for each original tool call
  -> withMessage -> appended after the tool result
```

Two consequences:

**The destination's `onEnter()` cannot see the state you attached.** `onEnter()` has already
run by the time `withState(...)` is applied. If the destination needs the value during entry,
save it before transitioning — `flow.saveStepState(TargetStep, json)` writes another step's
durable state directly.

**`withState` and `withPrompt` are persistent writes on the destination, not turn-scoped
parameters.** They land in that step's state and stay there until overwritten. A `_prompt`
attached on one visit is still there on the next.

### withPrompt and getPrompt()

`withPrompt(text)` stores `_prompt` on the destination. The base `Step.getPrompt()` returns
that value when present, otherwise `null`. So a step that overrides `getPrompt()` must opt
in if it wants to honour transition-supplied prompts:

```ts
public getPrompt(): string {
  return super.getPrompt() ?? "The normal prompt for this step.";
}
```

Without the `super` call, the prompt attached by the transition is silently ignored.
`TerminateSessionStep` does honour it, which is how a flow customises its closing message:

```ts
return go(TerminateSessionStep).withPrompt(DemoPrompt.AbruptEnd);
```

### withToolFeedback and the model

The feedback string becomes the tool-result message the model reads before deciding what to
say next. It is instruction, not user-facing text. Write it as a directive:

```ts
return stay("The date is in the past. Ask the user for a future check-in date.");
```

Not as prose you want repeated verbatim — the model will rephrase it.

## Other legal return values

A tool handler may also return, without any builder:

| Return | Meaning |
| --- | --- |
| A `Step` class | Transition to that step |
| A registered step-name string | Transition to that step |

`onResponse()` — the hook that runs when the model replies without calling a tool — has a
parallel contract. It may return a string (the text sent to the caller) or a `Step` class,
which activates that step and continues execution in the same turn.

<div class="callout callout--warning"><span class="callout__title">A group handler must return a route</span><p>A <code>@Tools([...])</code> group handler owns the entire batch of calls, so the runner never falls back to the individual handlers. Returning <code>null</code>, <code>undefined</code>, an empty string, or an object without a valid <code>step</code> is an error, not a no-op. Return <code>stay()</code> if there is nothing to do.</p></div>

## Route from code, not prompt prose

The model chooses which tool to call. It does not choose where the conversation goes.

That separation is deliberate, and it is the main reason to define a tool at all. A prompt
that says "if the date is valid, move on to collecting the address" is a request. A handler
that returns `go(AddressStep)` is a guarantee.

Structure the two accordingly:

| Concern | Belongs in |
| --- | --- |
| Tone, phrasing, what to ask for, when to call a tool | The prompt |
| Argument shape and basic types | The Zod schema |
| Domain validation, side effects, state changes, routing | The handler |

```ts
public getPrompt(): string {
  return `Ask the user for the date of birth.
Accept common formats. A valid date must immediately trigger the 'dob' tool
with numeric year, month and day. Do not ask the user to confirm a valid date.`;
}
```

The prompt describes conversational behaviour. It says nothing about which step comes next,
because that is not the model's decision to make.

<div class="callout callout--danger"><span class="callout__title">Do not put security or final business validation in prompt text</span><p>The model can misunderstand any instruction. Tool schemas and handler code are the runtime boundary. If a rule matters — entitlement, spend limit, ownership — enforce it in the handler, where a wrong answer is a bug rather than a sampling outcome.</p></div>

### Keep the transition graph visible

Because routes are ordinary return statements, you can recover the whole graph with a search
for `go(`. Protect that property:

- prefer `go(SomeStep)` over `go(stepNameVariable)`;
- keep the number of distinct targets per step small;
- return early on failure with `stay(...)` rather than nesting;
- and let `defineSteps()` list the complete set of reachable stages.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/step-lifecycle/">
		<span class="card__title">Step lifecycle</span>
		<span class="card__body">Which hooks a transition fires, and which ones stay() skips.</span>
	</a>
	<a class="card" href="/docs/reference/response-builders/">
		<span class="card__title">go() / stay() / direct()</span>
		<span class="card__body">Full signatures and types.</span>
	</a>
	<a class="card" href="/docs/guides/tools/">
		<span class="card__title">Defining and handling tools</span>
		<span class="card__body">Schemas, decorators, and dispatch.</span>
	</a>
</div>
