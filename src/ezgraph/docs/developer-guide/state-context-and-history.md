---
layout: layouts/ezgraph.njk
title: State, context, and history | EZGraph
description: Choose the initial node, route history, and manage durable node state and graph context.
permalink: /ezgraph/docs/developer-guide/state-context-and-history/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# State, context, and history

Choose the initial node, route history, and manage durable node state and graph context.

## Initial node and history routing

The first argument to `createGraphStateAnnotation()` declares the initial
`currentNode`. In the [node contract example](/ezgraph/docs/developer-guide/nodes-and-execution/#the-node-contract), a new session starts at `DriverNode`.
Map that node to a named history in the graph definition:

```ts
static getGraphDefinition(): GraphDefinition {
  return {
    llmConfig: ModelCatalog.model("openai:gpt-5.4", { retries: 2 }),
    endNode: GRAPH_END_NODE,
    historySpaces: [
      [DriverNode, "quote-intake"],
      [VehicleNode, "quote-intake"],
    ],
  };
}
```

Before invoking a node, `BaseGraph.prepareInput()` resolves the cursor, chooses
its history space, and appends the customer's message there. The START branch
created by `registerTurnNodes()` then enters that same node.

| Session | Cursor used for input | History space |
| --- | --- | --- |
| New session | The state schema's initial `currentNode`, here `DriverNode.id()` | The initial node's mapping, here `"quote-intake"` |
| Restored session | The saved `currentNode` | The saved node's mapping |
| Session reset by `onRestoreSessionDoc()` returning `null` | The state schema's initial `currentNode` | The initial node's mapping |
| Any selected node without a mapping | The cursor resolved above | `"default"` |

Node registration order does not choose the initial cursor. Keep the initial
node registered as a turn node, and supply a non-empty cursor default; preparing
a first message without that default fails before model work begins.

For complete examples, see [QuoteGraph's history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/#four-history-spaces)
and [DecisionHotelGraph's history spaces](/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/#history-spaces).

## Graph-wide runtime context

Use `context` for runtime information shared across stages. New graph states
start with `{}`, and the session document saves it under `graph.context`.
For example, a QuoteGraph session can contain this fragment:

```json
{
  "graph": {
    "id": "QuoteGraph",
    "context": {
      "rating": {
        "calculatedAt": "2027-06-01T10:00:00.000Z",
        "businessDate": "2027-06-01"
      }
    }
  }
}
```

During an active node invocation:

```ts
this.graph.saveContext({
  rating: { calculatedAt: now.toISOString() },
});
const context = this.graph.getContext();
```

`BaseGraph` exposes the same methods for graph-owned policies. `saveContext()`
replaces the supplied top-level branches while preserving unrelated branches.
Writing `rating` again replaces that entire subtree; nested objects and arrays
are not deep-merged. `null` remains an ordinary JSON value.

The root is a JSON object; values may be nested objects, arrays, strings, finite
numbers, booleans, or null. The framework rejects undefined, functions, dates,
circular references, and other non-JSON values. Convert dates to ISO strings.
Writes are cloned; reads are detached, deeply frozen snapshots.

A successful node outcome publishes staged context to the next node and the
normal session checkpoint. If the node throws, its staged changes are discarded;
previously completed checkpoints retain theirs. Concurrent sessions are isolated.
A parallel superstep permits one context writer. Internal `LlmNode` workers
may read graph context but cannot write it, even when they execute sequentially
or in a nested call. Consolidate their local output in a conversation-owning or
deterministic join node before updating shared context.

`createGraphStateAnnotation()` declares the context channel. Custom
`Annotation.Root()` schemas can import `GraphContextChannel` from
`@picoflow/ezgraph` and declare `context: new GraphContextChannel()`.
Outside execution, inspect saved context in the session returned by
`GraphEngine.getSession()`.

In QuoteGraph, coverage calculation and quote adjustment write rating timestamps.
Acceptance reads that shared metadata and saves an acceptance timestamp. Business
facts remain in node state, request options remain in `config`, and context is
included in prompts only when application code explicitly adds it. See the
[QuoteGraph context example](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/#shared-runtime-context).

## State belongs to the node that owns it

Inside an active node invocation, `saveState()` stages a patch to the current
node channel. EZGraph materializes that channel and LangGraph's node reducer
replaces it atomically. A conversational or deterministic owner can use
`graph.saveNodeState()` for another node's channel. An internal `LlmNode` may
write only its own channel and token usage.

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput): Promise<ToolResponse> {
  const driver = validateDriver(input);
  if ("error" in driver) return stay(JSON.stringify({ accepted: false, error: driver.error }));

  this.saveState({ driver: driver.value });
  return go(VehicleNode);
}
```

The node publishes the tool's name, description, and zod schema from
`defineTool()`; `@Tool(name)` binds the handler. Arguments are schema-validated
before the handler runs, and invalid arguments return `{ accepted: false, error }`
to the model instead of throwing.

```ts
this.saveState({ criteria });
this.graph.saveNodeState(PresentNode, { hotelFound: results });
return go(PresentNode).withMessage(
  new HumanMessage("Present the current hotel choices and booking options."),
);
```

`graph.graphState()` exposes the invocation's materialized graph state. Use it
when deterministic policy needs data owned by another node. Do not mutate a
node instance or a session document directly.

With conditional fan-out, save parent-owned input before returning
`go(Child1Node, Child2Node)`. Each worker supplies explicitly selected facts
through `getPrompt(state)` or constructs a task message in
[`onEnter()`](/ezgraph/docs/developer-guide/nodes-and-execution/#prepare-input-with-onenter),
then saves accepted output in `onResponse()`. Its model history
is ephemeral, not a copy of a named conversation history. The parent remains
the durable conversation cursor until the joined conversational stage responds.
See [execution ownership](/ezgraph/docs/developer-guide/nodes-and-execution/#execution-ownership)
and [fan-out and join](/ezgraph/docs/developer-guide/topology/#conditional-fan-out-and-join).
