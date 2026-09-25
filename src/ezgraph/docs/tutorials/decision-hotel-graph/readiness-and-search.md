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
list as decision evidence, together with the framework-supplied intake conversation. It asks two
questions: an `outcome` choice (ready, one of the five criteria, or unclear) and a `faithful`
Noul probability that the saved criteria reflect what the customer asked for. Code accepts
“ready” only if deterministic validation has no issues and `faithful` reaches the application's
0.75 threshold.

```ts
const accepted = issues.length === 0 && outcome === "ready" && answers.faithful.noul >= 0.75;
this.saveState({ review: answers, accepted });
if (issues.length) return go(CriteriaHelper.nextNode(issues[0]!));
if (accepted) return go(SearchHotelsNode);
```

If the judge names a specific criterion, the node asks that criterion's question with
`directTo(...)`. An unclear or low-faithfulness result shows the summary and asks the customer
which single criterion to update.

## Keep the search deterministic

`SearchHotelsNode` extends `GraphNode` directly: it has no prompt, tools, or model call. It
validates the snapshot again and sends any remaining issue to its owner node. It then filters and
prices the local JSON hotel catalog in code. An empty result set returns to the router with a
saved `notice`, which the router shows on its next run. A non-empty result list enters
`PresentNode` with the hotels, the criteria snapshot, and the review outcome as target-owned
state.

```ts
const hotels = searchHotels(criteria);
if (!hotels.length) {
  return this.resolveNodeResponse(
    go(RouterDecisionNode).withState({ notice: "No hotels matched all current criteria. ..." }),
  );
}
return this.resolveNodeResponse(
  go(PresentNode).withState({ hotelFound: hotels, criteria, criteriaReviewAccepted }) /* ... */,
);
```

## Why it is written this way

The decision node catches a mismatch between the conversation and normalized state. Deterministic
validation remains the final authority, and the actual search happens only at one inspectable
boundary.

## Next

Continue to [6. Grounded presentation and booking](/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/).
