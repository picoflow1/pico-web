---
layout: layouts/ezgraph.njk
title: Graph topology and deterministic policy | EZGraph
description: Register conversation ownership, schedule internal LLM work, and use conditional fan-out with an explicit join.
permalink: /ezgraph/docs/developer-guide/topology/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Graph topology and deterministic policy

Register conversation ownership and internal work, then keep validation,
authorization, and commit decisions in code.

## Build topology explicitly

Register conversational entry points, then declare fixed worker edges.
Tool responses select conversational handoffs or conditional fan-out.

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

Conversational `LlmNode`s inherit `terminate_session`. Graphs with these nodes
must register `TerminateSessionNode`, including one-shot extraction graphs whose
nodes own responses and completion, then connect it to `END`. Internal LLM
workers do not offer that tool.

## Conditional fan-out and join

Return `go(Child1Node, Child2Node)` only when the parent has accepted and saved
the input. In DemoGraph, the movie-recording tool is that boundary:

```ts
@Tool("recordMovieIdea")
async recordMovieIdea(submitted: MovieIdea): Promise<ToolResponse> {
  this.saveState({ movieIdea: submitted });
  return go(Child1Node, Child2Node);
}
```

Both children are ordinary `LlmNode`s that save their output in `onResponse()`.
Register all nodes, identify the conversational owners, and connect an explicit
two-source barrier. This excerpt shows the fan-out portion of the graph:

```ts
protected buildGraph() {
  const graph = this.createStateGraph(DemoGraphState);
  graph.nodes(
    InContextNode,
    Child1Node,
    Child2Node,
    DobNode,
    TerminateSessionNode,
  );
  graph.registerTurns(InContextNode, DobNode, TerminateSessionNode);
  graph.addEdge([Child1Node, Child2Node], DobNode);
  graph.addEdge(TerminateSessionNode, END);
  return graph.compile();
}
```

Leaving the children out of `registerTurns()` makes them internal work. Each
uses the shared runner, model config, tools, response handling, and error hooks,
but publishes only its own node state and token usage. The state reducers merge
the independent child channels and sum their usage.

The multi-target transition sets `inputConsumed: true` and clears the current
reply while leaving `currentNode` with `InContextNode`. Neither child takes
ownership of the next user turn. The array-source edge waits for **both** children
and runs `DobNode` once with their results; its conversational reply makes DOB
the next turn owner. If a child fails without recovery, DOB does not run.

Do not add unconditional child edges out of the conversational parent. Static
edges run independently of a command's destinations, including when the parent
returns an ordinary reply or routes to termination. Conditional `go()` keeps
rejected movie arguments, ordinary replies, and termination out of the fan-out.
See [response effects](/ezgraph/docs/developer-guide/tool-responses/#fan-out-response-effects)
for multi-target builder rules.

## Sequential and fixed-entry workers

The same child classes can run sequentially. With a turn registry, leave them
out of `registerTurns()` and connect the worker pipeline. For a fixed-entry
graph, `workers()` registers missing classes and marks them as internal.
Connect `START` and continuation edges explicitly. For example, an
internal-only pipeline can use:

```ts
const WorkerState = createGraphStateAnnotation(Child1Node.id());
const graph = this.createStateGraph(WorkerState);
graph.workers(Child1Node, Child2Node);
graph.addEdge(START, Child1Node);
graph.addEdge(Child1Node, Child2Node);
graph.addEdge(Child2Node, END);
return graph.compile();
```

Scheduling differs; the node implementations do not. Nested callers use
[the same invocation contract](/ezgraph/docs/developer-guide/nodes-and-execution/#nested-calls).

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
