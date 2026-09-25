---
layout: layouts/ezgraph.njk
title: 3. Anatomy of a decision node
description: Follow one DecisionNode invocation from defineQuestions() through the Jev request, answer validation, onDecision(), routing, and usage accounting.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/decision-node-anatomy/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 3. Anatomy of a decision node

A `DecisionNode` looks small: a question map, an optional prompt, some facts, and a handler. Most
of its behavior lives in the framework, between the moment the graph enters the node and the
moment your `onDecision()` runs. This lesson follows one invocation of `RouterDecisionNode`
through that path, so the later lessons can concentrate on policy.

## The goal

- Know which members a decision node implements, and what each default does.
- See exactly what Jev receives, using a real turn from the live replay.
- Know what the framework checks before your handler runs.
- Understand what each routing builder does when a decision node returns it.

## The members you implement

| Member | Required? | Default | In this graph |
| --- | --- | --- | --- |
| `defineQuestions(state)` | yes | — | a constant `as const satisfies DecisionQuestionMap` in all three nodes |
| `getPrompt(state)` | no | `""` | criteria and issues filled into a prompt file |
| `getDecisionFacts(state)` | no | `{}` | criteria, issues, notices, drafts, and results |
| `getDecisionConfig()` | no | `{}` (use the graph's `decisionConfig`) | not overridden |
| `onDecision(answers, context, state)` | yes | — | all routing policy |
| `onDecisionError(context)` | no | `null` (delegate to the graph) | a deterministic fallback in all three nodes |

A decision node may not define chat tools, handle a `@Tool`, or return a chat-model configuration
from `getLlmConfig()`. Each of those throws when the graph compiles.

## One invocation, step by step

This is the heart of `DecisionNode.run()`, trimmed from
`ezgraph/src/framework/decision/decision-node.ts`:

```ts
const options = this.graph.resolveDecisionOptions(this.getDecisionConfig());
const provider = this.graph.resolveDecisionProvider(options.provider);

const questions = structuredClone(this.defineQuestions(state));
validateDecisionQuestions(questions);

const prompt = this.getPrompt(state).trim();
const prepared = /* each question, with instructions: [prompt, ...question.instructions] */;

const conversation = this.graph.getConversation(this.historySpace());
const facts = structuredClone(this.getDecisionFacts(state));
if ("request" in facts || "priorRequests" in facts) throw new Error(/* reserved */);
const providerState = {
  ...facts,
  request: conversation.request,
  priorRequests: [...conversation.priorRequests],
};

return DecisionRunner.run({ questions: prepared, providerState, provider, options, /* ... */ });
```

In order:

1. **Resolve configuration.** Framework defaults (`typesafe`, `jev-latest`, 30 seconds, no retries),
   then the graph's `decisionConfig`, then the node's `getDecisionConfig()`. For every node in this
   graph the result is Jev with 15-second attempts and two retries.
2. **Build and validate the questions.** `defineQuestions(state)` runs once per invocation and is
   cloned, so the same questions are sent on every retry. A malformed question map, such as a
   Score with one level or a Noul with neither instructions nor criteria, throws a
   `DecisionValidationError`.
3. **Prepend the prompt.** When `getPrompt()` is non-empty, it becomes the first element of every
   question's `instructions`. A question that already has instructions keeps them as the second
   element.
4. **Read the conversation.** `request` is the newest human message in the node's history space;
   `priorRequests` are up to four before it. Messages marked `ezgraphInternal: true` are skipped.
5. **Merge the facts.** Your facts are spread first and the framework's two fields last. A facts
   object containing `request` or `priorRequests` throws instead of being silently overwritten.
   The combined state must be JSON-compatible: strings, numbers, booleans, `null`, arrays, and
   plain objects, with no `undefined` values.
6. **Call the provider through `DecisionRunner`**, which owns timeouts, retries, validation,
   usage, and the audit record.

## What Jev actually receives

Here is the router's request on turn 5 of the live replay. The customer has just said "maximum 700
per night, with no minimum"; `BudgetNode` saved it and returned `go(RouterDecisionNode)`, so the
router runs again in the same turn to choose the next question.

```ts
{
  model: "jev-latest",
  state: {
    criteria: {
      dates: { answered: true, start: "2027-08-01", end: "2027-08-08" },
      budget: { answered: true, min: null, max: 700 },
      roomType: { answered: false, roomType: null },
      amenities: { answered: false, amenities: [] },
      distance: { answered: false, airport: null, cityCenter: null },
    },
    unresolved: ["room_type", "amenities", "distance"],
    notice: null,
    request: "maximum 700 per night, with no minimum",
    priorRequests: [
      "Hi",
      "February 30, 2027 through March 5, 2027",
      "August 1 through August 8, 2027",
      "minimum 800 and maximum 500 per night",
    ],
  },
  questions: {
    destination: {
      type: "choice",
      criteria: { dates: "Set or revise dates", /* ... */ unclear: "Ambiguous or outside this flow" },
      instructions: ["You are the typed routing boundary for a Portland Hilton hotel search.\n\nCriteria collected so far:\n{ ... }\n\nUnresolved criteria:\n1. room_type: Room type has not been answered.\n..."],
    },
    request_delivery: {
      type: "choice",
      criteria: { apply_request: "...", prompt_next: "...", none: "..." },
      instructions: ["You are the typed routing boundary for ..."], // the same prompt again
    },
  },
}
```

Three things stand out. The prompt text is repeated once per question. The criteria appear twice,
once in the prompt and once as facts. And the whole request is plain JSON, which is why facts
must be JSON too. Lesson 4 comes back to what those choices cost.

## What is checked before `onDecision()` runs

`DecisionRunner` validates every response against the questions that were sent. A response that
fails any check never reaches your handler:

- the response has exactly one answer per question, and nothing else;
- each answer has the same `type` as its question;
- a Choice's `choice` is one of the declared labels, and its `probabilities` cover exactly those
  labels;
- a Score's `score` lies between 0 and the last level, and its `legend` and `probabilities` cover
  every level;
- a Noul's `noul` is a probability between 0 and 1;
- Choice and Score probabilities sum to 1, within 0.02.

Because of that, the handler can trust the types. For the router,
`answers.destination.choice` is typed as the union `"dates" | "budget" | ... | "unclear"`, inferred
from the question map, and TypeScript flags a comparison with a label that does not exist.

## The handler's inputs

```ts
override onDecision(
  answers: DecisionAnswers<typeof ROUTING_QUESTIONS>,
  context: DecisionContext,
  state: DecisionHotelGraphStateType,
): GraphNodeResponse<DecisionHotelGraphStateType>
```

| Parameter | Contents |
| --- | --- |
| `answers` | one typed answer per question: `choice`, `probabilities`, and `confidence` for a Choice; `score`, `legend`, `probabilities`, and `confidence` for a Score; `noul` for a Noul |
| `context` | the exact `request` and `priorRequests` that were sent, plus `provider`, `model` (as reported by Jev), `durationMs`, `attempts`, `usage`, and `requestId` when available |
| `state` | the graph state the invocation started with |

`context.request` is the reason the router never has to re-derive the customer's message: it
forwards exactly what Jev classified.

## What the returned builder does

`onDecision()` returns the same builders a tool handler does, resolved by `GraphNode`:

| Return | Effect in the same invocation | Persisted `currentNode` | Turn ends? |
| --- | --- | --- | --- |
| `go(Target)` | `Target` runs immediately | `Target` | only when a later node ends it |
| `directTo(Target, text)` | `text` is the response and is appended as an assistant message to `Target`'s history | `Target` | yes |
| `finish(text)` | `text` is the response; the graph completes | `end` | yes |
| a state update or `Command` | applied as written | as written | as written |

`stay()`, `withCleanup()`, and `withToolFeedback()` belong to the tool loop and throw here.
`withMessage()` is allowed only with `go()` and `directTo()`; the message goes to the target's
history. `withState()` seeds the target's channel.

The router uses `directTo()` whenever it wants to ask the customer something. Because the question
is appended to the target collector's history, the collector later sees its own question
followed by the customer's answer, as if it had asked.

## Usage and audit, per invocation

Whatever the outcome, the runner adds the observed usage to `state.decisionUsage`, a counter with
an additive reducer, and records one sanitized entry in `SessionDocument.decisions`: node,
provider, configured and actual model, outcome, failure category, attempts, duration, request ID,
and usage. Lesson 9 uses those records to account for the 22 decision calls in the live replay.

## Why it is written this way

The framework owns everything that must be identical for every decision node: configuration
precedence, the conversation fields, JSON checks, retries, answer validation, and accounting. The
node owns only what is specific to one judgment: the questions, the guidance, the facts, and
what the answer means. A decision node therefore reads like a policy function, and the parts that
are easy to get subtly wrong are written once.

## Common mistakes

- **Putting `request` in your facts.** It throws. Use `context.request` in the handler, and let
  the framework supply it to Jev.
- **Returning rich objects from `getDecisionFacts()`.** The provider input must be JSON-compatible;
  convert dates to ISO strings and drop `undefined` fields first.
- **Expecting the handler to see an invalid answer.** Validation failures go to
  `onDecisionError()`, never to `onDecision()`.
- **Returning `stay()` from `onDecision()`.** There is no model loop to stay in; use `directTo()`
  to ask the customer something.
- **Forgetting that `go()` runs the target now.** A `go(CollectorNode)` means the collector's chat
  model is called in this same turn.

## Next

Continue to [4. Questions, prompts, and thresholds](/ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/).
