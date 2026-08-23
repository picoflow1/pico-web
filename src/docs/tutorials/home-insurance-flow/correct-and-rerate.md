---
title: 6. Correct, re-rate, and return
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: A correction travels back to the step that owns the fact. A changed deductible updates the coverage record, invalidates selection, and runs the exact rating path again.
source: pico-demo/src/myflow/home-insurance-flow/review-step.ts, pico-demo/src/myflow/home-insurance-flow/property-step.ts, pico-demo/src/myflow/home-insurance-flow/present-quote-step.ts
---

The hard part of a multi-turn quote is not collecting data once; it is making
later changes without creating a conflicting copy of the application. This flow
has two distinct change paths: a review correction before rating, and a
deductible re-rate after options exist.

## The goal

- Route a review correction to the one step that owns that data.
- Carry the customer's correction sentence across the transition.
- Return to review with the persisted record refreshed.
- Re-rate through the same deterministic boundary and clear stale selections.

## Review routes, it does not edit

`ReviewStep` exposes one correction tool with a finite owner list:

```ts
const CorrectionSectionSchema = z.enum([
  "qualification", "property", "risk", "coverage",
]);

@Tool
protected async correct_home_application(args: {
  section: z.infer<typeof CorrectionSectionSchema>;
  change: string;
}): Promise<ToolResponseType> {
  const target = {
    qualification: QualificationStep,
    property: PropertyStep,
    risk: RiskStep,
    coverage: CoverageStep,
  }[args.section];

  return go(target)
    .withState({ correctionMode: true, correctionRequest: args.change })
    .withMessage(this.getLastMessage());
}
```

The destination gets three things: its normal durable state remains in place,
`correctionMode` tells it this is a revision rather than a new interview, and
the actual user message travels with `.withMessage(...)`. The target can parse
the correction in its own prompt without ReviewStep trying to edit a property
record it does not own.

## The owner saves, then returns

The property handler validates and saves the full profile as usual, then changes
only the next cursor when it is in correction mode:

```ts
this.saveState({ property: durableJson(parsed.data) });
const correctionMode = this.getState<boolean>("correctionMode") === true;
this.removeState("correctionMode");
this.removeState("correctionRequest");
return correctionMode ? go(ReviewStep) : go(RiskStep);
```

In the live replay, the customer changes a six-year roof to four years. The
subsequent review reads `PropertyStep.property` again, so the summary now says
four years; no review-level copy had to be patched.

## A deductible change is a coverage change

Once the quote is present, the model can call a narrow, enum-validated tool:

```ts
const DeductibleSchema = z.union([
  z.literal(1000), z.literal(2500), z.literal(5000),
]);

@Tool
protected async change_home_quote_deductible(args: {
  deductible: z.infer<typeof DeductibleSchema>;
}): Promise<ToolResponseType> {
  const coverage = this.flow.getStepState<CoveragePreferences>(CoverageStep, "coverage");
  if (!coverage) throw new Error("PresentQuoteStep requires CoverageStep.coverage.");
  this.flow.saveStepState(CoverageStep, {
    coverage: durableJson({ ...coverage, deductible: args.deductible }),
  });
  this.removeState("selectedOption");
  return go(RateQuoteStep);
}
```

The code writes back to `CoverageStep`, the true owner. Then it clears the
previous selection before asking `RateQuoteStep` to produce a new quote. Since
the quote ID hashes the full application, the new quote has a different ID and
the presentation's `onEnter()` refuses to preserve an old selection.

## What this protects

| Change | Incorrect shortcut | Actual path |
| --- | --- | --- |
| Roof age | Edit the review prose or tell the model to remember it | `ReviewStep` -> `PropertyStep` -> persisted property -> `ReviewStep` |
| Deductible | Change a number in the displayed table | Update `CoverageStep` -> `RateQuoteStep` -> new deterministic result |
| Option selection | Keep an old selected ID after re-rate | Clear it, then validate against current result options |

The result is explainable: every displayed number can be traced to the current
coverage record, and every displayed application fact can be traced to its owner.

## Next

[7. Exact quote tables and response fallback](/docs/tutorials/home-insurance-flow/direct-quote-tables/)
shows how the fresh deterministic result becomes a response without inviting the
model to rewrite prices.
