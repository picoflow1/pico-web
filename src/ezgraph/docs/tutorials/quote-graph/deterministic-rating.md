---
layout: layouts/ezgraph.njk
title: 8. Deterministic rating
description: Validate coverage against ownership and the calendar, assemble the rating subject from node state, and compute every premium in code, with a worked example that reproduces the live replay's prices.
permalink: /ezgraph/docs/tutorials/quote-graph/deterministic-rating/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 8. Deterministic rating

No price in QuoteGraph comes from a model. `CoverageNode` validates the customer's selection,
builds a rating subject from the facts earlier stages saved, and calls a plain TypeScript rating
engine. The results are saved to `QuoteNode` before it runs. This lesson reads the coverage
handler and the engine, then reproduces the replay's premiums by hand.

## The goal

- Treat coverage selection as a policy boundary with explicit rules.
- Build rating input only from validated, committed state.
- Keep every factor and constant in one module with no EZGraph dependency.
- Seed the presentation stage with exactly the numbers it may show.

## The coverage handler

```ts
@Tool("select_coverage")
async selectCoverage(input: SelectCoverageInput): Promise<ToolResponse> {
  const state = this.graph.graphState();
  const use = state.nodes.VehicleNode?.vehicle;
  if (!use) {
    return reject("Vehicle details are missing; complete the vehicle stage first.");
  }
  const coverage: CoverageSelection = {
    liability: input.liability,
    collisionDeductible: input.collisionDeductible,
    comprehensiveDeductible: input.comprehensiveDeductible,
    extras: [...new Set(input.extras)],
    startDate: input.startDate,
  };
  const now = quoteNow();
  const error = validateCoverageSelection(coverage, use.ownership, now);
  if (error) return reject(error);
  const rating = buildRatingSubject(state.nodes);
  if ("error" in rating) return reject(rating.error);
  const tiers = RatingEngine.quoteTiers(rating.subject, coverage, now);
  this.saveState({ coverage });
  this.graph.saveNodeState(QuoteNode, { tiers });
  return go(QuoteNode).withMessage(new HumanMessage("Present the quote tiers."));
}
```

The schema has already restricted liability to three levels, each deductible to 250, 500, 1000, or
`null`, and extras to at most two of `rental` and `roadside`. The handler adds everything that
depends on other facts: ownership, the calendar, and the earlier stages.

It reads state through `this.graph.graphState()`, the invocation's materialized state, and it
writes two channels before it returns: its own `coverage`, and `QuoteNode`'s `tiers`. When
`QuoteNode` starts in the same turn, its prompt is filled from those tiers.

## Coverage rules

```ts
export function validateCoverageSelection(
  coverage: CoverageSelection,
  ownership: VehicleUse["ownership"],
  at: Date,
): string | null {
  const start = parseUtcDate(coverage.startDate);
  if (!start) return "startDate must be a real calendar date in YYYY-MM-DD form.";
  const today = utcDay(at);
  if (start < today) return "The coverage start date cannot be in the past.";
  if (start > addDays(today, 60)) return "The coverage start date must be within the next 60 days.";
  const fullCoverage =
    coverage.collisionDeductible !== null && coverage.comprehensiveDeductible !== null;
  if ((ownership === "finance" || ownership === "lease") && !fullCoverage) {
    return "A financed or leased vehicle requires both collision and comprehensive coverage; the lender mandates full coverage.";
  }
  if (coverage.collisionDeductible !== null && coverage.comprehensiveDeductible === null) {
    return "Collision coverage requires comprehensive coverage as well.";
  }
  return null;
}
```

| Rule | Why |
| --- | --- |
| the start date is a real date, from today through 60 days out | a quote is only valid for a short window |
| a financed or leased car has both collision and comprehensive | the lender owns part of the car |
| collision requires comprehensive | a common underwriting rule; comprehensive alone is allowed |

The function returns a sentence, not a code, because the sentence goes straight back to the model.
On turn 11 of the replay the customer asks to skip physical-damage coverage. `coverage.md` tells the
model about the lender rule, and it explains the rule without calling the tool. If it had
submitted liability-only anyway, this function would have refused it. The deterministic test does
exactly that: it submits liability-only for a financed car, and asserts that coverage is unsaved
and the reply mentions the lender.

## The rating subject

```ts
export function buildRatingSubject(
  nodes: QuoteGraphNodes,
): { subject: RatingSubject } | { error: string } {
  const driver = nodes.DriverNode?.driver;
  const use = nodes.VehicleNode?.vehicle;
  const history = nodes.HistoryNode?.history;
  const vehicle = use ? VehicleCatalog.fetch(use.vehicleId) : undefined;
  if (!driver || !use || !vehicle || !history) {
    return { error: "Driver, vehicle, and history details must all be captured before rating." };
  }
  return { subject: { driver, vehicle, use, history } };
}
```

The subject is assembled only from committed channels, and the vehicle is re-fetched from the
catalog by ID. Nothing the model said in conversation can reach the engine except through a
handler that validated it.

## The rating engine

`backend/rating-engine.ts` has no EZGraph imports. The monthly premium is:

```text
premium = (liability base + collision part + comprehensive part) × risk factor + extras
```

| Part | Value |
| --- | --- |
| liability base | state-minimum $52; standard $68; premium $89 |
| collision part | MSRP ÷ 1000 × 1.1 × deductible factor (omitted when collision is `null`) |
| comprehensive part | MSRP ÷ 1000 × 0.55 × deductible factor (omitted when comprehensive is `null`) |
| deductible factor | $250: 1.25; $500: 1.0; $1000: 0.8 |
| extras | rental $12; roadside $5 (added after the risk factor) |

The risk factor multiplies nine factors and is clamped between 0.5 and 4:

| Factor | Values |
| --- | --- |
| age | under 20: 1.9; under 25: 1.5; under 30: 1.2; under 65: 1.0; 65 and over: 1.1 |
| experience | fewer than 3 years licensed: 1.15; otherwise 1.0 |
| licence status | permit: 1.25; valid: 1.0 |
| vehicle | 0.9 + 0.08 × risk group (1–5) |
| mileage | up to 7,500: 0.92; up to 12,000: 1.0; up to 20,000: 1.12; more: 1.28 |
| parking | garage 0.95; driveway 1.0; street 1.07 |
| incidents | 1 + 0.35 per at-fault accident + 0.15 per violation + 0.10 per not-at-fault accident + 0.08 per comprehensive claim |
| lapse | a lapse in the past year: 1.18 |
| currently insured | 0.95 |

Premiums are rounded to cents. The engine then builds three tiers around the customer's selection:

| Tier | Liability | Deductibles | Extras |
| --- | --- | --- | --- |
| `saver` | one step down (premium → standard; otherwise state-minimum) | $1000 where the selection has coverage; none where it has none | none |
| `selected` | as chosen | as chosen | as chosen |
| `shield` | premium | $250 where the selection has coverage; $500 where it has none | rental and roadside |

## A worked example

Here is the replay's customer: Jamie Rivera, born 12 April 1993 and quoted on 1 June 2027. Ten years
licensed with a valid licence; a financed 2019 Camry SE (risk group 2, MSRP $26,000) driven 12,000
miles a year and parked in a driveway; insured, no lapse, and one speeding ticket.

**Risk factor.** Age 34 → 1.0. Experience, status, mileage, and parking → 1.0. Vehicle → 0.9 +
0.08 × 2 = 1.06. One violation → 1.15. Insured → 0.95. Product: 1.06 × 1.15 × 0.95 = **1.15805**.

**Selected tier** (standard liability, $500/$500, rental):

```text
68 + 26 × 1.1 × 1.0 + 26 × 0.55 × 1.0 = 68 + 28.60 + 14.30 = 110.90
110.90 × 1.15805 = 128.43 → + $12 rental = $140.43
```

| Tier | Base before risk | × 1.15805 | + extras | Premium |
| --- | --- | --- | --- | --- |
| Saver (state-minimum, $1000/$1000) | 52 + 22.88 + 11.44 = 86.32 | 99.96 | $0 | **$99.96** |
| Selected (standard, $500/$500, rental) | 110.90 | 128.43 | $12 | **$140.43** |
| Shield (premium, $250/$250, rental + roadside) | 89 + 35.75 + 17.875 = 142.625 | 165.17 | $17 | **$182.17** |
| Selected after the what-if ($1000/$1000) | 68 + 22.88 + 11.44 = 102.32 | 118.49 | $12 | **$130.49** |

Those are exactly the numbers in the replay's turns 13 and 14. The unit tests in
`quote-graph.spec.ts` assert the risk factor to nine decimal places and the $140.43 premium.

## Two properties to know

- **Saver and Shield do not depend on the customer's deductibles**, only on whether each coverage
  exists. That is why the what-if on turn 14 changed only the middle tier.
- **Tiers can tie.** A customer who already chose state-minimum liability, $1000 deductibles, and no
  extras gets a Saver identical to their selection. The unit test's "saver < selected < shield"
  holds for its subject, not for every customer. If distinct tiers matter, detect the tie and
  explain it, or build Saver differently.

<div class="callout warn"><span class="label">Demo rates, not a rating plan</span><p>The factors are invented to make a readable, testable example. A real rating engine is filed per state, versioned, and audited. The pattern is what carries over: a pure function of validated inputs and a date, called from one place, and tested without a model.</p></div>

## Why it is written this way

The quote changes whenever any accepted fact changes, so the relationship between facts and price
must be reproducible. A pure engine that reads only committed state makes that relationship a unit
test, not a conversation to replay. It also means `QuoteNode`'s model can explain prices fluently
without owning any pricing logic, because the prices arrive in its prompt already calculated.

## Common mistakes

- **Letting the model calculate or adjust a premium.** Put every number in code and fill it in.
- **Rating from conversation text.** Build the subject only from validated node state.
- **Validation spread across nodes.** Keep coverage rules in one function that every caller uses;
  `adjust_quote` calls the same one.
- **Returning error codes to a model.** Return a sentence it can relay.
- **Assuming tiers are always distinct.** Check the edge cases your tier rules create.

## Next

Continue to [9. Revisions, direct responses, and acceptance](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/).
