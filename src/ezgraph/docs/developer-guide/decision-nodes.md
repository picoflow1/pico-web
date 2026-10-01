---
layout: layouts/ezgraph.njk
title: Decision nodes with Jev | EZGraph
description: Declare decision questions, route typed answers in code, and configure Jev providers, fallbacks, and usage.
permalink: /ezgraph/docs/developer-guide/decision-nodes/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Decision nodes with Jev

Declare decision questions, route typed answers in code, and configure Jev providers, fallbacks, and usage.

## Decision nodes with Jev

`DecisionNode` is EZGraph's counterpart to PicoFlow's `DecisionStep`. It asks a
decision model a fixed set of typed questions and hands the validated answers
to your code. The built-in provider is TypeSafe's
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), a
non-generative "System One" model reached through LangChain's
`TypeSafeClassifier`. Jev evaluates a state against your questions and returns
probabilities; it never writes prose, calls tools, or picks a route string.

Use a decision node for bounded judgments: intent routing, readiness checks,
and draft review. Use a `LlmNode` for language and tools.

### Declare questions, then route in code

Three question types exist. Declare them once with `as const satisfies
DecisionQuestionMap` so answer types are inferred from the criteria.

| Type | Declaration | Answer |
| --- | --- | --- |
| `choice` | `criteria: { label: description, ... }` | `choice` (one declared label), `probabilities`, `confidence` |
| `score` | `criteria: [level0, level1, ...]` (at least two) | `score` from `0` to the last index, may be fractional; `legend`, `probabilities`, `confidence` |
| `noul` | `instructions` and/or `criteria: { true, false }` | `noul`, a probability in `[0, 1]`; no separate confidence |

This router is adapted from the demo's `RouterDecisionNode`:

```ts
import { HumanMessage } from "@langchain/core/messages";
import {
  DecisionNode,
  directTo,
  finish,
  go,
  type DecisionAnswers,
  type DecisionContext,
  type DecisionQuestionMap,
  type GraphNodeResponse,
} from "@picoflow/ezgraph";

export const ROUTING_QUESTIONS = {
  destination: {
    type: "choice",
    criteria: {
      dates: "Set or revise dates",
      budget: "Set or revise nightly budget",
      review: "Show saved criteria",
      search: "Execute a hotel search",
      exit: "End the conversation",
      unclear: "Ambiguous or outside this flow",
    },
  },
} as const satisfies DecisionQuestionMap;

export class RouterDecisionNode extends DecisionNode<
  HotelStateType,
  typeof ROUTING_QUESTIONS
> {
  override defineQuestions() {
    return ROUTING_QUESTIONS;
  }

  // Optional. Prepended to every question's instructions.
  override getPrompt(state: HotelStateType) {
    return `Route the latest hotel request. Saved criteria:\n${summarize(state)}`;
  }

  // Optional JSON facts, merged with the framework-owned request fields.
  protected override getDecisionFacts(state: HotelStateType) {
    return { criteria: readCriteria(state) };
  }

  override onDecision(
    answers: DecisionAnswers<typeof ROUTING_QUESTIONS>,
    context: DecisionContext,
    state: HotelStateType,
  ): GraphNodeResponse<HotelStateType> {
    const route = answers.destination.choice; // typed as the declared labels
    this.saveState({ lastRoute: route });
    if (answers.destination.confidence < 0.6 || route === "unclear") {
      return directTo(RouterDecisionNode, "Tell me what to change: dates, budget, or search.");
    }
    if (route === "exit") return finish("Thanks for considering our hotels.");
    if (route === "review") return directTo(RouterDecisionNode, summarize(state));
    if (route === "search") return go(CriteriaReadinessDecisionNode);
    return go(nodeFor(route)).withMessage(new HumanMessage(context.request));
  }
}
```

`onDecision()` returns the same builders as a tool handler: `go`, `direct`,
`directTo`, or `finish`. A plain state update or a LangGraph `Command` also
works. It cannot return `stay()`, and it cannot return a bare string; use
`direct(content)` for that. `saveState()` and `graph.saveNodeState()` work as
they do in any node.

Probabilities are evidence, not policy. Thresholds, deterministic validation,
eligibility, and irreversible effects remain in application code. The demo's
readiness judge searches only when deterministic validation finds no issues
**and** Jev returns `ready` with `faithful.noul >= 0.75`.

### What Jev receives

Every call sends one JSON state and the prepared questions:

```ts
{
  ...getDecisionFacts(state),   // your JSON-compatible facts
  request: "newest human message in this node's history space",
  priorRequests: ["up to four earlier human messages"],
}
```

`request` and `priorRequests` are reserved. Facts that try to replace them
throw. Messages marked `ezgraphInternal`, such as the `terminate_session`
handoff, are excluded, while a real user message forwarded with
`withMessage()` counts. Nodes that must judge the same conversation should
share a history space, for example `[RouterDecisionNode, "hotel-intake"]`.
`defineQuestions(state)` runs once per invocation, so labels may depend on
durable state. Questions and input are snapshotted before any retry.

A decision node cannot publish chat tools or override the chat model. Both
throw at compile time, so the graph fails at startup instead of on a customer turn.

### Configure and register the provider

Set graph defaults in `GraphDefinition.decisionConfig`. A node can override any
field with `getDecisionConfig()`. Resolution order is framework defaults, then
graph, then node.

```ts
static getGraphDefinition(): GraphDefinition {
  return {
    llmConfig: ModelCatalog.model("openai:gpt-4o", { retries: 2, temperature: 0 }),
    decisionConfig: {
      provider: "typesafe", // default
      model: "jev-latest",  // default
      timeoutMs: 15_000,    // per attempt; default 30_000
      maxRetries: 2,        // extra attempts; default 0
    },
    endNode: GRAPH_END_NODE,
  };
}
```

Register decision providers at the composition root, beside the chat-model
providers:

```ts
GraphEngine.create({
  graphs: [DecisionHotelGraph],
  decisionProviders: DecisionProvider.create({
    typesafe: { apiKey: process.env.TYPESAFE_API_KEY },
  }),
  providers: ModelProvider.createBuiltinAdapters({
    openai: { apiKey: process.env.OPENAI_API_KEY },
  }),
});
```

Install the optional peer dependency `@langchain/typesafe` and set
`TYPESAFE_API_KEY` (or pass `apiKey`). The package loads lazily on the first
decision call. The engine resolves provider IDs when graphs are registered,
so a missing provider fails at startup. There is never a silent fallback to a
chat model. To use a different backend, implement `DecisionProviderAdapter`
(`id`, `decide()`, and optionally `shouldRetry()`) and add it to
`decisionProviders`. IDs must be unique.

### Failures, retries, and fallbacks

`DecisionRunner` owns the call policy. The TypeSafe SDK's own retries are disabled.

- Timeouts and errors the adapter marks transient are retried up to
  `maxRetries` times. For Jev these are 408, 429, 5xx, and connection or timeout errors.
- Responses that fail validation are not retried: a wrong answer type, an
  unknown label, an out-of-range score, or probabilities that do not sum to 1.
- Missing credentials, the missing package, invalid questions or facts, and
  401/403 are configuration errors. They throw and skip every fallback.
- Caller cancellation aborts the attempt and skips the fallbacks.
- Exceptions thrown by `onDecision()` or `onDecisionError()` propagate and are
  never retried.

For the remaining provider, timeout, and validation failures, a node
`onDecisionError(context)` can return a deterministic, code-owned response.
Returning `null` delegates to `BaseGraph.onDecisionError()`. If both return
`null`, the original error is rethrown.

```ts
protected override onDecisionError(
  context: DecisionErrorContext<HotelStateType>,
): GraphNodeResponse<HotelStateType> {
  const issues = validateCriteria(readCriteria(context.state));
  return issues.length
    ? directTo(nodeFor(issues[0]!.field), promptFor(issues[0]!.field))
    : go(SearchHotelsNode);
}
```

`context` includes `nodeId`, `provider`, `model`, `failure`
(`"provider" | "timeout" | "validation"`), `attempts`, `error`, and `state`.

### Usage and audit

Decision usage is tracked separately from chat-model `tokens` as
`state.decisionUsage` / `SessionDocument.decisionUsage`:
`{ calls, inputTokens, outputTokens, totalTokens }`. Every response the runtime
observes is counted, including one rejected by validation.
`SessionDocument.decisions` records provider, configured and actual model,
attempts, duration, request ID, and outcome for each call. Prompts, questions,
facts, and answers are never written there.

### Porting a PicoFlow `DecisionStep`

| PicoFlow | EZGraph |
| --- | --- |
| `class X extends DecisionStep<typeof Q>` | `class X extends DecisionNode<State, typeof Q>` |
| `Flow.defineSteps()` | `graph.registerTurnNodes(...)` |
| `Flow.configDecision()` | `GraphDefinition.decisionConfig` |
| `.useDecision({...})` | `getDecisionConfig()` |
| `getDecisionFacts()` | `getDecisionFacts(state)` |
| `.useMemory("name")` | `historySpaces: [[X, "name"]]` |
| `onDecision(answers, context)` | `onDecision(answers, context, state)` |
| returning a string | `direct(content)` |
| `Flow.onDecisionError()` | `BaseGraph.onDecisionError()` |
| `FlowEngine.create({ decisionProviders })` | `GraphEngine.create({ decisionProviders })` |

Question maps, answer types, `DecisionProvider.create({ typesafe })`, and the
defaults (`typesafe`, `jev-latest`, 30 s, zero retries) are the same.

The [DecisionHotelGraph tutorial](/ezgraph/docs/tutorials/decision-hotel-graph/)
walks through a complete graph with three decision nodes. A router,
a readiness judge, and a grounded-presentation judge sit between
`LlmNode` collectors, each with its own fallback.
