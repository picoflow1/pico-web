---
title: 2. Designing a quote journey
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: A home quote is not a single prompt. It is a series of jobs with distinct facts, decisions, and safety boundaries, so each job becomes a reachable step.
source: pico-demo/src/myflow/home-insurance-flow/home-insurance-flow.ts, pico-demo/src/myflow/home-insurance-flow/home-insurance-types.ts
---

Before writing a prompt, split the journey where the assistant's job changes.
For a preliminary home quote, collecting a roof age is a different job from
calculating a premium; asking for contact consent is different again. Those seams
make a graph that is easier to review and safer to change.

## The goal

- Register every reachable stage in one `Flow` subclass.
- Give each durable business fact one owning step.
- Separate model-led collection from code-led eligibility and rating.
- Make correction and exit paths visible before prompt work starts.

## The journey

```text
qualification -> property -> risk -> coverage -> review -> rate
      ^             ^          ^         ^          |         |
      +-------------+----------+---------+          |         +-- referral
                                                   confirm
                                                     |
                                                     v
                                                present quote
                                                /      |      \
                                          compare   re-rate  select
                                                       |       |
                                                       +-------+
                                                           |
                                                        consent
                                                           |
                                                        complete
```

The arrows are not an aspirational diagram. Each is a `go(...)`, `stay(...)`, or
`direct(...)` result from a tool handler. `RateQuoteStep` is deliberately a
`LogicStep`: once review confirms the inputs, the model is no longer in the
decision path.

## The flow registry

The entire registration policy is in
[`home-insurance-flow.ts`](https://github.com/picoflowio/pico-demo/blob/main/src/myflow/home-insurance-flow/home-insurance-flow.ts):

```ts
protected defineSteps(): Step[] {
  return [
    new QualificationStep(this).useMemory("home-quote-intake"),
    new PropertyStep(this).useMemory("home-quote-intake"),
    new RiskStep(this).useMemory("home-quote-intake"),
    new CoverageStep(this).useMemory("home-quote-coverage"),
    new ReviewStep(this).useMemory("home-quote-review"),
    new RateQuoteStep(this),
    new PresentQuoteStep(this).useMemory("home-quote-options"),
    new ContactStep(this).useMemory("home-quote-contact"),
    new ReferralStep(this).useMemory("home-quote-referral"),
    new TerminateSessionStep(this).useMemory("home-quote-terminal"),
  ];
}
```

The first registered step is the default entry point, so `QualificationStep`
opens a new session. Registration is also a reachability list: a step omitted
here cannot be a target of `go(...)`. The built-in `TerminateSessionStep` still
must be registered because this flow routes to it explicitly.

## One owner for every fact

The session document stores state per step. The flow avoids an application-wide
mutable object; the review and rating stages read the authoritative state bags.

| Fact | Owner | Why this is its boundary |
| --- | --- | --- |
| State, ZIP, occupancy, effective date | `QualificationStep` | It can immediately reject unsupported states or invalid dates. |
| Building, roof, systems | `PropertyStep` | These are a single validated property profile and can be corrected together. |
| Claims, hazards, protections | `RiskStep` | Risk questions share a vocabulary and validation boundary. |
| Dwelling limit, deductible, liability, endorsements | `CoverageStep` | A deductible change is a new coverage preference, not a presentation preference. |
| Quote result | `RateQuoteStep` | Quote identity and numbers are calculated once from the four input owners. |
| Presented quote ID and selected option | `PresentQuoteStep` | Selection is valid only against the current quoted option set. |
| Consent and optional contact details | `ContactStep` | Contact fields cannot be collected before the customer consents. |

`ReviewStep` owns neither a duplicate application nor the quote. It reads all
four input owners, makes them visible, and sends a correction back to the exact
owner. That is what prevents a review summary from becoming a stale shadow copy.

## A narrow stage is still a step

`RateQuoteStep` does not need a prompt or chat memory. It builds a typed
application, saves a durable result, and routes by the code-owned decision:

```ts
const quoteResult = RatingEngine.quote(application, homeInsuranceCurrentDate());
this.saveState({ quoteResult: durableJson(quoteResult) });

if (quoteResult.decision === "eligible") {
  return go(PresentQuoteStep).withState({ needsPresentation: true });
}
return go(ReferralStep).withState({
  decision: quoteResult.decision,
  reasonCodes: quoteResult.reasonCodes,
});
```

`withState(...)` writes to the destination step. `needsPresentation` therefore
belongs to `PresentQuoteStep`, where it triggers the exact initial table. The
quote result remains on its actual owner, `RateQuoteStep`.

## Design checks before coding

- A correction should return to the owner of the fact, never edit a review copy.
- A premium must have one calculation path, independent of model wording.
- Quote selection must be invalidated when any input that changes the quote changes.
- A referral must carry reason codes, not a model-invented explanation of why it happened.
- A completed session must use the terminal step so API callers receive `completed: true`.

## Next

[3. Prompt files and bounded collection](/docs/tutorials/home-insurance-flow/prompt-files/)
shows how the conversational stages get narrow instructions and validated tools
without letting a prompt calculate a quote.
