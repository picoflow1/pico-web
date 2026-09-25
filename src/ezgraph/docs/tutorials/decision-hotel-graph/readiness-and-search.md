---
layout: layouts/ezgraph.njk
title: 5. Readiness before search
description: Combine deterministic criteria validation with a bounded decision review before calling the hotel search boundary.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/
ezgraph: true
ezgraphDocument: true
---

# 5. Readiness before search

## The goal

Do not call a backend search solely because a model says the request sounds complete.

## Review the saved snapshot

`CriteriaReadinessDecisionNode` receives the normalized criteria and the deterministic issue
list. It can label the snapshot ready, point to one criterion that needs correction, or mark the
conversation unclear. Code accepts its “ready” answer only if deterministic validation has no
issues and the faithfulness score reaches the configured threshold.

```ts
const accepted = issues.length === 0 && outcome === "ready" && answers.faithful.noul >= 0.75;
if (issues.length > 0) return go(CriteriaHelper.nextNode(issues[0]!));
if (accepted) return go(SearchHotelsNode);
```

## Keep the search deterministic

`SearchHotelsNode` is an ordinary logic node. It validates the snapshot again, invokes the
hotel-search module, and branches in code: a provider/search failure and an empty result set
return to the router with a saved corrective notice; a non-empty result list enters
`PresentNode` with that list as target-owned state.

## Why it is written this way

The decision node catches a mismatch between the conversation and normalized state. Deterministic
validation remains the final authority, and the actual search happens only at one inspectable
boundary.

## Next

Continue to [6. Grounded presentation and booking](/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/).
