---
title: "@Tool and @Tools"
eyebrow: Reference
lede: "The two Step method decorators: how they expose tools to the model, how the runner picks a handler, why a matching group handler never falls back, and how decoration is inherited."
source: pf/src/picoflow/utils/tool-util.ts
---

Three separate concerns meet at a tool: **definition** (`defineTool()` — the name, description
and Zod schema, registered flow-wide), **exposure** (which tools this step offers the model on
this turn), and **dispatch** (which method runs when the model calls one). `@Tool` covers the
last two together, which is why it is the preferred form.

```ts
import { Tool, Tools } from "@picoflow/core";
```

Both decorators are legacy TypeScript method decorators and require
`"experimentalDecorators": true`.

## @Tool

```ts
export function Tool(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): void;
export function Tool(toolName?: string): MethodDecorator;
```

Bare `@Tool` registers the method under its own name. The method name must match a tool
registered by some `defineTool()` in the flow.

```ts
public defineTool(): ToolType[] {
  return [{
    name: "capture_name",
    description: "Validate and save a full name",
    schema: z.object({ name: z.string().min(1) }),
  }];
}

@Tool
protected async capture_name(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  this.saveState({ name: args.name.trim() });
  return go(ReviewStep);
}
```

The handler receives `toolCall.args ?? {}` and returns a `ToolResponseType`.

### @Tool("alias")

Use the argument form when the method name differs from the registered tool name:

```ts
@Tool("capture_name")
protected async saveName(args: Record<string, any>) { /* ... */ }
```

| Failure | Error |
| --- | --- |
| Applied to a static method | `@Tool can only decorate Step instance methods.` |
| Applied to a non-method member | `@Tool can only decorate methods.` |
| Given a blank alias | `@Tool requires a non-empty tool name.` |
| Two methods on one prototype claim the same tool | `Tool '<name>' is already handled by method '<method>'.` |

### useTool()

```ts
public useTool(): string[];
```

The declarative alternative for exposure only. It names tools the step should offer without
implying a handler, which is useful for a tool defined by another step or by `Flow.defineTool()`.

Exposure is the union of both mechanisms. `Step` builds the list from `useTool()` first, then
appends every decorated tool name not already present, and finally resolves each through
`flow.requireTool(name)` — so a name with no matching definition throws
`Tool '<name>' is not defined in flow '<id>'.`

A tool the step did not select is never offered, even though it exists in the flow registry.

## @Tools([...])

```ts
export function Tools(toolNames: readonly string[]): MethodDecorator;
```

Registers one method as the handler for one **exact set** of tool types returned together in a
single model response.

```ts
@Tools(["get_weather"])
protected async handleWeather(
  tools: readonly ToolCall[],
): Promise<ToolResponseType> {
  const results = await Promise.all(
    tools.map((tool) => WeatherApi.lookup(tool.args.city)),
  );
  return direct(JSON.stringify(results));
}
```

The names describe tool **types**, not call counts: `@Tools(["get_weather"])` receives one or
many `get_weather` calls in the array. Matching is order-independent — the declared names and
the response's names are deduplicated and sorted into the same lookup key.

| Failure | Error |
| --- | --- |
| Empty or non-array argument | `@Tools requires at least one tool name.` |
| A blank or non-string name | `@Tools requires non-empty tool names.` |
| A repeated name in the declaration | `@Tools cannot declare tool '<name>' more than once.` |
| Applied to a static method or a non-method | `@Tools can only decorate Step instance methods.` / `@Tools can only decorate methods.` |

<div class="callout callout--warning"><span class="callout__title">@Tools does not expose anything</span><p><code>@Tools</code> is dispatch-only. It is not read by exposure resolution, so a step whose only decorator is <code>@Tools([...])</code> offers the model no tools at all. Expose each individual tool type with <code>@Tool</code> or <code>useTool()</code> as well.</p></div>

## Dispatch precedence

For each model response containing tool calls, the runner resolves a handler in this order:

```text
1. group handler   @Tools handler whose declared set equals the set of returned tool names
2. per call:
   2a. decorated   @Tool handler for that tool name, nearest prototype first
   2b. legacy      an undecorated instance method whose name equals the tool name
   2c. none        a session warning plus an informational tool message
```

A group handler is authoritative. When one matches, individual handlers are **not** consulted,
not even for a response containing a single call — falling back could repeat side effects the
group handler already performed. It must therefore return a valid routing result; `null`,
`undefined`, and unrecognised values throw. See
[go() / stay() / direct()](/docs/reference/response-builders/) for the exact validation table.

When no handler exists at all, the runner records a session warning and returns a tool message
instead of failing the turn:

| Situation | Warning | Tool message |
| --- | --- | --- |
| Tool is exposed but has no handler | `missing tool handler: <name>` | Success, `input validated` |
| Model invented a tool the step did not expose | `hallucinated tool: <name>` | `LLM hallucinates a non-existing tool: <name>` |

## Inheritance

Decorator registrations are stored per prototype in a `WeakMap`, and lookup walks the whole
prototype chain, so decoration is inherited:

- **Exposure** is collected base-class-first, so a subclass adds to the set its parent exposed.
- **Dispatch** walks from the nearest prototype outward and then reads the method off the
  instance, so a subclass that redeclares the method by the same name overrides the behaviour
  without re-decorating.
- A subclass may decorate a *different* method for the same tool name, which shadows the
  parent's registration because the nearer prototype is found first.

## Routing requirement

Every dispatched handler must return a transition. A handler that returns nothing applies no
transition and emits a plain success tool message, which usually reads as a silent bug: the
model receives `input validated`, the step does not move, and the loop repeats.

Return `stay(...)` when the input was rejected or is still incomplete, `go(...)` when the
stage is finished, and `direct(...)` when the answer is already known and no further model
call is wanted.

For the full worked contract see [Defining and handling tools](/docs/guides/tools/) and
[Multi-tool batch handlers](/docs/guides/multi-tool-handlers/).
