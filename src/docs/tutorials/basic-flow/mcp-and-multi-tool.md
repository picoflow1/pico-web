---
title: 16. @Tools batching
eyebrow: BasicFlow tutorial
lede: WeatherStep uses a deterministic local fixture to show how a group handler combines matching model tool calls into one operation and one routing decision.
source: pico-demo/src/myflow/basic-flow/weather-step.ts, pico-demo/src/myflow/basic-flow/city-temperature-service.ts
---

`WeatherStep` is the entry step in BasicFlow and the track's `@Tools` example.
It is deliberately not an MCP integration: the hotel-pricing tutorial now owns
that realistic service-boundary example. Here, a tiny local fixture keeps the
focus on PicoFlow's group-tool dispatch.

## The goal

- Accumulate partial results and advance only when the required set is complete.
- Batch matching calls with `@Tools([...])`.
- Understand that a group handler shadows individual handlers, with no fallback.

## A deterministic backend fixture

`city-temperature-service.ts` is plain TypeScript. It maps the two aliases the
exercise supports to fixed values:

```ts
export function getCityTemperatures(cities: string[]): CityTemperature[] {
  return cities.map((city) => ({
    city,
    temperature: temperatureForCity(city),
  }));
}

function temperatureForCity(city: string): number | null {
  const normalized = city.trim().toLowerCase();
  if (normalized === "nyc") return 83;
  if (normalized === "la") return 72;
  return null;
}
```

The fixture is intentionally local and deterministic. It makes the BasicFlow
scenario reproducible while leaving MCP to the HotelFlow tutorial, where the
pricing service has real stdio transport, typed request and response contracts,
and lifecycle handling.

## The model-facing tool stays conversational

The model sees one city per `get_weather` call, because that maps naturally to
the conversation. It does not see a backend-specific batch API:

```ts
public defineTool(): ToolType[] {
  return [{
    name: "get_weather",
    description:
      "Look up one supported city. Call once with LA and once with NYC when both are supplied.",
    schema: z.object({
      cityName: z.string().describe("Supported city alias: exactly LA or NYC"),
    }),
  }];
}
```

The individual handler normalizes aliases, looks up one city, persists its
temperature, and remains active until both values exist:

```ts
const [weather] = getCityTemperatures([stateCityName]);
if (weather?.temperature !== null && weather?.temperature !== undefined) {
  this.saveState({ [`city_${stateCityName}`]: weather.temperature });

  const LA = this.getState("city_LA");
  const NYC = this.getState("city_NYC");
  return LA !== undefined && NYC !== undefined
    ? go(FooLogicStep)
    : stay(`${stateCityName} was accepted. Ask the user for the remaining city.`);
}
```

Use explicit `undefined` checks rather than truthiness: zero is a valid
temperature and must not block completion.

## The group handler

When the model emits LA and NYC in one response, PicoFlow dispatches the two
tool calls together:

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

  const weather = getCityTemperatures(cityNames);
  for (const entry of weather) {
    this.saveState({ [`city_${entry.city}`]: entry.temperature });
  }
  return go(FooLogicStep);
}
```

The handler receives raw `ToolCall[]`, validates the complete set, invokes one
backend operation, writes both state values, and returns one route. This is
the key purpose of `@Tools`: one model response can require one coherent,
application-level decision.

### Names describe types, not counts

`@Tools(["get_weather"])` matches any non-empty response whose distinct tool
name set is exactly `{get_weather}`. It can receive one call, two calls, or ten;
matching is order-independent and preserves every original call and ID.

`@Tools` is dispatch metadata only. `defineTool()` still publishes the schema
to the model.

### Shadowing has no fallback

A matching group handler wins over the individual `@Tool` handler, including
when there is only one call. If the group handler returns an invalid result,
PicoFlow throws; it does not retry through the individual handler. Group
handlers therefore must always return a usable `stay(...)`, `go(...)`, or other
routing response.

The runtime still emits a tool result for each original model call ID, even
though this handler performs one operation and chooses one route.

## Test it

The scripted BasicFlow scenario sends LA and NYC in one model response and
asserts the durable values on `WeatherStep`:

```bash
BASIC_FLOW_USE_SCRIPTED_MODEL=1 npm run test:basic-flow
```

## Next

[17. Sessions, migration, batch mode](/docs/tutorials/basic-flow/sessions-and-batch/)
explains the other meaning of batching: independent child sessions through
`spawnSteps()`.
