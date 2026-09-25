---
layout: layouts/ezgraph.njk
title: 4. Criteria ownership and corrections
description: Let each hotel criterion node validate its own state while the router redirects a correction to the right owner.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/
ezgraph: true
ezgraphDocument: true
---

# 4. Criteria ownership and corrections

## The goal

Accept corrections without overwriting unrelated facts or asking the customer to restart the
conversation.

## One owner per normalized criterion

`DateRangeNode`, `BudgetNode`, `RoomTypeNode`, `AmenityNode`, and `DistanceNode` each validate
and save only their own normalized channel. `CriteriaHelper` reads those channels into a snapshot
and knows which registered node owns each missing or invalid criterion.

For example, a budget node rejects an inverted minimum/maximum range in code and stays active;
it does not save a malformed range for a later model call to interpret.

## Reroute an out-of-stage revision

Each criterion node exposes a reroute path. If the user gives a date change while the current
node owns amenities, that request goes back to `RouterDecisionNode`, which selects
`DateRangeNode` and forwards the original message. Once the correction is saved, the graph
returns to the appropriate next unresolved criterion or review state.

## Why it is written this way

The chat feels non-linear, but the data is not. A correction has a single authoritative owner;
the helper can invalidate the right downstream conclusion rather than relying on a summary prompt
to decide which previous answer changed.

## Next

Continue to [5. Readiness before search](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/).
