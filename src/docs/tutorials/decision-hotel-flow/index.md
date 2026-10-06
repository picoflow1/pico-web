---
title: Track overview
eyebrow: DecisionHotelFlow tutorial
lede: DecisionHotelFlow combines ordinary conversational Steps, typed Jev DecisionSteps, deterministic validation and search, grounded presentation, and safe provider fallbacks in one durable hotel-booking journey.
source: pico-demo/src/myflow/decision-hotel-flow/decision-hotel-flow.ts
---

`DecisionHotelFlow` is the decision-model track. It uses a chat model where the
application needs conversation, TypeSafe's Jev API where it needs a typed
classification or judgment, and ordinary TypeScript where it needs validation,
search, pricing, or a final side effect.

The implementation lives in
`pico-demo/src/myflow/decision-hotel-flow/`. Its deterministic contract and live
semantic replay live in `pico-demo/test/decision-hotel-flow/`. Browse the
[DecisionHotelFlow source on GitHub](https://github.com/picoflowio/pico-demo/tree/main/src/myflow/decision-hotel-flow).

## What DecisionHotelFlow is

The flow collects five hotel criteria, lets the customer revise them in any
order, reviews the normalized record before search, prices a local catalogue,
reviews the generated result presentation, and books only a hotel from the
saved result set.

Three `DecisionStep`s form typed boundaries:

- `RouterStep` selects one declared destination and decides whether the latest
  request must be forwarded to a collector.
- `CriteriaReadinessJudgeStep` checks whether the normalized record reflects the
  conversation before a read-only search.
- `PresentationJudgeStep` checks a generated draft against the actual hotel
  names and prices before the user sees it.

Five ordinary `Step`s collect criteria. `SearchHotelsStep` is a model-free
`LogicStep`. `PresentStep` generates a draft, validates hotel selection in code,
and finishes the booking with an exact response.

## The step graph

<figure class="flow-journey">
  <img src="/assets/img/decision-hotel-flow-journey.svg" width="1200" height="700" alt="DecisionHotelFlow graph: RouterStep uses typed decisions to select one of five criterion collectors. Complete criteria pass through a readiness decision and deterministic search to PresentStep. A presentation decision releases a reviewed draft or an exact fallback; revisions and empty results return to RouterStep, while a validated choice completes booking.">
  <figcaption>DecisionSteps provide typed routing and review evidence. Ordinary Steps collect and present; deterministic code validates, searches, renders fallbacks, and completes the booking.</figcaption>
</figure>

The durable cursor moves between registered steps, but several edges continue
within one HTTP turn. For example, a collector saves its value and returns
`go(RouterStep)`; the router immediately selects the next collector, which asks
the next question before the turn ends.

## The eleven registered steps

| Step | Kind | Memory | Owns | Boundary |
| --- | --- | --- | --- | --- |
| `RouterStep` | `DecisionStep` | `intake` | notice, last route and answers | Typed intent routing and request delivery |
| `DateRangeStep` | `Step` | `intake` | valid check-in and checkout | Calendar and future-date validation |
| `BudgetStep` | `Step` | `intake` | minimum and maximum | Nonnegative, ordered range |
| `RoomTypeStep` | `Step` | `intake` | supported room type | Zod enum |
| `AmenityStep` | `Step` | `intake` | normalized amenities | Allowlisted values and explicit no preference |
| `DistanceStep` | `Step` | `intake` | airport and city-center limits | Nonnegative optional values |
| `CriteriaReadinessJudgeStep` | `DecisionStep` | `intake` | review and accepted flag | Semantic review after deterministic validation |
| `SearchHotelsStep` | `LogicStep` | class default | no durable state | MCP-backed search and deterministic branching |
| `PresentStep` | `Step` | `present` | results, criteria, draft, selection, confirmation | Drafting and validated booking |
| `PresentationJudgeStep` | `DecisionStep` | `present` | review and accepted flag | Grounding, completeness, and clarity |
| `TerminateSessionStep` | framework | `end` | none | Registered terminal path |

## The whole flow class

```ts
export class DecisionHotelFlow extends Flow {
  protected override configModel() {
    return { provider: 'openai', name: 'gpt-4o', retryAttempts: 2 } as const;
  }

  protected override configLlmCallPolicy() {
    return { timeoutMs: 60_000 };
  }

  protected override configDecision() {
    return {
      provider: 'typesafe',
      model: 'jev-latest',
      timeoutMs: 15_000,
      maxRetries: 2,
    };
  }

  protected override defineSteps(): Step[] {
    return [
      new RouterStep(this).useMemory('intake'),
      new DateRangeStep(this).useMemory('intake'),
      new BudgetStep(this).useMemory('intake'),
      new RoomTypeStep(this).useMemory('intake'),
      new AmenityStep(this).useMemory('intake'),
      new DistanceStep(this).useMemory('intake'),
      new CriteriaReadinessJudgeStep(this).useMemory('intake'),
      new SearchHotelsStep(this),
      new PresentStep(this).useMemory('present'),
      new PresentationJudgeStep(this).useMemory('present'),
      new TerminateSessionStep(this).useMemory('end'),
    ];
  }
}
```

Chat and decision policy are deliberately separate. `retryAttempts: 2` is the
total chat-model attempt budget. `maxRetries: 2` permits two additional decision
attempts after the first. Both deadlines apply per attempt.

## What this track demonstrates

| Feature | In DecisionHotelFlow? |
| --- | --- |
| `DecisionStep` with Choice, Score, and Noul questions | yes |
| Dynamic `defineQuestions()` from current state | yes, `RouterStep` |
| `getDecisionFacts()` plus framework-owned conversation input | yes |
| Step-local `onDecisionError()` fallback | yes, all three decision steps |
| Shared and isolated memory namespaces | yes, `intake`, `present`, and `end` |
| Deterministic validation before model judgment | yes |
| Model-free `LogicStep` search | yes |
| Grounded presentation with exact fallback rendering | yes |
| Validated terminal side effect with `finish()` | yes |
| Deterministic adapter contract and live provider evaluation | yes |
| Parallel `runSteps()` or batch mode | no |

## The seven lessons

1. [A sixteen-turn live replay](/docs/tutorials/decision-hotel-flow/live-replay/) —
   invalid inputs, a cross-step correction, criteria review, empty results,
   revision, grounded presentation, and booking.
2. [Designing a decision-backed workflow](/docs/tutorials/decision-hotel-flow/multi-stage-design/) —
   stage boundaries, model boundaries, state ownership, and registration.
3. [Anatomy of a DecisionStep](/docs/tutorials/decision-hotel-flow/decision-step-anatomy/) —
   questions, shared guidance, facts, conversation input, typed answers, and
   provider registration.
4. [Typed routing and cross-step corrections](/docs/tutorials/decision-hotel-flow/routing-and-corrections/) —
   dynamic questions, independent batched decisions, and forwarding the
   original request.
5. [Readiness and deterministic search](/docs/tutorials/decision-hotel-flow/readiness-and-search/) —
   why a judge cannot override code validation, and why search is a `LogicStep`.
6. [Grounded presentation and booking](/docs/tutorials/decision-hotel-flow/grounded-presentation/) —
   draft review, deterministic rendering, revision, and selection validation.
7. [Fallbacks and two-tier testing](/docs/tutorials/decision-hotel-flow/fallbacks-and-testing/) —
   step-local outage policy, decision usage, deterministic adapters, and live
   evidence boundaries.

## Running it

DecisionHotelFlow is registered with the other flows on AppModule's shared
engine. Its session database uses the same inline MongoDB/Cosmos factories;
Jev's `decisionProviders` registration is separate from database authentication.
See the [bootstrap lesson](/docs/tutorials/basic-flow/bootstrapping/#registering-the-engine)
and [persistence guide](/docs/guides/persistence/#application-owned-database-initialization).
The live suite retains the configured `SESSION_STORE`, defaulting to memory
when unset; the contract suite uses memory explicitly.

```bash
cd pico-demo
npm run test:decision-hotel-flow:contract
npm run test:decision-hotel-flow
```

The contract is deterministic and needs no provider credentials. The live test
requires PicoFlow, OpenAI, and TypeSafe credentials; without them it is skipped.

## Next

Start with
[1. A sixteen-turn live replay](/docs/tutorials/decision-hotel-flow/live-replay/).
