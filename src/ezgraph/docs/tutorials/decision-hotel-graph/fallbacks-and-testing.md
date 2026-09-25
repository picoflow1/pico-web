---
layout: layouts/ezgraph.njk
title: 7. Fallbacks and evaluation
description: Define deterministic behavior for unavailable decision providers and test corrections, empty results, grounding, and booking separately from live evidence.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-testing/
ezgraph: true
ezgraphDocument: true
---

# 7. Fallbacks and evaluation

## The goal

Fail safely when a decision provider cannot answer, and verify the behavior without presenting a
mock as live-provider evidence.

## Each decision boundary owns a fallback

`RouterDecisionNode` either sends the next missing criterion or renders the saved criteria.
`CriteriaReadinessDecisionNode` uses deterministic validation to pick the next correction or
search. `PresentationDecisionNode` renders the saved hotel list deterministically. These are
different fallbacks because the three decision boundaries have different responsibilities.

## Test the full journey

The deterministic suite covers invalid calendar dates, an inverted budget, a cross-step date
correction, criteria review, empty results, a second successful search, grounded presentation,
and validated booking. It also simulates decision-provider outages at each decision boundary.

```bash
npm run test:decision-hotel-graph
USE_ENV=1 KEEP_SESSION=1 npm run test2:decision-hotel-graph
```

The live command uses configured providers and checks the semantic scenario turn by turn. It is
separate from deterministic evidence; a skipped or failed live run must not be described as a
provider success.

## Next

Return to the [DecisionHotelGraph tutorial overview](/ezgraph/docs/tutorials/decision-hotel-graph/) or
learn how a quote uses the same boundaries in [QuoteGraph](/ezgraph/docs/tutorials/quote-graph/).
