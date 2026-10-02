---
layout: layouts/ezgraph.njk
title: Tool responses and transitions | EZGraph
description: Choose conversational responses, conditional fan-out, or typed task output, and attach explicit state, messages, and usage.
permalink: /ezgraph/docs/developer-guide/tool-responses/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Tool responses and transitions

Choose conversational responses, conditional fan-out, or typed task output.
The graph or caller determines which outcomes the executing node may publish.

## Return one direct tool response

| Response | Meaning |
| --- | --- |
| `stay(feedback)` | Keep this node active and give the model corrective tool feedback. The agent loop continues. |
| `go(Target)` | Save the target as the durable resume node and enter it in the same graph invocation. |
| `go(Child1, Child2, ...)` | Schedule multiple registered nodes concurrently without choosing a child as the conversation cursor. |
| `direct(content)` | Stop model work and return code-owned content while keeping this node active. |
| `directTo(Target, content)` | Return code-owned content and save the target as the next user-turn node without running it now. |
| `finish(content)` | Stop model work and complete the graph with code-owned content. |
| `taskResult(value)` | Stop the model/tool loop with typed, code-owned output for `LlmNode.onResponse()`, without selecting a graph transition. |

`stay()` exists only inside a tool handler's agent loop. Conversational response
and transition builders are shared with `GraphNode.run()` and a
[decision node's `onDecision()`](/ezgraph/docs/developer-guide/decision-nodes/#decision-nodes-with-jev).
`taskResult()` belongs to managed LLM output handling, not decision-node routing.

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

## Fan-out response effects

```ts
this.saveState({ movieIdea: submitted });
return go(Child1Node, Child2Node);
```

Multi-target `go()` requires distinct registered node IDs. Save the parent's
state before returning; each child reads required facts from `getPrompt(state)`
and saves its own output. Use
[an explicit join](/ezgraph/docs/developer-guide/topology/#conditional-fan-out-and-join)
to continue after all branches finish.

A multi-target builder has no `withState()` or `withMessage()`: there is no
single destination for those effects. `withUsage()` attaches additional usage.
In a tool handler, `withToolFeedback()`, `withCleanup()`, and `withMessages()`
retain their feedback, cleanup, and current-history meanings; they do not
broadcast state or conversation messages to the workers. Single-target
`go(Target).withState(...)` and `withMessage(...)` address that one target.

The complete tool-call batch runs before a selected transition is returned.
Repeated bare `go()` outcomes may name the same destination set; conflicting
destinations or repeated response effects fail instead of choosing a winner.

## Typed task output

An LLM tool can complete its loop with data validated and owned by code:

```ts
return taskResult({ summary, confidence });
```

Supply the output type as `LlmNode<State, LocalState, Output>` and handle
`string | Output` in `onResponse()`. Typed task output is also available in
conversational execution; it does not choose a graph route or finish the session.
When the hook returns nothing, a conversational node serializes accepted
non-string output for its reply. An internal worker publishes only the state
saved by the hook and token usage.

Internal workers may use `stay()`, `direct()`, and `taskResult()`, but cannot
return conversational routing, completion, target-state, or history effects.
Their graph edges or nested caller own what happens next. See
[execution ownership](/ezgraph/docs/developer-guide/nodes-and-execution/#execution-ownership).
