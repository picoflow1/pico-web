---
layout: layouts/ezgraph.njk
title: 2. Graph and state ownership
description: Define QuoteGraph's topology and one durable channel per node.
permalink: /ezgraph/docs/tutorials/quote-graph/graph-and-state/
ezgraph: true
ezgraphDocument: true
---

# 2. Graph and state ownership

## The goal

Make the quote's stages and durable facts visible in one place. `QuoteGraph` has no mutable
"current quote" object shared among nodes: every accepted fact has a named owner in the graph
state registry.

## Register the conversational topology

`buildGraph()` names every node a tool response may enter. The only fixed edge connects
`TerminateSessionNode` to `END`; ordinary forward and backward movement comes from
`go(TargetNode)`, and acceptance completes the graph with `finish(...)`.

```ts
const graph = this.createStateGraph(QuoteGraphState);
graph.registerTurnNodes(
  DriverNode, VehicleNode, HistoryNode, CoverageNode, QuoteNode, TerminateSessionNode,
);
graph.addEdge(TerminateSessionNode, END);
return graph.compile();
```

Registration is an allowlist. A node cannot route to a class that the graph did not register.

## Make ownership explicit

The state registry declares the channel each stage may replace:

```ts
export type QuoteGraphNodes = {
  DriverNode?: NodeStateValue<{ driver?: DriverProfile }>;
  VehicleNode?: NodeStateValue<{ resolvedVehicleId?: string; vehicle?: VehicleUse }>;
  HistoryNode?: NodeStateValue<{ history?: InsuranceHistory }>;
  CoverageNode?: NodeStateValue<{ coverage?: CoverageSelection }>;
  QuoteNode?: NodeStateValue<{
    tiers?: QuoteTier[];
    acceptedTier?: QuoteTierName;
    referenceNumber?: string;
  }>;
};
```

`createGraphStateAnnotation(DriverNode.name, ...)` produces the LangGraph annotation from this
map and makes `DriverNode` the entry node of a new session. It is not a second
application-state shape to synchronize.

## Why it is written this way

When `DriverNode` saves a validated driver, no other stage needs to infer whether the name in
the transcript is the accepted fact. A downstream policy can read the committed channel, and a
test can assert it directly. This matters when the customer corrects coverage after a quote was
already calculated.

## Next

Continue to [3. Validated collection and catalog lookup](/ezgraph/docs/tutorials/quote-graph/validated-tools/).
