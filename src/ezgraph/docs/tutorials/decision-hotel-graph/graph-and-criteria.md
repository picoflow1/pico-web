---
layout: layouts/ezgraph.njk
title: 2. Graph and durable criteria
description: Define DecisionHotelGraph's nodes, history spaces, and one owner for every search criterion.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/
ezgraph: true
ezgraphDocument: true
---

# 2. Graph and durable criteria

## The goal

Represent a real booking journey as explicit stages rather than a single prompt with hidden
state.

## Register every stage

`DecisionHotelGraph` registers a router, five criterion collectors, a readiness decision node,
a deterministic search node, a presentation node, a presentation decision node, and the
terminal node. The state registry mirrors that ownership: date ranges live in `DateRangeNode`,
budgets in `BudgetNode`, and found hotels plus a selected hotel in `PresentNode`.

```ts
graph.registerTurnNodes(
  RouterDecisionNode, DateRangeNode, BudgetNode, RoomTypeNode, AmenityNode,
  DistanceNode, CriteriaReadinessDecisionNode, SearchHotelsNode, PresentNode,
  PresentationDecisionNode, TerminateSessionNode,
);
```

## Use history spaces deliberately

The router, collection nodes, and readiness review share `hotel-intake`. Presentation and its
grounding review share `hotel-present`; completion gets `hotel-terminal`. This keeps the search
criteria conversation available while preventing presentation wording from becoming intake
context by accident.

## Why it is written this way

The graph’s state map is the record of what the application knows, while history is only what a
node may show to a model. Separating them makes an across-stage correction deterministic: the
router can send a date revision to `DateRangeNode` even while another criterion stage was active.

## Next

Continue to [3. Typed decision routing](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/).
