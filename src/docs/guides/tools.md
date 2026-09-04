---
title: Defining and handling tools
eyebrow: Guides
lede: Tools are where a model's intent becomes your code's decision. Define them once per flow, expose them per step, and always return a transition.
source: pico-demo/docs/step-authoring-contract.md
---

Use this when adding a capability the model can invoke: capturing validated input, calling a
backend, uploading a file, ending a conversation. The mechanics are small, but three separate
concerns are easy to conflate.

## Definition, exposure and dispatch are three different things

| Concern | Mechanism | Scope |
| --- | --- | --- |
| Definition | `defineTool()` on a step or on the flow | Flow-wide registry, built once at bootstrap |
| Exposure | `@Tool`-decorated methods plus names in `useTool()` | Per step, per model call |
| Dispatch | The `@Tool`-decorated method, or a method whose name equals the tool name | Per step |

A tool that is defined but never exposed is invisible to every model call. A tool that is
exposed but has no handler produces a session warning and an empty-success tool result.
`@Tool` covers exposure and dispatch together, which is why it is the preferred form.

## Define once per flow

`defineTool()` returns `ToolType[]`. The schema must be a Zod object.

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "user_name",
      description: "Capture name of user",
      schema: z.object({
        name: z.string().min(3).describe("Complete first and last name"),
      }),
    },
  ];
}
```

Definitions from every registered step and from `Flow.defineTool()` are merged into one
registry. **Tool names must be unique across the entire flow.** A collision throws at
bootstrap, before any model call:

```text
Duplicate tool 'user_name' registered in flow 'BasicFlow'.
```

Put a definition on `Flow` when several steps need the same name and schema; put it on the
step when only that step uses it. There is no way to scope two different schemas to the same
name in one flow — rename one of them.

### Writing schemas the model can follow

The schema is the runtime contract and, in practice, most of the instruction. Use
`.describe()` on every field; providers surface those descriptions to the model.

```ts
schema: z.object({
  year: z.number().int().min(1900).max(2100).describe("Four-digit year"),
  month: z.number().int().min(1).max(12).describe("Calendar month, 1 through 12"),
  day: z.number().int().min(1).max(31).describe("Calendar day, 1 through 31"),
}),
```

Handlers still receive `Record<string, any>`. Constraints in the schema guide the model, but
your handler is the boundary that decides. `DOBStep` re-checks that the three numbers form a
real calendar date after the schema has already bounded each one.

## @Tool and @Tool("alias")

Use bare `@Tool` when the method name equals the tool name:

```ts
@Tool
protected async user_name(args: Record<string, any>): Promise<ToolResponseType> {
  // ...
}
```

Use the alias form when they differ — for example when the tool name is snake_case for the
model but the method follows your codebase style:

```ts
@Tool("capture_name")
protected async saveName(args: Record<string, any>): Promise<ToolResponseType> {
  // ...
}
```

Decorators register against the prototype and are resolved by walking the prototype chain, so
handlers are inherited. A subclass can reuse a parent's handler or override the method to
replace it. Declaring two different methods for the same tool name on one class throws:

```text
Tool 'capture_name' is already handled by method 'saveName'.
```

### useTool() and undecorated handlers

`useTool()` returns tool names this step should expose without a decorator — typically a tool
defined by `Flow.defineTool()` and shared:

```ts
public useTool(): string[] {
  return ["lookup_customer"];
}
```

Dispatch then falls back to a method on the step whose name equals the tool name, even
without a decorator. This is the legacy path; prefer `@Tool` because it keeps exposure and
dispatch in one place. The exposed set is the union of `useTool()` and every decorated tool
name, deduplicated.

## Return a semantic transition

A handler normally returns a `ToolResponseType`: a step class, a registered step-name string,
or a builder from `go()` / `stay()` / `direct()`.

```ts
@Tool
protected async user_name(args: Record<string, any>): Promise<ToolResponseType> {
  const name = typeof args?.name === "string" ? args.name.trim() : "";

  if (name.toLowerCase() === "john doe") {
    return stay("Cannot accept John Doe, please choose a different name.");
  }

  this.saveState({ name });
  return go(DOBStep);
}
```

| Builder | Effect, applied after the destination is activated |
| --- | --- |
| `withToolFeedback(text)` | Text returned to the model as the tool result |
| `withState(json)` | Saved on the destination step |
| `withPrompt(text)` | Saved as `_prompt` on the destination step |
| `withMessage(message)` | Appended after the tool-result message |
| `withContentType(type)` | Sets the destination's response content type |

```ts
return go(TerminateSessionStep)
  .withPrompt(DemoPrompt.FromAddressEnd)
  .withState({ fromAddress: 5 });
```

`stay(feedback?)` resolves the currently executing step and returns `go(ThatStep)` with the
feedback attached. Without an argument it uses the framework's standard `input validated`
message. It is valid **only** inside a tool handler, because it reads the tool-response
execution context.

`direct(content)` returns an AI message straight to the caller and skips a further model
call, while keeping the current step active:

```ts
return direct(`${table}\nAnother comparison or ready to book?`);
```

```ts
this.flow.markCompleted();
return direct(args?.json).withContentType(HttpContentType.Json);
```

### Return data from a parallel child

Inside a child launched by `runSteps()`, a tool handler can return
`directResult(value)`. It ends that child after the tool call—without another model call or a
cursor transition—and places a JSON value at the corresponding `batch.fulfilled[*].output`.
It is intentionally only for `runSteps()` children; `go()`, `stay()`, and `direct()` still
throw there because they would attempt a transition in the parent's execution frame.

```ts
@Tool
protected async lookup_inventory(): Promise<ToolResponseType> {
  const item = await this.inventory.lookup(this.getParallelInvocation().params.sku);
  this.saveState({ checked: true });
  return directResult({ sku: item.sku, available: item.available });
}

// Parent step
const batch = await this.runSteps([{ step: InventoryLookupStep, params: { sku } }]);
const result = batch.fulfilled[0]?.output;
```

`value` must be JSON-compatible: a string, number, boolean, `null`, array, or object. It is
not a replacement for `direct()`, which remains the normal user-facing response builder.

<div class="callout callout--warning"><span class="callout__title">Every handler must return something routable</span><p>A handler that returns <code>null</code>, <code>undefined</code>, or an object without a <code>step</code> leaves the runner with nothing to apply. For single-tool handlers this produces no tool-result message; for group <code>@Tools</code> handlers it throws. Use <code>stay()</code> when the answer is "remain here".</p></div>

## Missing handlers and hallucinated tools

The runner distinguishes three cases when a model calls a tool:

| Case | Behaviour |
| --- | --- |
| Exposed and handled | Handler runs; its transition and builders are applied |
| Exposed, no handler found | Session warning `missing tool handler: x`; an empty-success tool result is returned |
| Not exposed by this step | Session warning `hallucinated tool: x`; the model is told the tool does not exist |

Neither case aborts the turn. Check the session document's `warn` array when a model appears
to call a tool that "does nothing".

## Failure modes

| Symptom | Cause |
| --- | --- |
| `Duplicate tool 'x' registered in flow 'Y'.` | Two `defineTool()` results share a name |
| `Tool 'x' is already handled by method 'y'.` | Two decorated methods claim the same tool name |
| `Tool 'x' is not defined in flow 'Y'.` | `useTool()` names a tool that no `defineTool()` declared |
| `@Tool can only decorate methods.` | The decorator was applied to a property or a static member |
| Model never calls the tool | It is defined but not exposed — no `@Tool`, and not in `useTool()` |
| Handler runs but nothing changes | It returned a non-routable value; use `stay()` or `go()` |
| `stay()` throws outside a handler | It requires the tool-response execution context |

Next: [Multi-tool batch handlers](/docs/guides/multi-tool-handlers/) for a single response
containing several calls, and [Structured output and responses](/docs/guides/structured-output/)
for the no-tool path. Reference: [@Tool and @Tools](/docs/reference/decorators/) and
[go() / stay() / direct()](/docs/reference/response-builders/).
