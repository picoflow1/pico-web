---
title: 4. Deterministic eligibility and rating
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: Eligibility, reason codes, quote IDs, premiums, and option contents are facts computed by code from versioned fictional rules—not language-model output.
source: pico-demo/src/myflow/home-insurance-flow/rate-quote-step.ts, pico-demo/src/myflow/home-insurance-flow/backend/rating-engine.ts, pico-demo/src/myflow/home-insurance-flow/backend/quote-config.ts, pico-demo/src/myflow/home-insurance-flow/data/quote-config.json
---

The model is useful before and after a rating decision: it gathers facts,
explains a referral, and helps a customer choose. It must not decide whether an
application is eligible or manufacture money. HomeInsuranceQuoteFlow makes that
boundary a model-free `LogicStep` and a plain TypeScript rating service.

## The goal

- Load a local rules file as an explicit, validated dependency.
- Build a quote from the four authoritative input states.
- Route an eligible quote differently from a referral or unsupported location.
- Make deterministic outputs easy to test without a provider.

## The `LogicStep` boundary

`RateQuoteStep` does not call a model. It reads one state record from each input
owner, calls `RatingEngine.quote`, saves the result, and routes:

```ts
public async runLogic(): Promise<LogicResponseType> {
  const application: QuoteApplication = {
    qualification: this.requireState<Qualification>(QualificationStep, "qualification"),
    property: this.requireState<PropertyProfile>(PropertyStep, "property"),
    risk: this.requireState<RiskProfile>(RiskStep, "risk"),
    coverage: this.requireState<CoveragePreferences>(CoverageStep, "coverage"),
  };
  const quoteResult = RatingEngine.quote(application, homeInsuranceCurrentDate());
  this.saveState({ quoteResult: durableJson(quoteResult) });
  if (quoteResult.decision === "eligible") {
    return go(PresentQuoteStep).withState({ needsPresentation: true });
  }
  return go(ReferralStep).withState({
    decision: quoteResult.decision,
    reasonCodes: quoteResult.reasonCodes,
  });
}
```

`requireState(...)` turns a missing prerequisite into a programmer-visible error;
it does not ask the model to guess. A quote is calculated only after the review
tool has confirmed a complete application.

## Versioned rules, explicit outcomes

`quote-config.json` is a deliberately fictional product configuration. Its Zod
loader validates supported states, limits, factors, tiers, endorsement fees,
referral thresholds, and a `rulesVersion` at module load. `RatingEngine.quote`
returns exactly one of these shapes:

| Decision | Result | Customer path |
| --- | --- | --- |
| `eligible` | Exact quote ID, validity date, and three options | `PresentQuoteStep` |
| `referral` | Code-owned review reason codes and no premiums | `ReferralStep` |
| `unsupported` | `UNSUPPORTED_STATE` and no premiums | `ReferralStep` |

The order matters: an unsupported state is not a partially priced referral. It
has no generated option table at all.

## Money and identity belong in the engine

The calculation uses typed factors and rounds in one place. The quote identifier
is a hash of the input application plus the frozen current date:

```ts
private static money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

private static quoteId(application: QuoteApplication, currentDate: Date): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(application))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `EHI-${currentDate.toISOString().slice(0, 10).replaceAll("-", "")}-${digest}`;
}
```

Changing the deductible changes the serialized input, so it changes both the
premium and quote ID. The model can describe that fact, but it cannot choose a
different price or continue presenting an obsolete selection.

## Test the boundary without an LLM

The end-to-end test also contains deterministic service tests. They prove that
the same application yields the expected option IDs and premiums, that an
unsupported state produces no options, that an old roof produces a referral, and
that a deductible change produces a lower premium and new quote ID.

The live scenario uses credentials from `.env` and is skipped when they are unavailable.

This is the fast check for code-owned policy. The live replay in lesson 7 adds
the separate question of whether the model follows the conversation contract.

<div class="callout callout--warning"><span class="callout__title">Demo rules only</span><p>The configuration and carrier are fictional. A production insurer needs approved product rules, jurisdiction-specific disclosures, authorization, auditing, and real underwriting integrations. This example deliberately does none of those things.</p></div>

## Next

[5. Memory namespaces and expiry](/docs/tutorials/home-insurance-flow/memory-and-expiry/)
explains why the three long intake stages share history while rating has none.
