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

Each decision node overrides `onDecisionError(context)`. EZGraph calls it after a provider error
or timeout that outlasts the graph's `maxRetries: 2`, or immediately after an answer that fails
validation. Invalid answers are never retried.

- `RouterDecisionNode` shows a pending notice if there is one. Otherwise it prompts for the
  next missing criterion, or says the saved criteria are ready and invites “search”.
- `CriteriaReadinessDecisionNode` uses deterministic validation: it sends the first issue to its
  owner, or proceeds to `SearchHotelsNode` when there are none.
- `PresentationDecisionNode` returns the deterministic rendering of the saved hotel list.

These are different fallbacks because the three decision boundaries have different
responsibilities. Missing credentials, a missing `@langchain/typesafe` package, and
authentication failures are configuration errors, not outages. They fail the turn instead of
falling back.

## Test the full journey

`test/decision-hotel-graph/decision-hotel-graph.spec.ts` drives 23 real `GraphEngine` turns
through `createTurnHarness()`. Model replies come from a scripted gateway. Decisions come from an
inline `DecisionProviderAdapter` that derives answers from the request it receives. The suite
covers:

- an unrelated request, impossible and past dates, an inverted budget, and a negative distance
- a cross-step date correction and criteria review
- a readiness judge that sends the customer back to confirm the budget
- a rejected, invented presentation, empty results, and repeated revisions
- validated booking

It also simulates a decision-provider outage at each of the three decision nodes.
`hotel-search.spec.ts` checks the catalog search on its own.

```bash
npm run test:decision-hotel-graph
npm run test2:decision-hotel-graph
```

The live script sets `USE_ENV=1 KEEP_SESSION=1`, requires `TYPESAFE_API_KEY` and
`OPENAI_API_KEY`, and semantically judges the sixteen-turn scenario turn by turn. It is separate
from deterministic evidence; a skipped or failed live run must not be described as a provider
success.

## Next

Return to the [DecisionHotelGraph tutorial overview](/ezgraph/docs/tutorials/decision-hotel-graph/) or
learn how a quote uses the same boundaries in [QuoteGraph](/ezgraph/docs/tutorials/quote-graph/).
