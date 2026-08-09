---
title: Multi-tool batch handlers
eyebrow: Guides
lede: When one model response contains several tool calls that should be processed together, a @Tools group handler takes the whole batch. It is authoritative, and it must route.
source: pf/docs/multi-tool-handlers.md
---

Use a group handler when a single model turn produces several calls whose work collapses into
one operation — two weather lookups that should be one backend request, three line items that
should be one write, a pair of documents that should be fetched together. Without it, the
runner invokes individual handlers sequentially and you do the batching yourself, badly.

## The dispatch contract

Declare the individual tool as usual, then add a group handler for the set:

```ts
import type { ToolCall } from "@langchain/core/messages/tool";
import { Tool, Tools, go, type ToolResponseType } from "@picoflow/core";

@Tool
protected async get_weather(args: Record<string, any>): Promise<ToolResponseType> {
  // Behaviour for a single call.
}

@Tools(["get_weather"])
protected async get_weather_batch(
  calls: readonly ToolCall[],
): Promise<ToolResponseType> {
  // Behaviour for one or more get_weather calls in the same response.
  return go(NextStep);
}
```

On every model response containing tool calls, the runner:

1. computes the distinct set of returned tool names;
2. looks for a `@Tools` handler registered for exactly that set;
3. if one matches, invokes it once with the full `ToolCall[]` and stops;
4. otherwise, invokes individual handlers sequentially.

## Matching is by tool type, not by call count

The names in `@Tools([...])` describe tool *types*. `@Tools(["get_weather"])` matches a
response with one `get_weather` call, two, or ten — all of them arrive in the same `calls`
array with their original arguments and `id` values.

Matching uses the distinct-name set and is order-independent. Internally the key is the
sorted, de-duplicated name list, so:

```text
@Tools(["weather", "forecast"])
  matches  [weather, forecast]
  matches  [forecast, weather]
  matches  [weather, forecast, weather]
  does NOT match  [weather]
  does NOT match  [weather, forecast, traffic]
```

The set must be exact. A response containing an extra tool type falls through to individual
dispatch, and a response missing one of the declared types does too.

Declaring the same name twice in the decorator, or declaring an empty array, throws at class
definition time:

```text
@Tools requires at least one tool name.
@Tools cannot declare tool 'get_weather' more than once.
```

## @Tools does not expose anything

The decorator is dispatch metadata only. It publishes no tool definition and offers nothing
to the model. Each constituent tool still needs:

- a `defineTool()` entry somewhere in the flow; and
- exposure on this step through `@Tool` or `useTool()`.

`WeatherStep` keeps its `@Tool get_weather` handler precisely so that the tool remains
exposed. Removing it would make the group handler unreachable, because the model would never
be offered `get_weather` in the first place.

## The group handler shadows individual handlers

A matching group handler is authoritative in every case, **including a response with a single
call**. The runner does not invoke the individual `@Tool` handler afterwards, and does not
fall back to it if the group handler declines the work.

This is deliberate. A group handler that has already performed half a batch operation must
not have its constituent calls replayed one by one.

<div class="callout callout--danger"><span class="callout__title">There is no fallback path</span><p>Returning <code>null</code> or <code>undefined</code> from a group handler to "let the individual handlers take over" does not work. It throws. If a batch cannot be processed, return a routed refusal such as <code>stay("Provide LA and NYC exactly once.")</code>.</p></div>

## Routing is required

The group handler's return value is validated before anything is applied. It must be:

- a non-empty registered step name string; or
- a `Step` constructor with a non-empty `id`; or
- an object with a valid `step` property — which is what `go()`, `stay()` and `direct()`
  produce.

Everything else throws with an explicit diagnostic:

```text
Group tool handler for [get_weather] returned null. It must return a routing result:
a non-empty step name, a Step target, or an object with a non-empty string or Step
target in its step property.
```

The route, and any `state`, `prompt`, `contentType` and `message` attached to it, are applied
**once** for the whole group. The runner still emits one tool-result message for every
original `tool_call_id`, because the provider message protocol requires each call to be
answered.

## The WeatherStep example

`WeatherStep` supports two aliases and wants a single backend request when both are asked for
in one turn:

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
    return stay("Provide LA and NYC exactly once so their weather can be compared.");
  }

  const weather = await callCityTemperatureMcpTool(cityNames);
  if (
    weather.length !== cityNames.length ||
    weather.some((entry) => entry?.temperature === null || entry?.temperature === undefined)
  ) {
    return stay("Only LA and NYC cities are allowed");
  }

  for (const entry of weather) {
    this.saveState({ [`city_${entry.city}`]: entry.temperature });
  }

  return go(FooLogicStep);
}
```

The shape generalises:

1. normalise and validate every call's arguments up front;
2. reject the whole batch with `stay(...)` if any of it is unusable;
3. perform one backend operation;
4. save each result;
5. return exactly one route.

Note step 2. Partial acceptance inside a group handler is possible but is your
responsibility — the runner applies one outcome to the whole set.

## Deciding whether you need one

| Situation | Use |
| --- | --- |
| Calls are independent and cheap | Individual `@Tool` handlers |
| Calls collapse into one backend request or transaction | `@Tools([...])` |
| Calls must all succeed or all fail | `@Tools([...])`, with validation before side effects |
| Different tool types that only ever co-occur | `@Tools(["a", "b"])` |
| Different tool types that sometimes co-occur | Individual handlers, or both — the group handler only matches the exact set |

Keeping both an individual and a group handler, as `WeatherStep` does, is the safe default:
the group handles the combined case, the individual handler covers the rest.

## Failure modes

| Message or symptom | Cause |
| --- | --- |
| `@Tools requires at least one tool name.` | Empty array in the decorator |
| `@Tools cannot declare tool 'x' more than once.` | Duplicate name in the decorator |
| `Tools '["a","b"]' are already handled by method 'y'.` | Two methods declared the same set |
| `Step 'X' has no group handler for tools 'a', 'b'.` | Internal dispatch reached the group path without a match |
| `Group tool handler ... returned undefined.` | The handler fell off the end without returning a route |
| Group handler never runs | The actual call set does not exactly match the declared set, or the tool is not exposed |
| Side effect happens twice | The handler performed work before validating, then returned `stay(...)` and was called again on the retry turn |

Related: [Defining and handling tools](/docs/guides/tools/),
[MCP tools and @Tools batching](/docs/tutorials/basic-flow/mcp-and-multi-tool/), and
[@Tool and @Tools](/docs/reference/decorators/).
