---
title: 2. Designing a decision-backed workflow
eyebrow: DecisionHotelFlow tutorial
lede: Split the journey by responsibility, then choose a chat model, decision model, or deterministic code for each boundary instead of asking one prompt to own everything.
source: pico-demo/src/myflow/decision-hotel-flow/decision-hotel-flow.ts, pico-demo/src/myflow/decision-hotel-flow/criteria-helper.ts
---

The important design choice in `DecisionHotelFlow` is not Jev itself. It is the
decision to give each kind of work the narrowest runtime that can do it.

## The goal

- Map the booking journey onto durable step owners.
- Separate conversation, typed judgment, and deterministic policy.
- Keep one authoritative copy of every business fact.
- Make correction and outage paths explicit before writing prompts.

## Three execution mechanisms

| Work | Mechanism | Why |
| --- | --- | --- |
| Understand and phrase an open-ended conversation | ordinary `Step` with a chat model | It can ask follow-ups and call typed tools |
| Choose among declared labels or score a bounded claim | `DecisionStep` with Jev | The output is typed evidence rather than prose |
| Validate, search, price, render a safe fallback, or commit | TypeScript and `LogicStep` | The result must be reproducible and application-owned |

That yields three decision boundaries and seven ordinary execution stages:

```text
typed route -> conversational collector -> typed readiness review
            -> deterministic search -> conversational draft
            -> typed grounding review -> deterministic selection check
```

Jev does not validate dates, compare budgets, query the hotel catalogue, or
authorize a booking. It classifies bounded questions. Application code decides
what those answers permit.

## State ownership

Each collector owns exactly the fact it validates:

| State | Owner |
| --- | --- |
| `answered`, `start`, `end` | `DateRangeStep` |
| `answered`, `min`, `max` | `BudgetStep` |
| `answered`, `roomType` | `RoomTypeStep` |
| `answered`, `amenities` | `AmenityStep` |
| `answered`, `airport`, `cityCenter` | `DistanceStep` |
| `notice`, `lastRoute`, `lastDecision` | `RouterStep` |
| `review`, `accepted` | each judge step |
| `hotelFound`, `criteria`, `draft`, selection and confirmation | `PresentStep` |

`CriteriaHelper.readCriteria(reader)` builds one normalized snapshot by reading
the five owners. It does not create a second persisted criteria object during
collection. The same helper validates, converts, and renders that snapshot, so
routing, search, and customer-facing review use one vocabulary.

## Memory ownership

The collectors, router, and readiness judge share `intake`. That lets a
`DecisionStep` derive the newest request and up to four previous requests from
the same conversation the collectors used.

`PresentStep` and `PresentationJudgeStep` share `present`. Search-result prose
and booking instructions therefore do not pollute intake routing. The terminal
step uses `end`.

State and memory solve different problems: state holds validated facts; memory
holds messages used by a model. A budget remains available even when an old
message falls outside the decision model's bounded `priorRequests` window.

## Registration is both topology and configuration

`defineSteps()` registers every possible transition target and attaches the
memory namespace. The first item, `RouterStep`, is the initial cursor because
the flow does not override `initialStep()`.

Decision configuration is flow-wide:

```ts
protected override configDecision() {
  return {
    provider: 'typesafe',
    model: 'jev-latest',
    timeoutMs: 15_000,
    maxRetries: 2,
  };
}
```

A particular `DecisionStep` could call `.useDecision(...)` in `defineSteps()` to
override part of that policy. None does here; consistent provider and timeout
policy is easier to reason about across the three boundaries.

## Design every correction path

There are four correction classes:

1. A collector rejects its own invalid value with `stay(...)`.
2. A request for another criterion returns to `RouterStep`, which forwards the
   original user message to the correct owner.
3. The readiness judge routes an inconsistent record back to one owner.
4. An empty search or presentation-time revision returns to the router without
   discarding saved criteria.

No correction mutates another step's state directly. The request travels to the
owner, and the owner revalidates before saving.

## Side-effect boundary

The search is read-only. Booking is the terminal effect, and it is guarded in
`PresentStep` by resolving the requested name or number against the saved
`hotelFound` array. Only then does the step save a confirmation and return
`finish(...)`.

The demo generates an in-memory confirmation number; a production booking
handler would put idempotency, authorization, and the durable reservation write
behind the same code boundary.

## Common mistakes

- **Using a decision answer as authorization.** It is probabilistic evidence;
  code owns effects and policy.
- **Copying one criteria object between steps.** Keep each fact with its owner
  and derive a normalized view.
- **Sharing all history.** The presentation judge needs the draft and results,
  not every intake turn.
- **Letting correction bypass validation.** Forward the message to the owner;
  do not write that owner's state from the router.
- **Treating `defineSteps()` as a sequence.** It is a registry. Returned
  transitions decide what runs next.

## Next

[3. Anatomy of a DecisionStep](/docs/tutorials/decision-hotel-flow/decision-step-anatomy/)
follows one typed decision from questions and facts to validated answers and a
route.
