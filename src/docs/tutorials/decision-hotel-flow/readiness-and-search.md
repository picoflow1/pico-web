---
title: 5. Readiness and deterministic search
eyebrow: DecisionHotelFlow tutorial
lede: The readiness judge checks semantic faithfulness, but deterministic validation remains authoritative and the actual search runs in a LogicStep with no model call.
source: pico-demo/src/myflow/decision-hotel-flow/criteria-readiness-judge-step.ts, pico-demo/src/myflow/decision-hotel-flow/search-hotels-step.ts, pico-demo/src/myflow/decision-hotel-flow/criteria-helper.ts
---

The readiness boundary answers a narrow question: do the saved, code-valid
criteria also appear faithful to the recent conversation? It does not decide
whether malformed dates or inverted budgets are acceptable.

## Two independent checks

`CriteriaHelper.validateCriteria()` checks application invariants:

- dates are real calendar dates, in the future, with checkout after check-in;
- budget limits are nonnegative and minimum does not exceed maximum;
- room type and amenities are allowlisted;
- distance limits are nonnegative;
- every criterion has an explicit answer, including “no preference”.

The judge asks a Choice question for the outcome and a Noul question for
faithfulness:

```ts
const REVIEW = {
  outcome: {
    type: 'choice',
    criteria: {
      ready: 'Saved criteria reflect the latest requests',
      dates: 'Dates are missing, ambiguous, or contradicted',
      budget: 'Budget is missing, ambiguous, or contradicted',
      room_type: 'Room type is missing, ambiguous, or contradicted',
      amenities: 'Amenities are missing, ambiguous, or contradicted',
      distance: 'Distance limits are missing, ambiguous, or contradicted',
      unclear: 'Several criteria are unresolved or ambiguous',
    },
  },
  faithful: {
    type: 'noul',
    criteria: {
      true: 'The normalized criteria reflect corrections and no-preference choices',
      false: 'One or more criteria miss or contradict the latest request',
    },
  },
} as const satisfies DecisionQuestionMap;
```

The structured subject includes both normalized criteria and deterministic
issues. `getPrompt()` also renders them as guidance. That repetition is
intentional here: facts are the machine-readable subject, while the prompt
explains the review task.

## Code retains veto power

```ts
const accepted =
  issues.length === 0 &&
  outcome === 'ready' &&
  answers.faithful.noul >= 0.75;

if (issues.length > 0) {
  return go(CriteriaHelper.nextStep(issues));
}
if (accepted) {
  return go(SearchHotelsStep);
}
if (outcome !== 'ready' && outcome !== 'unclear') {
  return go(CriteriaHelper.nextStep(outcome));
}
return directTo(RouterStep, /* ask for one clear correction */);
```

Even a high-confidence “ready” cannot override `issues.length > 0`. Conversely,
a code-valid record can still be routed for correction when recent conversation
evidence contradicts it.

## The search is a LogicStep

Once the boundary accepts the record, `SearchHotelsStep.runLogic()` repeats
validation as a final guard, converts the snapshot into a typed MCP request, and
calls the hotel-pricing client. No model chooses the query or interprets the
results.

```ts
const criteria = CriteriaHelper.readCriteria(this);
const issues = CriteriaHelper.validateCriteria(criteria);
if (issues.length > 0) {
  return go(CriteriaHelper.nextStep(issues));
}

const hotels = await searchHotelsViaMcp(
  CriteriaHelper.toSearchRequest(criteria),
);
```

Three outcomes are explicit:

| Outcome | Route |
| --- | --- |
| Invalid criteria | owning collector |
| MCP failure | `RouterStep` with a retry notice |
| No matches | `RouterStep` with a revision notice |
| Matches | `PresentStep` with results, criteria, and accepted-review flag |

The router displays a saved notice before it asks Jev to interpret another
request. An empty result is therefore normal workflow data, not an exception and
not a reason to lose the session.

## Read-only fallback policy

If the Jev call fails, `CriteriaReadinessJudgeStep.onDecisionError()` lets
deterministic validation decide:

```ts
return issues.length > 0
  ? go(CriteriaHelper.nextStep(issues))
  : go(SearchHotelsStep);
```

This demo fails open because search is read-only and the customer sees its
results before any booking. Do not reuse that policy in front of payment,
authorization, enrollment, or another irreversible action. For those
boundaries, a provider outage should normally request confirmation or stop.

## Common mistakes

- **Using the judge instead of validation.** Dates, money, supported values,
  and authorization belong in code.
- **Putting search in `onDecision()`.** Route to a `LogicStep` so operation,
  failure handling, and state transfer remain deterministic.
- **Treating no matches as infrastructure failure.** It is a recoverable domain
  result.
- **Failing open without naming the risk.** Decide outage policy separately for
  every boundary.
- **Skipping the second validation.** Recheck immediately before the operation
  that depends on the record.

## Next

[6. Grounded presentation and booking](/docs/tutorials/decision-hotel-flow/grounded-presentation/)
reviews generated prose before release and keeps the terminal selection check in
code.
