---
title: 16. MCP tools and @Tools batching
eyebrow: BasicFlow tutorial
lede: WeatherStep wraps a JSON-RPC MCP server behind an ordinary tool handler, then adds a group handler that collapses two model tool calls into one backend request.
source: picoflow-demo/src/myflow/basic-flow/weather-step.ts, picoflow-demo/src/tools/city-temperature-mcp-server.ts, picoflow-demo/src/tools/city-temperature-mcp-client.ts
---

`WeatherStep` is the busiest step in BasicFlow. It is the flow's entry point, it talks
to an external service through the Model Context Protocol, it accumulates state across
several turns, and it is the only step with a `@Tools` group handler. Everything here
builds on the tool mechanics from [lesson 4](/docs/tutorials/basic-flow/tools/).

## The goal

- Put an MCP server behind an ordinary tool handler.
- Accumulate partial results and only advance when the set is complete.
- Batch several calls of the same tool with `@Tools([...])`.
- Understand that a group handler shadows individual handlers, with no fallback.

## The MCP server

`picoflow-demo/src/tools/city-temperature-mcp-server.ts` is a real, if minimal, MCP server. It
speaks JSON-RPC 2.0 over stdio and implements the handshake methods:

```ts
switch (message.method) {
  case "initialize":   /* protocolVersion, capabilities, serverInfo */
  case "ping":
  case "tools/list":   /* one tool: get_city_temperatures */
  case "tools/call":   return handleToolCall(message);
  case "resources/list":
  case "prompts/list":
  default:             return jsonRpcError(message.id, -32601, ...);
}
```

Its single tool has a JSON Schema and a deliberately trivial implementation:

```ts
function temperatureForCity(city: string): number | null {
  const normalized = city.trim().toLowerCase();
  if (normalized === "nyc") return 83;
  if (normalized === "la") return 72;
  return null;
}
```

Run it standalone with `npm run mcp:city-temperature`, and it reads line-delimited JSON
from stdin.

## The client

`picoflow-demo/src/tools/city-temperature-mcp-client.ts` is the seam between PicoFlow and the
protocol:

```ts
export async function callCityTemperatureMcpTool(
  cities: string[],
): Promise<CityTemperature[]> {
  const response = handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "get_city_temperatures",
      arguments: { cities },
    },
  });

  if (response?.error) {
    throw new Error(response.error.message);
  }

  const content = response?.result?.content;
  const text = Array.isArray(content) ? content[0]?.text : undefined;
  if (typeof text !== "string") {
    throw new Error("City temperature MCP tool returned an invalid response.");
  }

  const parsed = JSON.parse(text) as { temperatures?: CityTemperature[] };
  if (!Array.isArray(parsed.temperatures)) {
    throw new Error("City temperature MCP tool returned no temperatures.");
  }

  return parsed.temperatures;
}
```

<div class="callout callout--note"><span class="callout__title">Note</span><p>This client calls <code>handleJsonRpcMessage</code> as a direct in-process function rather than over a stdio transport. That keeps the demo runnable and the tests hermetic. Everything above the import — the request envelope, the <code>content[0].text</code> unwrapping, the JSON re-parse — is exactly what a transport-backed client does, so swapping in a real one changes this file and nothing else.</p></div>

The unwrapping is worth noticing. MCP tool results are a content array of typed parts,
and structured data arrives as a JSON string inside a `text` part. That double encoding
is protocol, not sloppiness, and the client absorbs it so the step never sees it.

## PicoFlow does not know about MCP

There is no MCP integration in the framework, and `WeatherStep` does not declare one.
The MCP tool is not exposed to the model. What the model sees is PicoFlow's own tool:

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "get_weather",
      description:
        "Look up one supported city. Call once with LA and once with NYC when both are supplied.",
      schema: z.object({
        cityName: z
          .string()
          .describe("Supported city alias: exactly LA or NYC"),
      }),
    },
  ];
}
```

One argument, one city. The MCP tool takes an array and has different semantics. The
handler is the adapter between them, and that layering is the point: the model's tool
surface is designed for the conversation, not inherited from whatever the backend
happens to expose.

## Accumulating until complete

```ts
@Tool
protected async get_weather(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const cityName = args?.cityName;
  if (typeof cityName !== "string") {
    return stay("Only LA and NYC cities are allowed");
  }

  const stateCityName = this.normalizeCityName(cityName);
  if (stateCityName !== "LA" && stateCityName !== "NYC") {
    return stay(
      `${cityName} is unsupported. Only LA and NYC are supported. Ask the user to enter LA or NYC.`,
    );
  }

  const [weather] = await callCityTemperatureMcpTool([stateCityName]);
  if (weather?.temperature !== null && weather?.temperature !== undefined) {
    this.saveState({ [`city_${stateCityName}`]: weather.temperature });

    const LA = this.getState("city_LA");
    const NYC = this.getState("city_NYC");
    if (LA !== undefined && NYC !== undefined) {
      return go(FooLogicStep);
    } else {
      const remainingCity = stateCityName === "LA" ? "NYC" : "LA";
      return stay(
        `${stateCityName} was accepted. Ask the user for ${remainingCity}.`,
      );
    }
  } else {
    return stay("Only LA and NYC cities are allowed");
  }
}
```

Three things to take from this.

**Normalisation happens in code.** `normalizeCityName` maps `"new york city"` and
`"nyc"` to `"NYC"`, `"los angeles"` and `"la"` to `"LA"`, and returns anything else
unchanged so the guard below rejects it. The state keys are then stable —
`city_LA`, `city_NYC` — regardless of how the user typed it.

**Readiness is checked explicitly.** `LA !== undefined && NYC !== undefined`, not
`if (LA && NYC)`. Temperatures can legitimately be `0`, and a truthiness check would
block a valid zero-degree reading forever. Older internal notes describe this code as
using truthiness and flag it as a bug to fix; the current source already checks against
`undefined`.

**Partial progress persists.** If the user supplies only LA, the temperature is saved
and the step stays. The user can leave and come back tomorrow; `city_LA` is in the
session document, and supplying NYC completes the pair.

## The group handler

```ts
@Tools(["get_weather"])
protected async get_weather_batch(
  calls: readonly ToolCall[],
): Promise<ToolResponseType> {
  const cityNames = calls.map((call) => {
    const cityName = call.args?.cityName;
    return typeof cityName === "string"
      ? this.normalizeCityName(cityName)
      : undefined;
  });

  if (
    cityNames.some((cityName) => cityName !== "LA" && cityName !== "NYC") ||
    new Set(cityNames).size !== cityNames.length
  ) {
    return stay(
      "Provide LA and NYC exactly once so their weather can be compared.",
    );
  }

  const weather = await callCityTemperatureMcpTool(cityNames);
  // ... reject if any temperature is missing, or if the batch is not exactly 2

  for (const entry of weather) {
    this.saveState({ [`city_${entry.city}`]: entry.temperature });
  }

  return go(FooLogicStep);
}
```

The handler receives the raw `ToolCall[]` — names, arguments, and ids — makes **one**
MCP request for the whole batch, and returns **one** route. That is the entire reason
`@Tools` exists: when the model emits two `get_weather` calls in one response, the
individual handler would make two backend round-trips and evaluate the "are we done
yet" condition twice.

### The names describe types, not counts

`@Tools(["get_weather"])` does not mean "two weather calls". It means "a response whose
distinct tool-name set is exactly `{get_weather}`" — one call, two calls, or ten. The
decorator key is the sorted, de-duplicated name list:

```ts
function getToolNamesKey(toolNames: readonly string[]): string {
  return JSON.stringify([...new Set(toolNames)].sort());
}
```

So matching is order-independent, and `@Tools(["weather", "forecast"])` matches a
response containing both types in either order, with repeats allowed. The decorator also
rejects an empty list or a duplicated name at class-definition time.

`@Tools` is dispatch metadata only. It does not expose anything to the model — each
constituent tool still needs a `defineTool()` entry and a `@Tool` handler or a
`useTool()` selection to be offered.

## Shadowing, and the absence of a fallback

`LlmRunner.callTool` tries the group path first:

```ts
private static async callTool(
  executingStep: Step,
  flow: Flow,
  tools: ToolCall[],
): Promise<MessageTypes[]> {
  if (
    tools.length > 0 &&
    executingStep.hasToolHandler(tools.map((tool) => tool.name))
  ) {
    const result = await executingStep.invokeToolHandler(tools);
    return await LlmRunner.handleToolHandlerResult(
      executingStep,
      flow,
      tools,
      LlmRunner.requireGroupToolHandlerResult(result, tools),
    );
  }

  return await LlmRunner.callIndividualTools(executingStep, flow, tools);
}
```

<div class="callout callout--danger"><span class="callout__title">The rule that surprises people</span><p>A matching group handler shadows the individual <code>@Tool</code> handler <strong>in every case, including a response with a single call</strong>. When <code>WeatherStep</code> receives one <code>get_weather</code> call, <code>get_weather_batch</code> runs and <code>get_weather</code> does not.</p></div>

That means the individual `get_weather` handler in `WeatherStep` is effectively dead
code as long as the group handler is present. It is retained in the demo to show both
shapes side by side, and it would run if `get_weather_batch` were removed.

There is also no fallback after a group handler has been selected.
`requireGroupToolHandlerResult` validates the return value and throws on anything that
is not a route:

```text
Group tool handler for [get_weather] returned undefined. It must return a routing
result: a non-empty step name, a Step target, or an object with a non-empty string or
Step target in its step property.
```

`null`, `undefined`, an empty string, an array, and an object without a valid `step` are
all errors. The runner deliberately does **not** retry the individual handlers, because
the group handler may already have performed half of a side-effecting operation — here,
the MCP call and two state writes — and running the individual path afterwards would
repeat it.

If a batch cannot be processed, return a routed failure: `stay("...")`, which is what
`WeatherStep` does for an unsupported or duplicated city set.

## Behaviour when there is no handler at all

The individual path degrades rather than throwing:

```ts
if (executingStep.isToolAvailable(tool.name)) {
  new SessionLogger(flow.getSessionDoc()).warn(`missing tool handler: ${tool.name}`);
  toolMessage = new ToolMessageOK(executingStep, tool);
} else {
  new SessionLogger(flow.getSessionDoc()).warn(`hallucinated tool: ${tool.name}`);
  toolMessage = new ToolMessageInfo(
    executingStep, tool, `LLM hallucinates a non-existing tool: ${tool.name}`,
  );
}
```

A tool the step offers but does not handle gets an OK message and a session warning. A
tool the model invented gets told so, in the tool result, and the conversation
continues. Both write to the session document's `warn` array, which is worth checking
when a step behaves oddly.

Regardless of path, the runner emits one tool-result message per original
`tool_call_id`, because providers require it. A group handler that returns one route
still produces two tool results for two calls.

## Why it is written this way

Batching is a backend concern, not a prompt concern. The alternative — instructing the
model to make one call with an array — pushes an implementation detail of your service
into the tool schema and makes the single-city case awkward. Keeping `get_weather` as
"one city, one call" gives the model the simplest possible contract, and `@Tools` lets
the application collapse whatever the model actually emitted.

Type-set matching rather than count matching is what makes that work. The model decides
how many calls to emit; you cannot know in advance, and a handler keyed on "exactly two"
would be unreachable half the time.

Shadowing without fallback is the conservative choice. The alternative would be to let a
group handler return `null` to mean "you handle it", which reads well and is a
correctness trap: any side effect performed before the `null` happens twice.

## Common mistakes

- **Returning `null` from a group handler to request individual dispatch.** It throws.
  Return `stay(reason)` instead.
- **Assuming the individual handler runs for a single call.** It does not, if a group
  handler matches the name set.
- **Reading `@Tools(["x"])` as a count.** It is a type set, matched after
  de-duplication and sorting.
- **Exposing the backend's tool shape to the model.** The MCP tool takes an array; the
  model's tool takes one city. The handler adapts between them.
- **Using truthiness for a numeric readiness check.** `if (LA && NYC)` discards a valid
  `0`. The current code checks against `undefined`.
- **Forgetting the tool-result-per-call requirement.** The runner handles it, but it is
  why a batch of two still produces two tool messages in the transcript.

## Next

[17. Sessions, migration, batch mode](/docs/tutorials/basic-flow/sessions-and-batch/) covers
the flow-level hooks: conditional entry, restore policy, and running many sessions at
once.
