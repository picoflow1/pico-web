---
layout: layouts/ezgraph.njk
title: Developer guide | EZGraph
description: Build durable conversational graph nodes with explicit state writes and direct tool responses.
permalink: /ezgraph/docs/developer-guide/
ezgraph: true
ezgraphDocument: true
---

# EZGraph developer guide

EZGraph is a TypeScript layer for durable, multi-turn LangGraph applications.
Each graph node owns its prompt, tools, state writes, and transition decision.
LangGraph owns execution; EZGraph supplies the contracts that keep a conversation
resumable and auditable.

The current API has one rule worth remembering:

> A tool handler writes durable state itself, then returns `go`, `stay`, `direct`, or `finish`.

There is no deferred tool-result builder, `nextStep()`, `createContext()`,
`turnState()`, or automatic outcome routing.

## The node contract

Define graph-owned state once. The node registry is the durable schema: every
node channel LangGraph replaces lives there.

```ts
import { createGraphStateAnnotation, type NodeStateValue } from "@picoflow/ezgraph";
import { DriverNode } from "./nodes/driver.node.js";

export type QuoteGraphNodes = {
  DriverNode?: NodeStateValue<{ driver?: DriverProfile }>;
  VehicleNode?: NodeStateValue<{ vehicle?: VehicleUse }>;
};

export const QuoteGraphState = createGraphStateAnnotation(
  DriverNode.name,
  () => ({} as QuoteGraphNodes),
);

export type QuoteGraphStateType = typeof QuoteGraphState.State;
```

Conversational nodes normally need only the graph state type.

```ts
export class DriverNode extends ConversationNode<QuoteGraphStateType> {
  getPrompt() {
    return "Collect the driver's identity and licence details.";
  }
}
```

Use a local cast from the registry only where TypeScript needs the exact
node-channel shape. The class does not carry a redundant second state generic.

## State belongs to the node that owns it

Inside an active node invocation, `saveState()` stages a patch to the current
node channel. EZGraph materializes that channel and LangGraph's node reducer
replaces it atomically. Use `graph.saveNodeState()` for another node's channel.

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput): Promise<ToolResponse> {
  const driver = validateDriver(input);
  if ("error" in driver) return stay(JSON.stringify({ accepted: false, error: driver.error }));

  this.saveState({ driver: driver.value });
  return go(VehicleNode);
}
```

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

## Return one direct tool response

| Response | Meaning |
| --- | --- |
| `stay(feedback)` | Keep this node active and give the model corrective tool feedback. The agent loop continues. |
| `go(Target)` | Save the target as the durable resume node and enter it in the same graph invocation. |
| `direct(content)` | Stop model work and return code-owned content while keeping the graph active. |
| `finish(content)` | Stop model work and complete the graph with code-owned content. |

Use `withState()` on `go(Target)` when the transition itself seeds target state.

```ts
const pending: PendingRefund = { request, quote, reasons };
return go(ApprovalNode).withState({ pending });
```

Use `withMessage()` only for a genuine target-stage instruction. To preserve a
customer's input across a distinct history space, append that actual input to
the target history deliberately; never manufacture a user message just to
express internal control flow.

```ts
const request = this.graph.input(this.graph.graphState());
this.graph.appendHistory(this.graph.historySpace(ReturnsNode.id()), [
  new HumanMessage(request),
]);
return go(ReturnsNode);
```

## Build topology explicitly

Register conversational entry points, then declare only genuine fixed worker
edges. Tool responses select conversational handoffs; there is no
`configAutoRoute()` call.

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

`ConversationNode` inherits `terminate_session`. Every graph containing one
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

## File attachments

`ToolResponse` supports model-visible attachment messages and cleanup. A file
tool can remain in the same agent loop without reviving the old result type.

```ts
return stay(JSON.stringify({ attached: true, fileName: name, fileId: upload.fileId }))
  .withCleanup(upload.cleanup)
  .withMessages([
    new HumanMessage({ content: [
      { type: "text", text: "Analyze the attached file and submit the extraction." },
      upload.contentPart,
    ] }),
  ]);
```

## Test in two tiers

Keep deterministic graph tests separate from opt-in provider evaluation.

```json
{
  "test:quote-graph": "node --import tsx --test test/quote-graph/*.spec.ts",
  "test2:quote-graph": "USE_ENV=1 KEEP_SESSION=1 node --import tsx --test test/quote-graph/quote-graph.e2e.spec.ts"
}
```

`USE_ENV=1` is the single live-provider switch. `KEEP_SESSION=1` retains the
session only when a replay needs inspection. Assertions about durable state
belong in deterministic tests; semantic judges and provider calls remain
explicitly opt-in.

## Migration checklist

1. Replace `ConversationNode<State, LocalState, Context>` with `ConversationNode<State>`.
2. Move channel shapes into the graph's `*GraphNodes` registry.
3. Replace `this.toolResult()` with `stay`, `go`, `direct`, or `finish`.
4. Replace `turnState()` with `getState()` and `turnGraphState()` with `graph.graphState()`.
5. Replace deferred `withState` effects with `saveState()` or `graph.saveNodeState()`.
6. Remove `createContext`, `nextStep`, outcome builders, and `configAutoRoute()`.
7. Test the entry, correction, transition, restore, and completion paths.

See the [QuoteGraph walkthrough](/ezgraph/quote-graph/) for a complete guided
application and the [tutorial](/ezgraph/tutorial/) for a small runnable graph.
