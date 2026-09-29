---
title: 7. Fallbacks and two-tier testing
eyebrow: DecisionHotelFlow tutorial
lede: Give every decision boundary an explicit outage policy, cover it with a deterministic adapter contract, and use the live replay only for real-provider semantic evidence.
source: pico-demo/test/decision-hotel-flow/decision-hotel-flow.spec.ts, pico-demo/test/decision-hotel-flow/decision-hotel-flow.e2e-spec.ts
---

`DecisionHotelFlow` has two sources of probabilistic behavior: the chat model and
the decision provider. Routine tests replace both with controlled adapters. A
separate opt-in suite asks whether the real providers can complete the same
journey.

## Three step-local fallbacks

`DecisionStep.onDecisionError(context)` runs before the Flow-level fallback.
Each decision boundary uses the saved state it owns:

| Step | Fallback | Policy |
| --- | --- | --- |
| `RouterStep` | show notice, ask first missing criterion, or render a safe summary | degrade without pretending to understand a new arbitrary request |
| `CriteriaReadinessJudgeStep` | route validation issue or search valid criteria | fail open only for this read-only search |
| `PresentationJudgeStep` | render saved results in code | fail closed on unreviewed generated prose |

Returning `null` would delegate to `Flow.onDecisionError(context)`. If both
return `null`, PicoFlow propagates the original provider error. Caller
cancellation bypasses both hooks.

Configuration and input errors are not provider outages. A missing provider,
invalid question map, reserved facts field, or non-JSON fact should fail loudly
instead of entering business fallback policy.

## Decision retry policy

`maxRetries: 2` means at most three attempts. Only failures the provider adapter
marks transient are retried. The TypeSafe adapter treats timeouts, connection
errors, HTTP 408, HTTP 429, and 5xx responses as transient. Invalid answer
envelopes and handler exceptions are not transport retries.

This is separate from chat `retryAttempts`, where the configured number is the
total attempt budget.

## Deterministic contract

Run:

```bash
cd pico-demo
npm run test:decision-hotel-flow:contract
```

The contract creates a real `FlowEngine` with an in-memory session store, a
scripted chat adapter, and a hand-written `DecisionProviderAdapter`. The decision
adapter reads the exact facts and question keys it receives, returns schema-valid
Choice, Score, and Noul answers, and throws at selected calls to exercise all
three fallbacks.

The twenty-two-turn scenario covers:

- invalid calendar dates, inverted budgets, and negative distances;
- a correction that crosses from amenities to dates and back;
- explicit criteria review and a readiness rejection;
- a model draft rejected for invented results;
- no matches followed by a budget revision;
- provider outages at router, readiness, and presentation boundaries;
- final grounded presentation and validated booking;
- persisted criteria, judge state, selected hotel, confirmation, usage, and
  completion.

Stable assertions target `completed`, the active step, and saved state. Text
checks are limited to the semantic content needed for that turn.

## Live semantic evaluation

Run:

```bash
npm run test:decision-hotel-flow
```

With all required credentials, the E2E test boots the demo, uses the real
OpenAI and TypeSafe providers, sends the sixteen scenario requests through one
session, semantically grades each reply, and checks active step plus final state.
Only after every assertion succeeds does it write
`test/.tmp/decision-hotel-flow/live.json`.

The tutorial's replay is a snapshot of a successful artifact. A failed or
partial run must not replace it. Without credentials the live test is skipped;
that is neither success nor evidence of provider behavior.

## Separate usage accounting

Decision calls accumulate under `sessionDoc.decisionUsage`:

```ts
{
  calls: 22,
  inputTokens: 27778,
  outputTokens: 2442,
  totalTokens: 30220,
}
```

Chat usage remains under `tokens`. A provider response is counted when observed,
including one later rejected by framework validation. Failed transport attempts
and late results after cancellation are not visible in the aggregate, so
provider billing may be higher.

The values above came from the recorded live replay. They are not a benchmark:
prompts, provider behavior, and conversation paths change the totals.

## What each tier proves

| Tier | Proves | Does not prove |
| --- | --- | --- |
| deterministic contract | routing policy, state ownership, validation, fallbacks, and completion on every run | that real models choose those answers |
| live replay | that the configured real providers completed one realistic scenario | general routing accuracy, threshold quality, availability, or cost |

Threshold calibration needs a separate labeled dataset. Production readiness
also needs load, latency, provider-failure, security, and idempotency testing
beyond this tutorial.

## Common mistakes

- **Calling a credential-gated skip a live pass.** Report it as skipped.
- **Mocking only happy paths.** Force every decision fallback and every
  correctable validation branch.
- **Returning malformed fake answers.** The runner validates test adapters with
  the same contracts as Jev.
- **Testing routes by exact prose.** Assert cursor and saved state; reserve
  semantic wording checks for the live tier.
- **Combining chat and decision usage.** They are separate runtime mechanisms
  with separate policy and accounting.

## Next

Return to the [DecisionHotelFlow overview](/docs/tutorials/decision-hotel-flow/),
or read the complete [`DecisionStep` reference](/docs/reference/decision-step/).
