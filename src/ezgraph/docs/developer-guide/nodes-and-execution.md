---
layout: layouts/ezgraph.njk
title: Nodes and execution | EZGraph
description: Choose node base classes, define the node contract, and use LlmRunner for custom execution.
permalink: /ezgraph/docs/developer-guide/nodes-and-execution/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Nodes and execution

Choose node base classes, define the node contract, and use LlmRunner for custom execution.

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
  DriverNode.id(),
  () => ({} as QuoteGraphNodes),
);

export type QuoteGraphStateType = typeof QuoteGraphState.State;
```

`LlmNode` runs the shared model/tool loop for both one-request workflows and
multi-turn chat. It normally needs only the graph state type. A single request
can include several model calls, tool results, and retries.

```ts
export class DriverNode extends LlmNode<QuoteGraphStateType> {
  getPrompt() {
    return "Collect the driver's identity and licence details.";
  }
}
```

Use a local cast from the registry only where TypeScript needs the exact
node-channel shape. The class does not carry a redundant second state generic.

## Choose a node base class

| Base class | Use it for | Execution policy |
| --- | --- | --- |
| `LlmNode` | Document extraction, batch model work, and interactive chat | The standard model/tool loop, response validation, LLM error hooks, history and token accounting, and response builders |
| `GraphNode` | Deterministic work or custom execution | Implement `run()` and choose the required execution path |
| `DecisionNode` | Typed classification and judging | The decision provider/runner and `onDecisionError()` policy |

`ExtractExpenseNode` and `ExtractInvoiceNode` use `LlmNode` for one-request
extraction. Their graphs set `requiresUserMessage: false` and
`responseMode: "json"`; a successful capture tool returns `finish()`.
An interactive node can return text to wait for another user message or
`go(Target)` to enter the next stage immediately. The graph and the response
choose the workflow's lifetime.

The four LLM hooks belong to `LlmNode`. A custom `GraphNode` calling the gateway
directly does not automatically receive them.

### LlmRunner and custom execution

`LlmRunner` is the public shared model/tool runner used by `LlmNode` for both
single-request workflows and multi-turn chat. The execution roles are:

| API | Owns |
| --- | --- |
| `LlmNode` | The application prompt, tools, response validation, and model-error policy |
| `LlmRunner` | Model/tool sequencing, retries, temporary alternate models, cancellation checks, cleanup, and usage accumulation |
| `LlmGateway` | Provider-neutral inference calls and provider integration |

Import `LlmRunner` and `LlmRunResult` from `@picoflow/ezgraph` when composing the
loop directly. `LlmRunner.run()` accepts a prompt, history, tools, model config,
tool executor, and optional lifecycle and call policy. Its `LlmRunResult`
includes messages, token usage, and the response or selected tool response.
`LlmNodeRunResult` names that same result for specialized LLM nodes.

A custom `GraphNode` can call `this.runLlm(state, context)` to use the shared
loop. Its default behavior retains `onEmptyModelResponse()`; `LlmNode` wires
the four LLM hooks through `llmLifecycle()`. A direct `LlmRunner.run()` call
needs an explicit `LlmLifecycle` to opt into those hooks.

`LlmPolicy` describes the graph's per-call timeout, empty-history seed, and
empty-response recovery settings. `BaseGraph.llmPolicy` exposes the resolved
policy, and `DEFAULT_LLM_POLICY` supplies the framework defaults. Set these
through `llmTimeoutMs`, `emptyHistorySeed`, and `emptyResponseRecovery` in the
graph definition.
