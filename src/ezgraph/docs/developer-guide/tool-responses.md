---
layout: layouts/ezgraph.njk
title: Tool responses and transitions | EZGraph
description: Return go, stay, direct, directTo, or finish and pass state or messages to the next node.
permalink: /ezgraph/docs/developer-guide/tool-responses/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Tool responses and transitions

Return go, stay, direct, directTo, or finish and pass state or messages to the next node.

## Return one direct tool response

| Response | Meaning |
| --- | --- |
| `stay(feedback)` | Keep this node active and give the model corrective tool feedback. The agent loop continues. |
| `go(Target)` | Save the target as the durable resume node and enter it in the same graph invocation. |
| `direct(content)` | Stop model work and return code-owned content while keeping this node active. |
| `directTo(Target, content)` | Return code-owned content and save the target as the next user-turn node without running it now. |
| `finish(content)` | Stop model work and complete the graph with code-owned content. |

`stay()` exists only inside a tool handler's agent loop. The other builders
are shared: a [decision node](/ezgraph/docs/developer-guide/decision-nodes/#decision-nodes-with-jev) returns them from
`onDecision()` too.

Use `withState()` on `go(Target)` or `directTo(Target, content)` when the
transition itself seeds target state.

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
