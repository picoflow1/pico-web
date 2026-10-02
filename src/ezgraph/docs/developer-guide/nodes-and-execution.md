---
layout: layouts/ezgraph.njk
title: Nodes and execution | EZGraph
description: Use one LlmNode contract for conversation, nested calls, and parallel work, with shared response and error hooks.
permalink: /ezgraph/docs/developer-guide/nodes-and-execution/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Nodes and execution

Use one `LlmNode` contract for conversation, nested calls, and parallel work.
The node owns its capability; the graph or caller owns how it executes.

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

`LlmNode` runs the shared model/tool loop for one-request workflows, multi-turn
chat, sequential internal work, nested calls, and parallel workers. A single
invocation can include several model calls, tool results, and retries.

```ts
export class DriverNode extends LlmNode<QuoteGraphStateType> {
  getPrompt() {
    return "Collect the driver's identity and licence details.";
  }
}
```

The first generic is the graph state. Optionally supply a second generic for
typed `getState()` and `saveState()`, and a third for typed `taskResult()` output:
`LlmNode<State, LocalState, Output>`. The defaults are
`Record<string, unknown>` for local state and `string` for output.
Keep the corresponding channel in the graph's durable state registry.

## Choose a node base class

| Base class | Use it for | Execution policy |
| --- | --- | --- |
| `LlmNode` | Document extraction, interactive chat, nested calls, and sequential or parallel model work | The shared model/tool loop, `onResponse()`, candidate validation, LLM error hooks, invocation ownership, and token accounting |
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

## Handle accepted output with onResponse

`onResponse(response, state)` runs after the shared loop accepts text,
code-owned `direct()` content, or a typed `taskResult()` value. It does not run
for intermediate `stay()` feedback or tool-selected routing and completion.

This worker saves its accepted output in its own channel:

```ts
import { LlmNode } from "@picoflow/ezgraph";
import type { DemoGraphStateType } from "../demo-graph.state.js";

export class Child1Node extends LlmNode<
  DemoGraphStateType,
  { joke?: string }
> {
  getPrompt(): string {
    return "You are a concise comedian. Tell one short joke about parallel execution.";
  }

  protected onResponse(response: string): void {
    this.saveState({ joke: response });
  }
}
```

Returning nothing leaves the accepted output intact. Returning a string or
`direct()` replaces it. In conversational execution, `go()`, `directTo()`, and
`finish()` can select a next stage or completion. A `taskResult(value)` passes
typed data to this hook; its parameter is `string | Output` when a third generic
is supplied. `stay()`, tool feedback, attachments, and cleanup belong to tool
handlers, not `onResponse()`.

The same class works as a conversational node or an internal worker. In a
conversation it saves the joke and publishes the text. Internally it saves the
joke and publishes only its local-state update and token usage.

## Execution ownership

Scheduling reuses the node's prompt, application-tool definitions,
`getLlmConfig()`, `onResponse()`, and LLM error hooks. Ownership determines which
effects it may publish:

| Placement | How it is selected | Owns |
| --- | --- | --- |
| Conversation | Register the class with `registerTurns()` or `registerTurnNodes()` | Its named conversation history, user reply, routing, and completion |
| Internal graph work | With a turn registry, add the class via `nodes()` but leave it out of `registerTurns()` | Its own node channel and token usage; edges own continuation |
| Fixed-entry internal work | Mark the class with `workers()` | Its own node channel and token usage; explicit START and worker edges own scheduling |
| Nested work | Call `child.invoke(state)` during another node's invocation | Its own node channel and token usage; the caller publishes the returned update |

In a fixed-entry graph, an unmarked `LlmNode` owns conversation; use `workers()`
for nodes that should perform internal work instead.

Internal LLM history is ephemeral and starts empty; the runner applies the
graph's crossing-message policy. Add required business facts to `getPrompt(state)`
explicitly. The worker's model calls do not automatically receive the customer's
named conversation history. Workers cannot write graph context, another node's
channel, or conversational history.
They cannot change `currentNode`, return a user reply, or complete the session.

Internal tools may return `stay()`, `direct()`, or `taskResult()`.
`direct()` supplies accepted task content without publishing a conversational
reply. `go()`, `directTo()`, `finish()`, and `terminate_session` are not internal
worker outcomes. `terminate_session` is not offered to an internal worker;
an internal-only graph does not need its provider.

### Nested calls

Always execute a child through `invoke()` so the shared loop, hooks, and
ownership checks apply. A nested invocation is internal automatically:

```ts
import { isCommand } from "@langchain/langgraph";
import { GraphNode } from "@picoflow/ezgraph";
import { Child1Node } from "./child1.node.js";
import type { DemoGraphStateType } from "../demo-graph.state.js";

export class EnrichmentNode extends GraphNode<DemoGraphStateType> {
  getPrompt(): string { return "Run enrichment."; }

  async run() {
    const child = new Child1Node(this.llmGateway, this.graph);
    const update = await child.invoke(this.graph.graphState());
    if (isCommand(update)) throw new Error("Internal work must return state and usage.");
    return update;
  }
}
```

The caller must return or merge the child's update; calling it alone does not
publish the child's saved state. When composing several child results manually,
merge their node entries and sum their usage with `addTokenUsage()`.
For an internal call outside another node invocation, use
`child.invoke(state, { mode: "internal" })`. A nested call cannot opt into
conversation ownership.

For graph-scheduled parallel work, see
[conditional fan-out and join](/ezgraph/docs/developer-guide/topology/#conditional-fan-out-and-join).

### LlmRunner and custom execution

`LlmRunner` is the public shared model/tool runner used by `LlmNode` in every
execution placement, including nested and parallel work. The responsibilities are:

| API | Owns |
| --- | --- |
| `LlmNode` | The application prompt, tools, accepted-output handling, local state, validation, and model-error policy |
| `LlmRunner` | Model/tool sequencing, retries, temporary alternate models, cancellation checks, cleanup, and usage accumulation |
| `LlmGateway` | Provider-neutral inference calls and provider integration |
| Graph or nested caller | Conversation ownership, scheduling, fan-out, joins, and publication of child results |

Import `LlmRunner` and `LlmRunResult` from `@picoflow/ezgraph` when composing the
loop directly. `LlmRunner.run()` accepts a prompt, history, tools, model config,
tool executor, and optional lifecycle and call policy. Its `LlmRunResult`
includes messages, token usage, and the response or selected tool response.
`LlmNodeRunResult` names that same result for specialized LLM nodes.

Use `LlmNode` for managed model work so you do not have to wire its lifecycle
yourself. `LlmRunner` executes the model/tool loop; it does not schedule graph
nodes. Node transitions are resolved to LangGraph commands, and LangGraph
executes destinations and barrier edges.

A custom `GraphNode` can call `this.runLlm(state, context)` to use the shared
loop. Its default behavior retains `onEmptyModelResponse()`; `LlmNode` wires
the four LLM hooks through `llmLifecycle()`. A direct `LlmRunner.run()` call
needs an explicit `LlmLifecycle` to opt into those hooks.

`LlmPolicy` describes the graph's per-call timeout, empty-history seed, and
empty-response recovery settings. `BaseGraph.llmPolicy` exposes the resolved
policy, and `DEFAULT_LLM_POLICY` supplies the framework defaults. Set these
through `llmTimeoutMs`, `emptyHistorySeed`, and `emptyResponseRecovery` in the
graph definition.
