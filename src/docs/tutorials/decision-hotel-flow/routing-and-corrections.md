---
title: 4. Typed routing and cross-step corrections
eyebrow: DecisionHotelFlow tutorial
lede: RouterStep chooses a declared destination and independently decides whether the current request must be delivered to that destination, allowing corrections to cross collector boundaries without being lost.
source: pico-demo/src/myflow/decision-hotel-flow/router-step.ts, pico-demo/src/myflow/decision-hotel-flow/date-range-step.ts
---

The router answers two different questions:

1. **Where should execution go?**
2. **Does the latest request contain an unapplied criterion value that the
   destination must receive?**

Keeping those questions independent is what makes them safe to evaluate in one
Jev call.

## Dynamic questions from current state

`buildRoutingQuestions(criteria)` computes the unresolved fields and embeds that
list in each question's own instructions. The two schemas remain stable:

```ts
return {
  destination: {
    type: 'choice',
    criteria: {
      dates: 'Set or revise check-in and checkout dates',
      budget: 'Set or revise minimum or maximum nightly budget',
      room_type: 'Set or revise one bed, two beds, or suite',
      amenities: 'Set or revise hotel amenity preferences',
      distance: 'Set or revise distance limits',
      review: 'Display saved criteria without searching',
      search: 'Execute a hotel search',
      exit: 'End without booking',
      unclear: 'Ambiguous or outside this flow',
    },
    instructions: `Choose one destination ... ${unresolvedSummary}`,
  },
  request_delivery: {
    type: 'choice',
    criteria: {
      apply_request: 'An unapplied criterion value or revision is present',
      prompt_next: 'No unapplied value; unresolved criteria remain',
      none: 'Review, search, exit, or unclear request',
    },
    instructions: `Classify the request independently ... ${unresolvedSummary}`,
  },
} as const satisfies DecisionQuestionMap;
```

Do not make `request_delivery` say “if `destination` is a collector…”. Jev
answers batched questions together; one answer cannot be an input to another in
that same request. Both questions must be answerable from the saved criteria and
latest request.

## Facts anchor the route

```ts
protected override getDecisionFacts() {
  const criteria = CriteriaHelper.readCriteria(this);
  return {
    criteria,
    unresolved: CriteriaHelper.validateCriteria(criteria).map(
      issue => issue.field,
    ),
    notice: this.getState<string | null>('notice') ?? null,
  };
}
```

The prompt explains how to decide; facts provide the record being decided. The
router does not rely on prose alone to remember which fields are already saved.

## Routing policy stays in TypeScript

`onDecision()` handles declared labels with an ordinary switch. Review and exit
are exact code-owned responses. Search is blocked by deterministic validation
before the readiness judge can run.

For a collector destination, the router may forward the exact request:

```ts
const next = go(CriteriaHelper.nextStep(route));
return answers.request_delivery.choice === 'apply_request'
  ? next.withMessage(
      new HumanMessageEx(this, context.request, { origin: 'user' }),
    )
  : next;
```

`context.request` is the same request Jev classified. `HumanMessageEx` preserves
step attribution and marks it as user-originated.

## Why a transition alone is not enough

`go(DateRangeStep)` moves execution. It does not promise that the destination
will receive the current user message as its input. Without `.withMessage(...)`,
a cross-step request such as “Actually change my dates…” can reach the correct
step but leave that step with nothing new to parse.

The live replay exercises exactly that case while `AmenityStep` is active:

```text
User: Actually change my dates to August 3 through August 9, 2027
AmenityStep -> RouterStep -> DateRangeStep -> RouterStep -> AmenityStep
Bot: Which hotel amenities do you require? ...
```

`DateRangeStep` validates and saves the correction. The second router invocation
sees that dates are already reflected, so it selects the first unresolved field,
amenities. All of that happens in one turn.

## Collector-owned validation

The router never saves dates or budgets. Each collector validates its own tool
payload and either:

- returns `stay(feedback)` for a correctable value;
- saves its normalized state and returns `go('RouterStep')`; or
- uses the shared `reroute_request` tool to return a different request to the
  router without writing state.

This prevents probabilistic routing from becoming a shortcut around business
validation.

## Router fallback

If Jev is unavailable, `RouterStep.onDecisionError()` reads only saved state. It
shows a pending notice, sends the customer to the first invalid or missing
criterion, or renders a safe criteria summary and asks for an explicit search or
revision. It cannot interpret a new cross-step correction without Jev, so it
does not pretend to.

## Common mistakes

- **Batching dependent questions.** Split them into separate decision steps or
  make each answer derive independently from shared inputs.
- **Assuming `go()` forwards the request.** Use `.withMessage(...)` when the
  destination must consume it.
- **Saving another step's fact in the router.** Route to the owner and validate
  there.
- **Starting search automatically.** This flow requires the literal request
  “search” after all criteria are complete.
- **Treating a fallback as semantic routing.** A deterministic fallback can use
  saved facts; it cannot reliably interpret an arbitrary new request.

## Next

[5. Readiness and deterministic search](/docs/tutorials/decision-hotel-flow/readiness-and-search/)
puts a typed judge in front of a model-free, read-only operation.
