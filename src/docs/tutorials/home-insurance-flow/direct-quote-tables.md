---
title: 7. Exact quote tables and response fallback
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: Quote options and comparisons are rendered by code. Tool requests use `direct(...)` to skip another model call, while the initial logic-to-step crossing has an explicit deterministic fallback.
source: pico-demo/src/myflow/home-insurance-flow/present-quote-step.ts, pico-demo/src/myflow/home-insurance-flow/backend/quote-presenter.ts
---

Once money exists, presentation must preserve it exactly. `QuotePresenter` turns
the code-owned `QuoteResult` into Markdown; `PresentQuoteStep` decides when to
return that Markdown directly and when to navigate to another stage.

## The goal

- Render option and comparison tables from typed quote data.
- Use `direct(...)` from a tool handler to answer without a second model call.
- Validate requested option IDs against the current quote.
- Cover the initial presentation path, which has no user tool call yet.

## One deterministic renderer

`QuotePresenter.options(result)` formats the initial table. It includes the quote
ID, annual and monthly amounts, all option fields, the validity date, rules
version, and the non-binding disclosure. `comparison(options)` formats a smaller
table from the already calculated options. Both use the same `Intl.NumberFormat`
currency formatter, so no prompt is responsible for punctuation, rounding, or a
price calculation.

```ts
public static options(result: QuoteResult): string {
  return [
    `### Preliminary home insurance quote ${result.quoteId}`,
    "",
    "| Option | Annual premium | Monthly estimate | Dwelling | Extension | Deductible | Liability | Endorsements |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...result.options.map((option) => this.row(option)),
    "",
    `Valid through ${result.validThrough} under demo rules ${result.rulesVersion}. This is a non-binding estimate, not proof of insurance or an offer to bind coverage.`,
  ].join("\\n");
}
```

## Direct responses for user-initiated actions

When the model correctly selects a presentation tool, the tool handler returns
the exact text with `direct(...)`:

```ts
@Tool
protected async compare_home_quote_options(args: {
  optionIds: string[];
}): Promise<ToolResponseType> {
  const result = this.quoteResult();
  const requested = [...new Set(args.optionIds.map((id) => id.trim().toUpperCase()))];
  const options = requested.flatMap((id) => {
    const option = result.options.find((candidate) => candidate.id === id);
    return option ? [option] : [];
  });
  if (options.length !== requested.length) {
    return stay(`Choose only current option IDs: ${result.options.map((option) => option.id).join(", ")}.`);
  }
  return direct(QuotePresenter.comparison(options));
}
```

`direct(...)` is deliberately tool-only: it returns a user response while keeping
the current step active, with no second LLM call that could alter dollar figures.
The same pattern powers `show_home_quote_options`.

## The initial crossing is different

The first table is requested by `RateQuoteStep`, a `LogicStep`, not by a model
tool call. `PresentQuoteStep.onCrossing()` gives that entry a synthetic message
asking it to show the exact options. Its `onResponse()` also handles the explicit
state flag as a deterministic fallback:

```ts
public override async onResponse(llmResult: string | object) {
  if (this.getState<boolean>("needsPresentation")) {
    this.removeState("needsPresentation");
    return QuotePresenter.options(this.quoteResult());
  }
  return super.onResponse(llmResult);
}
```

The fallback returns a string, not `direct(...)`, because it is outside a tool
handler. It ensures that the first quote table remains code-authored even if the
provider replies with prose instead of emitting `show_home_quote_options`.

## The current quote is the only quote

`onEnter()` compares `presentedQuoteId` with the latest calculated ID and clears
`selectedOption` when they differ. The selection tool then validates its input
against the current `result.options`. That paired check prevents a stale option
ID from becoming a contact request after a deductible re-rate.

```ts
const option = result.options.find(
  (candidate) => candidate.id === args.optionId.trim().toUpperCase(),
);
if (!option) {
  return stay(`Choose one current option ID: ${result.options.map((candidate) => candidate.id).join(", ")}.`);
}
this.saveState({ selectedOption: durableJson(option) });
return go(ContactStep);
```

## Next

Return to [the track overview](/docs/tutorials/home-insurance-flow/) or revisit
[the live replay](/docs/tutorials/home-insurance-flow/live-replay/) to connect
this response boundary to the complete interaction.
