---
title: 7. Answering without an LLM
eyebrow: HotelFlow tutorial
lede: A comparison table is data, not prose. CompareStep renders one in TypeScript and returns it with direct(), which ends the turn without a second model call and leaves the cursor where it was.
source: pico-demo/src/myflow/hotel-flow/compare-step.ts, pico-demo/src/myflow/hotel-flow/gen-chart.ts, pico-demo/src/myflow/hotel-flow/prompt/compare.md
---

Once the model has decided which hotels and which feature, there is nothing
left for it to do. The numbers come from state, the layout is fixed, and asking
a language model to format a table is a good way to get a table with a wrong
number in it. `direct()` is the escape hatch: the handler returns finished
content, the runner returns it verbatim, and the turn ends.

## The goal

- Return deterministic, pre-rendered content from a tool handler with
  `direct()`.
- Understand why the cursor stays on the current step.
- Assemble a comparison row from three different steps' state.
- Know when a `direct()` response is the right answer and when it is not.

## What direct() is

The whole implementation, from the framework:

```ts
/**
 * Return a direct AI message while keeping the currently executing Step active.
 * Valid only inside a PicoFlow tool handler.
 */
export function direct(content: string | object): ToolResponseBuilder {
  const step = getToolResponseStepInstance();
  return go(step.getName()).withMessage(new DirectMessage(step, content));
}
```

Three facts follow from those two lines.

**It is `go(self)`.** The target is the currently executing step, resolved from
an async-local scope. `flow.gotoByName` short-circuits when the target is
already the current step, so no `onExit`, no `onEnter`, and no cursor movement.
For `CompareStep` that specifically means `eraseMemory()` does not fire between
comparisons.

**It only works inside a tool handler.** The step is read from an
`AsyncLocalStorage` scope that the tool runner establishes. Calling `direct()`
from `onResponse()` or `getPrompt()` throws.

**The content is a marked message.** `DirectMessage` is an AI message carrying
`additional_kwargs.direct = true`, and it stringifies objects:

```ts
export class DirectMessage extends AiMessageEx {
  constructor(step: Step, content: string | object) {
    if (typeof content === 'object') {
      super(step, JSON.stringify(content), { direct: true });
    } else {
      super(step, content, { direct: true });
    }
  }
}
```

The runner looks for that flag after processing tool responses:

```ts
//find the Ai Message that is direct.
for (const msg of toolResponseMessages) {
  if (msg.type === 'ai') {
    const direct = msg.additional_kwargs['direct'];
    if (direct) {
      history.push(msg);
      //return, do not make another LLM call
      return MessageUtil.contentToText(msg.content);
    }
  }
}
```

The message is appended to the step's history — so the next turn's model call
sees the table it produced — and returned to the caller. No second inference.

## Assembling the row

From `pico-demo/src/myflow/hotel-flow/compare-step.ts`, the handler that produces
the table:

```ts
@Tool
protected async generate_comparison(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  //perform a hotel search
  let chosenHotels;
  try {
    chosenHotels = JSON.parse(args?.hotels);
  } catch (_e) {
    chosenHotels = args?.hotels;
  }

  this.saveState({ compare_hotel: chosenHotels });

  const feature = args?.feature;

  //find the full hotel doc from DB
  const fetchHotels = (await PricingEngine.fetchHotels(
    chosenHotels,
  )) as object[];

  //merge the price into the chosenHotels JSON
  const hotelAvailable = this.flow.getStepState(
    PresentStep,
    "hotelFound",
  ) as object[];
  ...
}
```

The tool schema declares `hotels: z.array(z.string())`, but the handler still
tries `JSON.parse` first and falls back to the raw argument. That is defensive
coding against a model that sometimes sends a JSON-encoded array in a field
typed as an array — worth knowing about, and worth writing as an explicit
normalisation step rather than a bare `try`/`catch` in your own code.

A comparison row is then built per hotel, and where the values come from
depends on the feature:

```ts
if (feature === "amenities") {
  merge(myFeatures, GenChart.flattenObject(doc["amenities"]));
} else if (feature === "roomType") {
  merge(myFeatures, GenChart.transRoomType(doc["roomType"]));
} else if (feature === "distance") {
  merge(myFeatures, { cityCenter: `${doc["cityCenter"]} mi` });
  merge(myFeatures, { airport: `${doc["airport"]} mi` });
} else if (feature === "price") {
  const tree = this.flow.getStepState<{ cDateArray: string[] }>(
    ExploreStep,
    "json",
  );
  const dates = tree["cDateArray"];
  const prices = aHotel["prices"];
  const jObject = GenChart.createJsonObject(dates, prices);
  merge(myFeatures, jObject);
  merge(myFeatures, {
    total: GenChart.formatCurrency(aHotel["total"]),
  });
}
```

The `price` branch is the interesting one. It reads three steps in one
expression:

| Source | Value | Where it came from |
| --- | --- | --- |
| `PricingEngine.fetchHotels` | full catalogue record | `data/hotels.json` |
| `PresentStep.state.hotelFound` | daily `prices`, `total` | the original search, four steps ago |
| `ExploreStep.state.json.cDateArray` | the individual stay dates | the model's accumulated scaffold |

`cDateArray` is the reason Task 2 of `explore.md` insists — "Important! You
must figure out individual days" — on enumerating the dates rather than only
capturing a range. Those strings become the table's column labels, zipped
against the price array:

```ts
public static createJsonObject(
  dates: string[],
  values: number[],
): { [key: string]: string } {
  const result: { [key: string]: string } = {};

  for (let i = 0; i < dates.length; i++) {
    result[dates[i]] = this.formatCurrency(values[i]);
  }

  return result;
}
```

Currency formatting is `Intl.NumberFormat` with `en-US` and `USD`, in code —
not a prompt instruction to "format as US currency", which is exactly the sort
of thing a model gets right nine times in ten.

## Normalising sparse data

`hotels.json` omits amenities a hotel does not have, so two hotels compared on
amenities can have different key sets. `GenChart.transAmenities` unions the
keys and fills the gaps:

```ts
public static transAmenities(hotels: object[]) {
  // Step 1: Gather all unique keys from all hotel objects
  const allKeys = new Set<string>();

  hotels.forEach((hotel) => {
    Object.keys(hotel).forEach((key) => allKeys.add(key));
  });

  // Step 2: Transform each hotel object to ensure all keys are present
  return hotels.map((hotel) => {
    const transformedHotel = { ...hotel };

    allKeys.forEach((key) => {
      if (transformedHotel[key] === undefined) {
        transformedHotel[key] = '❌';
      } else {
        transformedHotel[key] =
          transformedHotel[key] === true
            ? '✅'
            : transformedHotel[key] === false
              ? '❌'
              : transformedHotel[key];
      }
    });

    return transformedHotel;
  });
}
```

Every row now has the same keys, which is a precondition for `getChart` — it
takes the key list from the first object only.

## Rendering the table

`GenChart.getChart` emits GitHub-flavoured Markdown with padded cells:

```ts
let table =
  '| ' +
  'Features'.padEnd(columnWidths[0]) +
  ' | ' +
  jsonObjects
    .map((_, index) => `Hotel ${index + 1}`.padEnd(columnWidths[index + 1]))
    .join(' | ') +
  ' |\n';
table +=
  '| ' +
  columnWidths.map((width) => '-'.repeat(width)).join(' | ') +
  ' |\n';
```

Columns are headed `Hotel 1`, `Hotel 2`, and so on, and the first column is
`Features`. Rows are one per key.

<div class="callout callout--note"><span class="callout__title">Padding is approximate</span><p>Value cells are padded with <code>value.padEnd(columnWidths[1])</code> for every column, not <code>columnWidths[index + 1]</code>. Markdown renderers do not care about cell alignment, so the table displays correctly — but the raw text is not aligned the way the code appears to intend.</p></div>

## The return

```ts
this.saveState({ chosen_hotels: finalHotels });

//produce a comparison chart
const table = GenChart.getChart(finalHotels);

// direct(...) returns this table without another model call and keeps CompareStep active.
return direct(`${table}\nAnother comparison or ready to book?`);
```

Two things happen on the way out. The selected names remain in `compare_hotel`,
which is the key `getPrompt()` reads for the first comparison. The enriched rows
are saved as `chosen_hotels` as a fallback for later turns, so the *next* turn's
prompt still renders a non-empty `ChosenHotels` and `compare.md`'s State 2 rules
let the user say "compare on amenities" without naming hotels again. The table
plus a follow-up question are returned directly.

The follow-up question is part of the string because there is no model call to
generate one. Anything a `direct()` response should say has to be in the
content you build.

## Why it is written this way

The alternative is to hand the enriched JSON back to the model as tool feedback
and let it write the table. That costs a second inference per comparison, adds
latency, and puts arithmetic in front of a component that does not do
arithmetic. Prices are already computed. Amenity flags are already booleans.
There is no judgement left to apply.

The general rule: use `direct()` when the answer is fully determined by data
you already hold. Keep the model in the loop when the answer needs
interpretation, tone, or a decision. `CompareStep` uses the model for exactly
the parts that need it — resolving "compare 2, 5 and 8 on price" into hotel
names and one feature — and then gets out of the way.

`direct()` is also the same mechanism InvoiceFlow uses to return raw JSON with
an `application/json` content type, which is covered in
[InvoiceFlow lesson 5](/docs/tutorials/invoice-flow/json-and-batch/).

## Common mistakes

- **Calling `direct()` outside a tool handler.** The async-local scope is not
  established, and it throws.
- **Expecting `onEnter()` to run afterwards.** The target is the current step,
  so `goto` short-circuits and no lifecycle hook fires.
- **Forgetting the follow-up prompt.** No model call means no conversational
  glue unless you write it into the content.
- **Rendering rows with mismatched keys.** `getChart` reads the key list from
  the first object only; normalise first, as `transAmenities` does.
- **Using `direct()` where judgement is needed.** It bypasses the model
  entirely; if the answer depends on how the user asked, keep the model.

## Next

[8. Present and book](/docs/tutorials/hotel-flow/present-and-book/) closes the loop
with the presentation prompt, a generated confirmation number, and the terminal
step.
