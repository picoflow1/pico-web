---
title: 3. Anatomy of a DecisionStep
eyebrow: DecisionHotelFlow tutorial
lede: A DecisionStep supplies typed questions, shared guidance, application facts, and one handler. PicoFlow supplies conversation input, provider policy, retries, validation, accounting, and ordinary routing.
source: picoflow/src/picoflow/flow/decision-step.ts, picoflow/src/picoflow/flow/decision-runner.ts, pico-demo/src/myflow/decision-hotel-flow/router-step.ts
---

`DecisionStep` is a `Step` specialization for typed, non-generative decisions.
It participates in the same registry, state, memory, routing, nested execution,
and persistence lifecycle as an ordinary step, but it does not configure a chat
model or tools.

## The members you implement

| Member | Required? | Purpose |
| --- | --- | --- |
| `defineQuestions()` | yes | Return the Choice, Score, and Noul question map for this invocation |
| `onDecision(answers, context)` | yes | Interpret validated typed answers and return an ordinary route or response |
| `getPrompt()` | no | Shared guidance prepended to every question's instructions |
| `getDecisionFacts()` | no | Add JSON-compatible application facts to the provider state |
| `onDecisionError(context)` | no | Recover a provider failure before delegating to the Flow |

`useDecision(...)` configures a step-local provider/model/timeout/retry override.
`useModel()`, chat tools, and `structOutputSchema()` are rejected on a
`DecisionStep` because those belong to the chat-model runner.

## A typed question map

The presentation judge uses all three public question types:

```ts
const REVIEW = {
  grounded: {
    type: 'noul',
    instructions:
      'Are all hotel names and prices in the draft supported by hotelFound?',
  },
  completeness: {
    type: 'score',
    criteria: [
      'Missing the result list',
      'Lists hotels but omits an important action',
      'Lists matching hotels with prices and explains booking or revision',
    ],
  },
  clarity: {
    type: 'score',
    criteria: ['Confusing', 'Understandable', 'Clear numbered choices'],
  },
} as const satisfies DecisionQuestionMap;
```

- A **Choice** returns one declared label, probabilities for all labels, and a
  confidence value.
- A **Score** returns a possibly fractional position from zero through the last
  criterion index, plus probabilities, legend, and confidence.
- A **Noul** returns one probability in `[0, 1]`.

`DecisionAnswers<typeof REVIEW>` preserves those keys and Choice labels in
TypeScript. The runner rejects missing answers, unknown labels, wrong answer
types, invalid probability distributions, and out-of-range scores before
`onDecision()` executes.

## Guidance and facts are different inputs

`getPrompt()` returns one shared guidance string. PicoFlow prepends it to each
question's own `instructions`; it does not replace question-specific text.

`getDecisionFacts()` supplies the structured subject being judged:

```ts
protected override getDecisionFacts() {
  return {
    draft: this.getStepState<string>(PresentStep, 'draft') ?? '',
    hotelFound:
      this.getStepState<SearchHotelEntry[]>(PresentStep, 'hotelFound') ?? [],
    criteria: this.getStepState(PresentStep, 'criteria') ?? {},
  };
}
```

PicoFlow then adds `request` and `priorRequests` from the step's memory
namespace. Those two names are reserved; facts cannot overwrite them. The
provider receives one JSON-compatible state object:

```ts
{
  draft,
  hotelFound,
  criteria,
  request: "search",
  priorRequests: [/* up to four earlier human requests */],
}
```

Framework-generated navigation messages are excluded. A message explicitly
forwarded with `.withMessage(...)` remains part of the evaluated conversation.

## Questions can be dynamic

`defineQuestions()` runs for every decision invocation. `RouterStep` uses a
static factory so instructions can name the currently unresolved criteria while
the generic answer type remains inferred:

```ts
export class RouterStep extends DecisionStep<
  ReturnType<typeof RouterStep.buildRoutingQuestions>
> {
  public defineQuestions() {
    return RouterStep.buildRoutingQuestions(CriteriaHelper.readCriteria(this));
  }
}
```

Use dynamic questions when the decision contract itself benefits from current
state. Do not mutate one shared question object between requests.

## Provider registration is explicit

The application composition root registers TypeSafe next to chat providers:

```ts
const engine = await FlowEngine.create({
  flows: [DecisionHotelFlow],
  providers: ModelProvider.createBuiltinAdapters({
    openai: { apiKey: process.env.OPENAI_API_KEY },
  }),
  decisionProviders: DecisionProvider.create({
    typesafe: { apiKey: process.env.TYPESAFE_API_KEY },
  }),
});
```

PicoFlow does not silently enable TypeSafe and does not read a custom TypeSafe
base URL. The adapter uses LangChain's `TypeSafeClassifier`; PicoFlow owns the
provider-neutral public contracts and runtime policy.

## What happens during one invocation

1. Flow and step decision options resolve.
2. Questions are built, cloned, and validated.
3. Shared prompt guidance is prepended to each question's instructions.
4. Facts are combined with `request` and `priorRequests`.
5. The provider runs under a per-attempt deadline and bounded retry policy.
6. The answer envelope is validated against the exact question map.
7. Decision usage is tallied separately from chat tokens.
8. `onDecision(answers, context)` returns normal PicoFlow routing.

The handler context includes the exact evaluated conversation plus provider,
model, duration, usage, and optional request ID.

## Thresholds are application policy

The presentation judge requires grounding probability `>= 0.85`, both scores
`>= 1.5`, and both score confidences `>= 0.75`. Jev supplies evidence; this
TypeScript expression supplies policy. Change and calibrate thresholds against a
labeled application dataset, not intuition or one successful replay.

## Next

[4. Typed routing and cross-step corrections](/docs/tutorials/decision-hotel-flow/routing-and-corrections/)
shows why the router asks two independent questions and how it preserves the
customer's original request.
