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

Use an LLM-backed decision provider to classify a request without letting it invent a route or
perform an effect.

## Declare the allowed answers

`RouterDecisionNode` defines two decision questions. `destination` is a choice among dates,
budget, room type, amenities, distance, review, search, exit, and unclear. `request_delivery`
decides whether the exact user request must be forwarded to a criterion node.

The decision provider can return only one of those declared values. The node’s code maps the
answer to `go(...)`, `directTo(...)`, or `finish(...)`; it does not execute a provider-generated
function name or route string.

```ts
case "search":
  return issues.length > 0
    ? go(CriteriaHelper.nextNode(issues))
    : go(CriteriaReadinessDecisionNode);
case "exit":
  return finish("Thanks for considering Hilton hotels in Portland.");
```

## Preserve a cross-step request

When a user revises dates while the graph is prompting for amenities, the router forwards the
real user message to `DateRangeNode` only when the typed `request_delivery` answer requires it.
The destination therefore receives a customer instruction, not a synthetic internal command.

## Why it is written this way

Decision selection is bounded; routing and effects remain readable application code. That gives
the system flexibility for ordinary language while retaining an auditable answer to “what can
this request cause the graph to do?”

## Next

Continue to [4. Criteria ownership and corrections](/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/).
