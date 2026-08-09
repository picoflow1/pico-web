---
title: 3. Calling your own backend
eyebrow: HotelFlow tutorial
lede: The catalogue and the pricing engine are plain TypeScript classes with no framework imports. One tool carries the accumulated criteria across the boundary, and the handler decides whether the search found anything.
source: picoflow-demo/src/myflow/hotel-flow/explore-step.ts, picoflow-demo/src/myflow/hotel-flow/backend/hotel-catalog.ts, picoflow-demo/src/myflow/hotel-flow/backend/pricing-engine.ts, picoflow-demo/src/myflow/hotel-flow/data/hotels.json
---

Everything up to this point has been prompt engineering. `capture_choices` is
where the conversation stops being text and starts being an application: it
parses the accumulated criteria, calls a search, and chooses between advancing
and asking again.

## The goal

- Keep domain logic in classes that import nothing from `@picoflow/core`.
- Use one capture tool for an accumulated payload instead of one tool per field.
- Return `go(...).withState(...)` on success and `stay(...)` on an empty result.
- See where the demo's validation stops short of production.

## One tool, not six

From `picoflow-demo/src/myflow/hotel-flow/explore-step.ts`:

```ts
public defineTool(): ToolType[] {
  return [
    // {
    //   name: 'capture_budget',
    //   description: 'Capture min/max budget per night',
    //   schema: z.object({
    //     min: z.number().describe('minimum per night'),
    //     max: z.number().describe('maximum per night'),
    //   }),
    // },
    // {
    //   name: 'capture_dates',
    //   description: 'Capture reservation dates',
    //   schema: z.object({
    //     days: z.array(z.date()).describe('an array of days chosen'),
    //   }),
    // },
    {
      name: "capture_choices",
      description: "Capture user choice for hotel search criteria",
      schema: z.object({
        json: z.string().describe("JSON object"),
      }),
    },
  ];
}
```

The commented-out alternatives are the design that was abandoned. Per-field
tools mean the model must decide when each one fires, and a user who says
"actually make it two beds and search" produces two tool calls whose ordering
you now have to reason about. The surviving design has the model accumulate
everything in the `HotelJSON` scaffold and hand the whole thing over once, at
the point where Task 7 says to search.

The cost is that the schema is `z.string()`. Zod validates that a string
arrived, and nothing more. The structure is enforced — loosely — by the prompt
and, properly, by whatever the handler does next.

## The handler

```ts
@Tool
protected async capture_choices(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  //do a hotel search here.
  let choices;
  try {
    choices = JSON.parse(args?.json);
  } catch (_ex) {}
  this.saveState({
    json: choices,
  });

  const startDate = choices["cDate"]["start"];
  const endDate = choices["cDate"]["end"];
  const roomType = choices["cRoomType"];
  const amenities = choices["cAmenities"];
  const maxBudget = choices["cPriceRange"]["max"] ?? null;
  const minBudget = choices["cPriceRange"]["min"] ?? null;
  const cityCenter = choices["cDistance"]["cityCenter"];
  const airport = choices["cDistance"]["airport"];

  const hotelEntries = await PricingEngine.searchHotel(
    startDate,
    endDate,
    amenities,
    roomType,
    maxBudget,
    minBudget,
    airport,
    cityCenter,
  );
  if (hotelEntries && hotelEntries.length > 0) {
    const hotelFoundInfo = hotelEntries.map((entry) => {
      return {
        hotelName: entry.hotelName,
        total: entry.total,
        prices: entry.prices,
      };
    });
    // go(...) advances to the results step and supplies its hotel state.
    return go(PresentStep).withState({
      hotelFound: hotelFoundInfo,
    });
  } else {
    // stay(...) keeps ExploreStep active and returns corrective feedback to the model.
    return stay("No hotel found, please adjust your criteria and try again.");
  }
}
```

Four responsibilities, in order: parse, persist, call the backend, route.

<div class="callout callout--warning"><span class="callout__title">Not production validation</span><p>The <code>try</code> block swallows a parse failure and leaves <code>choices</code> as <code>undefined</code>, then the very next line dereferences <code>choices["cDate"]["start"]</code>. Malformed JSON throws a <code>TypeError</code> mid-turn instead of producing a useful message. Production code should <code>return stay("...")</code> from the catch, and validate the parsed object&rsquo;s full shape — a Zod schema over the parsed value works well here — before touching nested fields.</p></div>

### The projection matters

`hotelEntries` comes back with `hotelName`, `prices`, and `total`. The handler
maps it to a new object with exactly those three fields before sending it on.
That looks redundant today, but it is the seam that keeps `PresentStep`'s
prompt from being coupled to whatever the pricing engine happens to return. The
result list is a view, and this is where the view is defined.

### go().withState() against stay()

```ts
return go(PresentStep).withState({ hotelFound: hotelFoundInfo });
```

moves the durable cursor to `PresentStep` and writes `hotelFound` into
`PresentStep`'s own state bag, where `PresentStep.getPrompt()` reads it.

```ts
return stay("No hotel found, please adjust your criteria and try again.");
```

does not move the cursor. `stay()` is implemented as `go(currentStep)` with the
text attached as tool feedback, so the sentence goes to the **model**, not the
user — the model reads it as the tool's result and, per Task 8 of `explore.md`,
loops back to Task 7 and offers to change the criteria. Phrase `stay()` text as
an instruction to a model, never as user-facing copy.

## The catalogue

`picoflow-demo/src/myflow/hotel-flow/backend/hotel-catalog.ts` is thirty lines of
filtering with no framework imports at all:

```ts
const hotels = JSON.parse(
  readFileSync(new URL('../data/hotels.json', import.meta.url), 'utf8'),
) as Hotel[];

/** Local, read-only hotel catalog for this self-contained demo flow. */
export class HotelCatalog {
  public static search(
    amenities: string[],
    roomTypes: string[],
    airport?: number,
    cityCenter?: number,
  ): Hotel[] {
    return hotels.filter((hotel) => {
      const hasAmenities = amenities.every(
        (amenity) => hotel.amenities[amenity] === true,
      );
      const hasRoomType =
        roomTypes.length === 0 ||
        roomTypes.some((roomType) => hotel.roomType.includes(roomType));
      const nearAirport =
        airport == null || (hotel.nearby.airport ?? Infinity) < airport;
      const nearCityCenter =
        cityCenter == null ||
        (hotel.nearby.cityCenter ?? Infinity) < cityCenter;

      return hasAmenities && hasRoomType && nearAirport && nearCityCenter;
    });
  }

  public static fetch(names: string[]): Hotel[] {
    const byName = new Map(hotels.map((hotel) => [hotel.name, hotel]));
    return names.flatMap((name) => {
      const hotel = byName.get(name);
      return hotel ? [hotel] : [];
    });
  }
}
```

The fixture holds thirty-two Portland-area records:

```json
{
  "name": "Hilton Portland Downtown",
  "address": "1921 SW Sixth Avenue Portland, Oregon 97204 USA",
  "amenities": {
    "nonSmoking": true,
    "digitalKey": true,
    "evCharging": true,
    "onSiteRestaurant": true,
    "fitnessCenter": true,
    "petFriendly": true,
    "meetingRoom": true,
    "connectingRooms": true
  },
  "level": 128,
  "roomType": ["one bed", "two beds", "suite"],
  "nearby": { "airport": 13, "cityCenter": 0.8 }
}
```

`level` is the nightly base price the pricing engine multiplies. `amenities` is
a sparse map — a hotel simply omits what it does not have, which is why the
filter tests `=== true` rather than truthiness, and why `GenChart` later has to
fill in the gaps before it can render a table.

Amenity matching is `every`, so amenities are an AND. Room type is `some`, so
room types are an OR. Distances are strict `<`, so asking for "airport 5" also
excludes a hotel exactly five miles out. All three are product decisions living
in code, where they can be unit-tested, rather than in prompt prose.

## The pricing engine

`PricingEngine.searchHotel` is the only entry point the step calls. It projects
the catalogue hit to `{ hotelName, basePrice }`, enumerates the requested days,
applies multipliers, filters by budget, and totals:

```ts
public static async searchHotel(
  startDate: Date,
  endDate: Date,
  amenities: string[],
  roomType: string[],
  maxBudget?: number,
  minBudget?: number,
  airport?: number,
  cityCenter?: number,
): Promise<SearchHotelEntry[]> {
  const hotels = HotelCatalog.search(
    amenities,
    roomType,
    airport,
    cityCenter,
  ).map((hotel) => {
    return {
      hotelName: hotel.name,
      basePrice: hotel.level,
    };
  });
  const hotelEntries = PricingEngine.findHotelByBudget(
    startDate,
    endDate,
    roomType[0],
    hotels,
    maxBudget,
    minBudget,
  );
  return hotelEntries;
}
```

Per-night pricing is a product of four multipliers: a seasonal one from the
month, a holiday one, a room-type one (`two beds` 1.6, `suite` 2.5), and a
weekend one of 1.15. The budget filter then rejects a hotel whose maximum
nightly price exceeds `maxBudget` or whose minimum falls below `minBudget`.

<div class="callout callout--warning"><span class="callout__title">Demo pricing, not a rate engine</span><p>The holiday table is named <code>US_PUBLIC_HOLIDAYS_2025</code> and is built from 2025 dates, but the comparison only tests day and month.<br><code>holiday.getDate() === date.getDate() &amp;&amp; holiday.getMonth() === date.getMonth()</code><br>Its adjustments therefore recur in every year, and floating holidays land on the wrong weekday outside 2025. A real booking system needs a year-aware calendar and domain-reviewed rate rules.</p></div>

<div class="callout callout--note"><span class="callout__title">Also worth reading carefully</span><p><code>findHotelByBudget</code> guards with <code>if (!basePrices &amp;&amp; basePrices.length &gt; 0)</code>. Because <code>&amp;&amp;</code> short-circuits the wrong way round here, a <code>null</code> result from <code>findPrices</code> would throw rather than be skipped. It never fires with the bundled fixture, but it is not the guard it looks like.</p></div>

Note also that `roomType[0]` is what reaches the pricing multiplier, while the
catalogue filter matched on the whole array. If a user names two acceptable
room types, they are filtered on both and priced on the first.

## Why it is written this way

Neither `HotelCatalog` nor `PricingEngine` imports anything from the framework.
They take primitives and return plain objects. Three things follow:

1. They are unit-testable without a session, a model, or an HTTP request.
2. Swapping the fixture for a real inventory service changes one file.
3. The step file stays readable — `capture_choices` is about thirty lines of
   glue, and every business rule is somewhere you can point at.

The tool handler is the trust boundary. Above it is a language model producing
a string; below it is code that has to be correct. Everything the model says is
a request, and the handler is where a request becomes a decision.

## Common mistakes

- **Trusting `JSON.parse` in a `try` with an empty `catch`.** Either handle the
  failure with `stay(...)` or let it propagate; do not continue into a
  dereference.
- **Letting Zod's schema stand in for domain validation.** `z.string()` proves
  a string arrived. It proves nothing about `cDate.start`.
- **Putting business rules in the prompt.** "Only show hotels under the budget"
  in Markdown is a suggestion. `findHotelByBudget` is a rule.
- **Writing `stay()` feedback as user-facing copy.** It is read by the model,
  which decides how to phrase the retry.
- **Passing the backend's raw shape onward.** Project it, as this handler does,
  so the next step's prompt depends on a view you control.

## Next

[4. Memory compaction and erasure](/docs/tutorials/hotel-flow/memory-compaction/)
looks at what happens to the eight turns of conversation that produced this
tool call.
