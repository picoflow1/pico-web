---
layout: layouts/ezgraph.njk
title: 5. Deterministic rating
description: Validate coverage against vehicle ownership and calculate tiers in code before the presentation node runs.
permalink: /ezgraph/docs/tutorials/quote-graph/deterministic-rating/
ezgraph: true
ezgraphDocument: true
---

# 5. Deterministic rating

## The goal

Keep a price, lender requirement, and quote tier out of model-generated prose.

## Coverage is a policy boundary

`CoverageNode` reads the committed vehicle-use channel through `this.graph.graphState()`,
validates the requested coverage against ownership and the quote clock, then builds the rating
subject from the registered node channels.

```ts
const state = this.graph.graphState();
const use = state.nodes.VehicleNode?.vehicle;
// ...build `coverage` from the tool input...
const error = validateCoverageSelection(coverage, use.ownership, now);
if (error) return reject(error); // stay(JSON.stringify({ accepted: false, error }))

const rating = buildRatingSubject(state.nodes);
if ("error" in rating) return reject(rating.error);

const tiers = RatingEngine.quoteTiers(rating.subject, coverage, now);
this.saveState({ coverage });
this.graph.saveNodeState(QuoteNode, { tiers });
return go(QuoteNode).withMessage(new HumanMessage("Present the quote tiers."));
```

`QuoteNode` uses its own `quote-present` history space, so the transition adds an explicit
stage instruction there rather than replaying the intake conversation.

For example, a financed vehicle cannot be quoted as liability-only. The model can explain the
rule, but it cannot waive it or calculate a replacement premium.

## Seed the presentation atomically

The current coverage belongs to `CoverageNode`; calculated tiers belong to `QuoteNode`. The
coverage handler writes each channel before routing, so `QuoteNode` begins with the exact tier
list it is allowed to present.

## Why it is written this way

The quote changes if any accepted fact changes. A deterministic engine makes that relationship
testable and lets the presentation stage answer naturally without owning hidden pricing logic.

## Next

Continue to [6. Revisions, direct responses, and acceptance](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/).
