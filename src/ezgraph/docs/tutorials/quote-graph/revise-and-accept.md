---
layout: layouts/ezgraph.njk
title: 6. Revisions, direct responses, and acceptance
description: Reprice a current quote in code, route backward to coverage, and finish only when the customer accepts a displayed tier.
permalink: /ezgraph/docs/tutorials/quote-graph/revise-and-accept/
ezgraph: true
ezgraphDocument: true
---

# 6. Revisions, direct responses, and acceptance

## The goal

Support “what if” questions without making an old price or a model-generated tier authoritative.

## Render a recalculated result directly

`adjust_quote` merges only supplied changes into saved coverage, runs the same coverage
validation and rating engine, persists the resulting coverage and tiers, then returns
`direct(response)`. The response is formatted from the calculated tiers, so this branch requires
no second model call and keeps `QuoteNode` active.

## Route backward with the real request

If the customer asks to rework coverage rather than make a small adjustment, `revise_coverage`
forwards the customer's latest message to the coverage stage:

```ts
return go(CoverageNode).withMessage(new HumanMessage(this.graph.input(state)));
```

`CoverageNode` receives the customer’s actual request in its intake history, not a synthetic
instruction, and collects a new valid selection before another rating run.

## Finish from the current tier list

`accept_quote` looks up the requested tier in `QuoteNode`’s saved `tiers` before it generates a
reference, saves `acceptedTier` and `referenceNumber`, and returns `finish(...)` with a
code-rendered confirmation. A tier that is not in the current list cannot be accepted, and
because `adjust_quote` replaces the saved tiers, acceptance always uses the latest calculated
premium.

## Why it is written this way

The graph distinguishes an explanation from a business event. A displayed quote may be revised;
an acceptance must be tied to the current calculated tier and leave an auditable accepted tier
and reference number in durable state.

## Next

Continue to [7. Testing the whole quote](/ezgraph/docs/tutorials/quote-graph/testing/).
