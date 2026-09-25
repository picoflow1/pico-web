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
and save only their own normalized channel, with an `answered` flag. `CriteriaHelper` reads those
channels into a snapshot, validates it, and maps each missing or invalid criterion to the node
that owns it.

For example, `BudgetNode` rejects a negative value or an inverted minimum/maximum range in code
and returns `stay(...)`; it does not save a malformed range for a later model call to interpret.
A valid capture saves the channel and returns `go(RouterDecisionNode)`, so the router picks the
next step.

## Reroute an out-of-stage revision

Every criterion node handles a shared `reroute_request` tool, which `DateRangeNode` defines and
the other collectors reuse through `@Tool("reroute_request")`. If the user gives a date change
while `AmenityNode` is active, that node calls `reroute_request` and returns
`go(RouterDecisionNode)`. The router reads the same latest request from the shared `hotel-intake`
history, selects `DateRangeNode`, and forwards the original message. Once the correction is saved,
the router runs again and returns to the next unresolved criterion or the review state.

## Why it is written this way

The chat feels non-linear, but the data is not. A correction has a single authoritative owner,
and every later step re-reads the saved channels. Validation, readiness review, and search all
work from the current snapshot, rather than a summary prompt deciding which previous answer
changed.

## Next

Continue to [5. Readiness before search](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/).
