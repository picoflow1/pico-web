---
layout: layouts/ezgraph.njk
title: Graph topology and deterministic policy | EZGraph
description: Build graph edges explicitly and keep validation, authorization, and commit decisions in code.
permalink: /ezgraph/docs/developer-guide/topology/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Graph topology and deterministic policy

Build graph edges explicitly and keep validation, authorization, and commit decisions in code.

## Build topology explicitly

Register conversational entry points, then declare fixed worker edges.
Tool responses select conversational handoffs.

```ts
protected buildGraph() {
  const graph = this.createStateGraph(QuoteGraphState);
  graph.registerTurnNodes(
    DriverNode,
    VehicleNode,
    HistoryNode,
    CoverageNode,
    QuoteNode,
    TerminateSessionNode,
  );
  graph.addEdge(TerminateSessionNode, END);
  return graph.compile();
}
```

`LlmNode` inherits `terminate_session`. Every graph containing one
must register `TerminateSessionNode`, including one-shot file-extraction
graphs, then connect it to `END`.

## Keep policy deterministic

The model may collect a request, but deterministic code owns eligibility,
prices, IDs, durable commits, and irreversible transitions.

```ts
const adjudication = PolicyEngine.adjudicate(order, request.lineIds, request.reason);
if (adjudication.decision === "review") {
  return go(ApprovalNode).withState({
    pending: { request, quote: adjudication.quote!, reasons: adjudication.reasons },
  });
}
```

For an approval gate, generate the first pending-refund presentation from the
saved quote in code. The model should not invent a money amount, RMA, ticket
identifier, or completion claim.
