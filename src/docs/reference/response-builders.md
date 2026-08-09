---
title: "go() / stay() / direct()"
eyebrow: Reference
lede: "The three transition constructors, the ToolResponseBuilder methods they return, the order in which builder effects are applied, and what happens when a handler returns something else."
source: pf/src/picoflow/utils/tool-response.ts
---

A tool handler, a logic step, and `onResponse()` all return the same shape: a routing
target, optionally decorated with side effects to apply on the destination.

```ts
import { go, stay, direct } from "@picoflow/core";
```

```ts
type ToolResponseType = StepResponseType | StepTarget;
type StepTarget = StepClassType | string;

type StepResponseType = {
  step: StepTarget;
  tool?: string;
  message?: MessageTypes;
  prompt?: string;
  state?: JsonObject;
  contentType?: HttpContentType;
};
```

A bare `Step` class or a registered step name is a legal return value on its own. The three
functions below build the richer object form.

## go(step)

```ts
export function go(step: StepTarget): ToolResponseBuilder;
```

Constructs a transition to the supplied step. A class target is normalised through its static
`id`; a string target is trimmed.

```ts
@Tool
protected async capture_name(args: Record<string, any>) {
  this.saveState({ name: args.name });
  return go(ReviewStep);
}
```

| Argument | Result |
| --- | --- |
| A `Step` subclass with a non-empty static `id` | `{ step: FlowClass.id }` |
| A non-empty string | `{ step: trimmedName }` |
| An empty string | Throws `go() requires a non-empty Step name.` |
| Anything else | Throws `go() requires a Step constructor with a non-empty ID.` |

The name must resolve in the flow's registry when the transition is applied, otherwise
`Flow.requireStep()` throws `Step '<name>' is not defined in flow '<id>'.`

## stay(feedback?)

```ts
export function stay(feedback?: string): ToolResponseBuilder;
```

Resolves the currently executing step and returns `go(thatStep).withToolFeedback(...)`. With
no argument the feedback is `K.ToolValidated`, the string `input validated`.

```ts
@Tool
protected async capture_name(args: Record<string, any>) {
  if (!args.name.includes(" ")) return stay("Please provide a full name.");
  this.saveState({ name: args.name });
  return go(ReviewStep);
}
```

Because the destination equals the current step, `Flow.goto()` short-circuits: `onExit()` and
`onEnter()` do **not** run, and no sequence entry is added. The feedback becomes a
`ToolMessageInfo` returned to the model, which then produces its next turn.

<div class="callout callout--warning"><span class="callout__title">stay() is only valid inside a tool handler</span><p><code>stay()</code> reads the executing step from the tool-response context that <code>invokeToolHandler(...)</code> installs. Called outside a PicoFlow tool handler — from <code>onResponse()</code>, <code>runLogic()</code>, or ordinary application code — there is no such context and it throws.</p></div>

## direct(content)

```ts
export function direct(content: string | object): ToolResponseBuilder;
```

Returns an answer to the caller without a further model call. It resolves the executing step
instance, stays on it, and attaches a `DirectMessage` — an `AIMessage` carrying
`additional_kwargs.direct = true`. An object argument is `JSON.stringify`-ed.

```ts
@Tool
protected async render_chart(args: Record<string, any>) {
  const svg = ChartRenderer.render(args);
  return direct(svg).withContentType(HttpContentType.Svg);
}
```

When the runner sees a direct AI message among the tool results, it appends that message to
memory and returns its text immediately. Like `stay()`, `direct()` requires an active tool
handler context.

## ToolResponseBuilder

Every builder method returns a **new** builder, so the chain is order-independent and safe to
branch:

```ts
export type ToolResponseBuilder = StepResponseType & {
  withToolFeedback(feedback: string): ToolResponseBuilder;
  withState(state: JsonObject): ToolResponseBuilder;
  withPrompt(prompt: string): ToolResponseBuilder;
  withMessage(message: MessageTypes): ToolResponseBuilder;
  withContentType(contentType: HttpContentType): ToolResponseBuilder;
};
```

| Method | Field set | Effect |
| --- | --- | --- |
| `withToolFeedback(text)` | `tool` | The text is returned to the model as the tool result, as a `ToolMessageInfo` |
| `withState(json)` | `state` | `saveState(json)` is called on the **destination** step |
| `withPrompt(text)` | `prompt` | `saveState({ _prompt: text })` on the destination; the base `getPrompt()` returns it |
| `withMessage(message)` | `message` | The message is appended after the tool-result messages |
| `withContentType(type)` | `contentType` | Sets the destination step's `contentType` |

The builder methods are defined as non-enumerable properties, so spreading a builder yields a
plain `StepResponseType`.

```ts
return go(ReviewStep)
  .withToolFeedback("Accepted")
  .withState({ recordId })
  .withPrompt("Review the accepted record.")
  .withContentType(HttpContentType.Json);
```

## Ordering of builder effects

The runner applies one handler result in a fixed order:

```text
1. transition        goto(step) or gotoByName(step)   -> onExit(), onEnter()
2. prompt            destination.saveState({ _prompt })
3. state             destination.saveState(state)
4. contentType       destination.contentType = ...
5. tool feedback     one ToolMessageInfo per original tool call
6. message           appended after the tool messages
```

Two consequences follow. First, `withState(...)` and `withPrompt(...)` always land on the
destination, never on the step that returned them — save data the current step owns with
`this.saveState(...)` before returning. Second, because the transition happens first,
`onEnter()` on the destination runs before the prompt and state it was given, so `onEnter()`
cannot read them.

The same ordering is used by `LogicStep` results and by transition objects returned from
`onResponse()`, with one difference: those paths have no tool calls, so `tool` is ignored and
`message` is pushed onto the destination's memory directly.

## Invalid return values

A handler that is dispatched individually and returns something unusable is silently ignored
— no transition is applied and a plain success tool message is emitted. A **group** handler
registered with `@Tools([...])` is held to a stricter contract, because falling back to the
individual handlers could repeat side effects it already performed:

| Returned value | Group-handler behaviour |
| --- | --- |
| A non-empty string, or a `Step` class with a non-empty `id` | Accepted |
| An object whose `step` is one of those | Accepted |
| `null` | Throws `... returned null.` |
| `undefined` | Throws `... returned undefined.` |
| An empty string | Throws `... returned an empty step name.` |
| A number, boolean, or array | Throws `... returned an unsupported <type> result.` |
| An object with no `step` | Throws `... returned an object without step.` |
| An object whose `step` is invalid | Throws `... returned an object with an invalid step.` |

See [@Tool and @Tools](/docs/reference/decorators/) for the dispatch rules, and
[Routing with go() and stay()](/docs/tutorials/basic-flow/routing/) for a worked example.
