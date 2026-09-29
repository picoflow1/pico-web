---
title: DecisionStep
eyebrow: Reference
lede: "Typed, non-generative decisions inside a PicoFlow: question contracts, conversation and fact input, configuration, provider registration, routing, failure handling, and usage accounting."
source: pf/src/picoflow/flow/decision-step.ts, pf/src/picoflow/flow/decision-runner.ts, pf/src/picoflow/decision/decision-types.ts
---

`DecisionStep` extends `Step` for bounded decisions whose output should be typed
evidence rather than generated prose. Register it alongside ordinary `Step`s and
`LogicStep`s in `Flow.defineSteps()`.

TypeSafe Jev is PicoFlow's built-in decision provider. It is called through
LangChain's `TypeSafeClassifier`, but PicoFlow owns provider-neutral question,
answer, configuration, routing, and usage types.

```ts
abstract class DecisionStep<
  Q extends DecisionQuestionMap = DecisionQuestionMap,
> extends Step {
  abstract defineQuestions(): Q;
  abstract onDecision(
    answers: DecisionAnswers<Q>,
    context: DecisionContext,
  ): Promise<DecisionResponse>;
}
```

## Minimal example

```ts
import {
  DecisionStep,
  directTo,
  go,
  type DecisionAnswers,
  type DecisionQuestionMap,
} from '@picoflow/core';

const QUESTIONS = {
  route: {
    type: 'choice',
    criteria: {
      quick: 'A straightforward request',
      specialist: 'A complex request',
    },
  },
  blocked: {
    type: 'noul',
    instructions: 'Is a production operation blocked?',
  },
} as const satisfies DecisionQuestionMap;

class IntakeDecisionStep extends DecisionStep<typeof QUESTIONS> {
  defineQuestions() {
    return QUESTIONS;
  }

  getPrompt() {
    return 'Classify the current support request.';
  }

  async onDecision(answers: DecisionAnswers<typeof QUESTIONS>) {
    this.saveState({ answers });
    return answers.route.choice === 'specialist'
      ? go(SpecialistStep)
      : directTo(QuickStep, 'I can handle that in the quick path.');
  }
}
```

Every target must also be registered in `defineSteps()`.

## Question types

```ts
type Choice = {
  type: 'choice';
  criteria: Readonly<Record<string, JsonValue>>;
  instructions?: DecisionState;
};

type Score = {
  type: 'score';
  criteria: readonly JsonValue[];
  instructions?: DecisionState;
};

type Noul = {
  type: 'noul';
  instructions?: DecisionState;
  criteria?: { true?: JsonValue; false?: JsonValue };
};
```

| Question | Answer | Range and typing |
| --- | --- | --- |
| `Choice` | `{ choice, probabilities, confidence }` | `choice` is inferred from the string keys in `criteria`; probabilities cover every label |
| `Score` | `{ score, legend, probabilities, confidence }` | `score` is from zero through the last criterion index and may be fractional |
| `Noul` | `{ noul }` | one probability in `[0, 1]`; there is no separate confidence field |

Declare maps with `as const satisfies DecisionQuestionMap` so keys and Choice
labels remain literal types. `defineQuestions()` runs once per invocation and
may construct a fresh map from current state:

```ts
class RouterStep extends DecisionStep<
  ReturnType<typeof RouterStep.buildQuestions>
> {
  defineQuestions() {
    return RouterStep.buildQuestions(this.getState('criteria'));
  }
}
```

Batch only questions that can be answered independently from the same input.
If question B depends on question A's answer, put B in another decision step.

## Prompt, facts, and conversation

Three inputs have different jobs:

1. `defineQuestions()` declares the typed outputs and optional question-specific
   instructions.
2. `getPrompt()` returns one shared guidance string. PicoFlow prepends it to the
   instructions of every question.
3. `getDecisionFacts()` returns JSON-compatible application facts such as a
   draft, policy record, or normalized criteria.

PicoFlow adds two framework-owned conversation fields:

```ts
type DecisionConversation = {
  request: string;
  priorRequests: string[];
};
```

`request` is the newest human message in the step's memory namespace.
`priorRequests` contains up to four earlier human messages by default.
Framework-generated navigation messages are excluded; messages explicitly sent
with `.withMessage(...)` remain evaluable.

`getDecisionFacts()` cannot contain `request` or `priorRequests`. Attempting to
replace them throws. Facts must be JSON-compatible and should contain the
minimum authoritative subject needed for the questions.

Other application code can read the same conversation with
`flow.getConversation(namespace, maxPriorRequests?)`.

## Configuration

Decision call policy is separate from chat-model policy:

```ts
type DecisionStepOptions = {
  provider?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
};
```

Configure flow defaults with `Flow.configDecision()`:

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

Call `.useDecision({...})` on one registered instance for a step-local override.
Resolution order is framework defaults, Flow configuration, then Step override.

| Option | Framework default | Meaning |
| --- | --- | --- |
| `provider` | `typesafe` | ID of a registered `DecisionProviderAdapter` |
| `model` | `jev-latest` | provider model name |
| `timeoutMs` | `30000` | wall-clock deadline for one attempt |
| `maxRetries` | `0` | additional attempts after the first |

Unlike chat `retryAttempts`, decision `maxRetries` is not the total attempt
budget. `maxRetries: 2` permits three attempts.

Decision steps reject `.useModel()`, tools, decorated tool handlers, and
`structOutputSchema()`. Use a regular `Step` when the model must generate prose
or call a tool.

## Provider registration

Decision providers are registered explicitly at the application composition
root:

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

`DecisionProvider.create()` registers only the providers named in its argument.
PicoFlow does not implicitly enable TypeSafe. Its standard endpoint is supplied
by the LangChain client; PicoFlow does not read a TypeSafe base-URL environment
variable.

Applications may register their own adapter:

```ts
interface DecisionProviderAdapter {
  readonly id: string;
  decide(
    input: DecisionRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<DecisionResult>;
  shouldRetry?(error: Error): boolean;
}
```

Only errors explicitly classified as transient by `shouldRetry()` use another
attempt. The built-in TypeSafe adapter retries connection/timeout errors, HTTP
408 and 429, and 5xx responses.

## Answer validation and handling

Before `onDecision()` runs, `DecisionRunner` verifies:

- exactly one answer exists for every question, with no unknown question keys;
- every answer type matches its question;
- Choice labels and probability keys match declared criteria;
- Score values and legends match the declared levels;
- Noul and all probabilities lie in `[0, 1]`;
- Choice and Score probability distributions sum to one within tolerance.

Validation failures never reach the handler. `onDecision()` receives typed
answers and a context containing the exact evaluated conversation plus provider,
model, duration, usage, and optional request ID.

`DecisionResponse` accepts ordinary final routing responses, including strings,
step targets, `go(...)`, `directTo(...)`, and `finish(...)`. It excludes
`directResult(...)`, which is reserved for tool output in a parallel child.

Typed output remains probabilistic evidence. Put authorization, thresholds,
money, validation, IDs, durable writes, and irreversible effects in application
code.

## Decision failure recovery

```ts
public async onDecisionError(
  context: DecisionErrorContext,
): Promise<DecisionResponse | null>;
```

The context contains `stepId`, configured provider and model, and the original
`Error`. Recovery precedence is:

1. `DecisionStep.onDecisionError(context)`;
2. when it returns `null`, `Flow.onDecisionError(context)`;
3. when both return `null`, propagate the original provider failure.

Caller cancellation bypasses both hooks. A provider answer that fails framework
validation is not retried, never reaches `onDecision()`, and enters this fallback
chain with a `DecisionValidationError`. Question construction, configuration,
decision-input errors, and exceptions thrown by `onDecision()` occur outside the
chain and propagate normally.

Choose outage policy per boundary. A read-only search gate may safely fall back
to deterministic validation. A payment or authorization gate should normally
fail closed or request explicit confirmation.

## Usage accounting

Session documents keep decision usage separate from chat-model tokens:

```ts
type DecisionUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
```

`calls` counts provider responses observed by the runner, including a response
later rejected by framework validation. Failed transport attempts and results
arriving after cancellation are not counted, so observed usage may be lower than
provider-side billing. Parallel decision usage is retained even when business
state publication is rolled back.

## Nested and parallel execution

A nested `runStep()` may receive a decision step's text result, but a child
cannot move the durable cursor or complete the owner session. A decision worker
inside `runSteps()` follows the same fresh-instance and state-ownership rules as
any other worker: save only its own state, return branch output, and let the
coordinator route.

## Worked example

The [DecisionHotelFlow tutorial](/docs/tutorials/decision-hotel-flow/) combines
three decision steps with five conversational collectors, deterministic
validation and search, reviewed presentation, provider-failure fallbacks, a
twenty-two-turn deterministic contract, and a sixteen-turn live replay.
