---
title: 4. MCP-backed hotel search
eyebrow: HotelFlow tutorial
lede: ExploreStep accepts validated conversational criteria, calls a real local MCP pricing service, and keeps durable state and routing inside PicoFlow.
source: pico-demo/src/myflow/hotel-flow/explore-step.ts, pico-demo/src/tools/hotel-pricing-contract.ts, pico-demo/src/tools/hotel-pricing-mcp-client.ts, pico-demo/src/tools/hotel-pricing-mcp-server.ts, pico-demo/src/myflow/hotel-flow/backend/pricing-engine.ts
---

`capture_choices` is where the HotelFlow conversation becomes an application
operation. The model submits one accumulated search request; `ExploreStep`
validates and persists it, calls the MCP service, and decides whether the flow
advances or stays active.

## The boundary

```text
model -> capture_choices -> ExploreStep handler -> MCP client
      -> search_hotels MCP service -> PricingEngine -> route decision
```

The model does not call MCP directly. PicoFlow owns the conversation-specific
tool, the durable `ExploreStep.state.json` payload, and the `go(...)`/`stay(...)`
decision. The MCP service owns its typed, read-only search operation. This
division means an empty search remains a normal workflow result while a service
failure is not misreported as “no hotels found.”

## A typed capture tool

The model no longer serializes a whole JSON object inside a string. It submits a
typed `criteria` object instead:

```ts
{
  name: "capture_choices",
  description:
    "Submit the complete accumulated hotel search criteria after the user asks to search.",
  schema: z.object({
    criteria: HotelSearchCriteriaSchema.describe(
      "The complete hotel search criteria accumulated from the conversation.",
    ),
  }),
}
```

`HotelSearchCriteriaSchema` requires the selected amenities and room types,
min/max budget, distance constraints, and start/end dates. The prompt still
collects those values over several turns, but schema validation now happens
before application code reads nested fields.

## The ExploreStep handler

```ts
const parsedChoices = HotelSearchCriteriaSchema.safeParse(args?.criteria);
if (!parsedChoices.success) {
  return stay("The hotel search criteria are incomplete or invalid. Collect valid dates, preferences, and distances before searching.");
}

const choices = parsedChoices.data;
const startDate = new Date(choices.cDate.start);
const endDate = new Date(choices.cDate.end);
if (Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate <= startDate) {
  return stay("The checkout date must be after a valid check-in date. Ask the user to correct their stay dates.");
}

this.saveState({ json: JSON.parse(JSON.stringify(choices)) });

let hotelEntries;
try {
  hotelEntries = await searchHotelsViaMcp(toHotelPricingSearchRequest(choices));
} catch {
  return stay("Hotel pricing is temporarily unavailable. Ask the user to try the search again.");
}
```

Validation and date ordering are business rules in code, not hopes encoded in
prompt prose. The JSON round trip before `saveState` makes the persisted value
explicitly compatible with PicoFlow’s durable JSON state.

When results exist, the handler projects exactly the view that `PresentStep`
needs and transfers ownership with `go(PresentStep).withState(...)`. When the
array is empty it returns the existing no-match `stay(...)` path.

## The MCP contract and service

The shared Zod contract maps the conversational payload to a compact service
request:

```ts
{
  startDate: string,
  endDate: string,
  amenities: string[],
  roomTypes: string[],
  budget: { min: number | null, max: number | null },
  maxDistanceMiles: { airport: number | null, cityCenter: number | null }
}
```

The stdio server registers the read-only `search_hotels` tool with both input
and output schemas:

```ts
server.registerTool("search_hotels", {
  title: "Search Portland hotels",
  inputSchema: HotelPricingSearchRequestSchema,
  outputSchema: HotelPricingSearchResponseSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
}, async (request) => {
  const hotels = await PricingEngine.searchHotel(/* mapped request fields */);
  return {
    structuredContent: { hotels },
    content: [{ type: "text", text: JSON.stringify({ hotels }) }],
  };
});
```

`structuredContent` is the machine-readable result used by the client; the text
block keeps the response compatible with clients that only consume text. The
client keeps a connection to the local stdio child process, enforces a timeout,
checks MCP tool errors, and validates returned structured content before
returning hotel rows to the step. Nest shutdown closes that client cleanly.

Run the service independently when inspecting it with an MCP client:

```bash
npm run mcp:hotel-pricing
```

The application normally starts and owns the child process lazily through the
adapter, so there is no second terminal to run for HotelFlow.

## Pricing remains plain TypeScript

The MCP server is an adapter, not a rewrite of the domain logic.
`PricingEngine.searchHotel(...)` still filters the bundled Portland catalog,
enumerates the stay, applies season/holiday/room/weekend multipliers, filters
by nightly budget, and returns `{ hotelName, prices, total }` rows.

`HotelCatalog` and `PricingEngine` still have no PicoFlow or MCP imports. That
makes the service boundary replaceable: a future server can call live inventory
without changing `ExploreStep`'s state/routing contract.

<div class="callout callout--warning"><span class="callout__title">Demo pricing, not a rate engine</span><p>The holiday fixture compares only month and day, so its 2025 floating-holiday dates recur in other years. A real booking system needs a year-aware calendar, current inventory, and reviewed pricing rules.</p></div>

## Test the boundary

```bash
npm run test:hotel-pricing-mcp
```

The suite verifies the advertised MCP tool and schemas in memory, invalid input
handling, and a real local stdio client-to-service call. The HotelFlow scenario
remains the model-driven test of criteria collection and downstream routing.

## Next

[5. Memory compaction and erasure](/docs/tutorials/hotel-flow/memory-compaction/)
looks at the conversation history that produced this tool call.
