---
layout: layouts/ezgraph.njk
title: DecisionHotelGraph tutorial
description: Build a durable hotel search and booking graph with typed decision nodes, deterministic validation, grounded presentation, and safe fallbacks.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/
ezgraph: true
ezgraphDocument: true
---

# DecisionHotelGraph tutorial

`DecisionHotelGraph` is a multi-turn Portland hotel search and booking application. It uses
typed decision nodes for routing, criteria review, and presentation review while keeping
criteria validation, hotel lookup, booking, and fallback rendering in application code. The
decision nodes call TypeSafe's Jev model through EZGraph's `DecisionNode`; see the
[developer guide](/ezgraph/docs/developer-guide/#decision-nodes-with-jev) for the API. The
implementation lives in
[ezgraph-demo](https://github.com/picoflowio/ezgraph-demo/tree/main/src/graphs/decision-hotel-graph).

## What this tutorial covers

```text
RouterDecisionNode ──set or revise──→ DateRangeNode | BudgetNode | RoomTypeNode | AmenityNode | DistanceNode
criterion node ──capture or reroute_request──→ RouterDecisionNode
RouterDecisionNode ──"search"──→ CriteriaReadinessDecisionNode ──ready──→ SearchHotelsNode
SearchHotelsNode ──no matches (saved notice)──→ RouterDecisionNode
SearchHotelsNode ──results──→ PresentNode ──publish_hotel_draft──→ PresentationDecisionNode
PresentationDecisionNode ──reviewed draft or grounded fallback──→ PresentNode
PresentNode ──revise_search──→ RouterDecisionNode
PresentNode ──chosen_hotel──→ finish()
```

The graph collects dates, budget, room type, amenities, and distance in separate owner nodes.
It can route a cross-step correction to the right owner, reject an incomplete criteria review,
fall back from an unavailable decision provider, and present only results returned by the local
hotel search.

## The seven lessons

1. [A sixteen-turn live replay](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/) — the
   complete recorded journey through corrections, search recovery, and booking.
2. [Graph and durable criteria](/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/) —
   map ten nodes to one explicit graph state registry.
3. [Typed decision routing](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/) —
   have a decision provider select an allowed route, never execute an arbitrary model action.
4. [Criteria ownership and corrections](/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/) —
   retain each normalized fact with its specialist and reroute revisions.
5. [Readiness before search](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/) —
   combine a decision review with deterministic validation and a side-effect boundary.
6. [Grounded presentation and booking](/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/) —
   review a draft against saved results and validate the selected hotel.
7. [Fallbacks and evaluation](/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-testing/) —
   make a provider failure safe and distinguish contract from live evidence.

## Running it

```bash
cd ezgraph-demo
npm run test:decision-hotel-graph
npm run test2:decision-hotel-graph
```

The deterministic suite covers routing, corrections, search, and fallbacks with scripted model
and decision replies. The second script sets `USE_ENV=1 KEEP_SESSION=1` and runs the semantic
scenario live; it is skipped unless `TYPESAFE_API_KEY` and `OPENAI_API_KEY` are also set. It is
not a substitute for deterministic policy tests.

## Next

Start with [1. A sixteen-turn live replay](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/).
