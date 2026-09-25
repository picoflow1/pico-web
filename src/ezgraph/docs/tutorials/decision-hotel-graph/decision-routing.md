---
layout: layouts/ezgraph.njk
title: 3. Typed decision routing
description: Restrict routing to declared decision outcomes and keep the effect of each outcome in code.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/
ezgraph: true
ezgraphDocument: true
---

# 3. Typed decision routing

## The goal

Use a decision model to classify a request without letting it invent a route or perform an
effect. The graph's `decisionConfig` selects TypeSafe's Jev (`provider: "typesafe"`,
`model: "jev-latest"`), a non-generative model that returns probabilities over declared labels
rather than text.

## Declare the allowed answers

`RouterDecisionNode` extends `DecisionNode` and defines two choice questions. `destination`
selects among dates, budget, room type, amenities, distance, review, search, exit, and unclear.
`request_delivery` decides whether the latest request contains a value the selected collector
must apply, or whether that criterion is merely the next unresolved field.

```ts
export const ROUTING_QUESTIONS = {
  destination: {
    type: "choice",
    criteria: {
      dates: "Set or revise dates",
      // budget, room_type, amenities, distance, review, search, exit ...
      unclear: "Ambiguous or outside this flow",
    },
  },
  request_delivery: {
    type: "choice",
    criteria: {
      apply_request: "The latest request contains a new value or revision that the selected collector must apply",
      prompt_next: "The selected criterion is merely the next unresolved field",
      none: "The destination is not a criterion collector",
    },
  },
} as const satisfies DecisionQuestionMap;
```

The decision provider can return only one of those declared labels, and EZGraph rejects any
other answer before `onDecision()` runs. The node's code maps the answer to `go(...)`,
`directTo(...)`, or `finish(...)`; it does not execute a provider-generated function name or
route string. `getPrompt()` supplies the saved criteria and unresolved issues as shared
guidance, and `getDecisionFacts()` adds the same criteria as JSON facts.

```ts
if (route === "exit") {
  return finish("Thanks for considering Hilton hotels in Portland.");
}
if (route === "search") {
  if (context.request.trim().toLowerCase() !== "search") {
    // Not an explicit search: prompt for the next missing criterion, or show the summary.
    return issues.length
      ? directTo(CriteriaHelper.nextNode(issues[0]!), CriteriaHelper.criteriaPrompt(issues[0]!.field))
      : directTo(RouterDecisionNode, `${CriteriaHelper.renderCriteriaSummary(criteria)}\n\n...`);
  }
  return issues.length
    ? go(CriteriaHelper.nextNode(issues[0]!))
    : go(CriteriaReadinessDecisionNode);
}
```

A search runs only when the customer literally asks for one. A classification of `search`
alone is not enough to trigger the backend.

## Preserve a cross-step request

When a user revises dates while the graph is prompting for amenities, the router selects
`DateRangeNode`. If `request_delivery` is `apply_request`, or dates were already answered, it
forwards the customer's actual message:

```ts
return go(CriteriaHelper.nextNode(route)).withMessage(new HumanMessage(context.request));
```

Otherwise it asks that criterion's question with `directTo(...)` and waits for the next turn.
The destination therefore receives a customer instruction, not a synthetic internal command.

## Why it is written this way

Decision selection is bounded; routing and effects remain readable application code. That gives
the system flexibility for ordinary language while retaining an auditable answer to “what can
this request cause the graph to do?”

## Next

Continue to [4. Criteria ownership and corrections](/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/).
