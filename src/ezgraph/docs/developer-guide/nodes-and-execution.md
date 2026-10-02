---
layout: layouts/ezgraph.njk
title: Nodes and execution | EZGraph
description: Use one LlmNode contract for conversation, batch input, nested calls, and parallel work, with shared entry, response, and error hooks.
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
| `LlmNode` | Document extraction, interactive chat, nested calls, and sequential or parallel model work | The shared model/tool loop, `onEnter()`, `onResponse()`, candidate validation, LLM error hooks, invocation ownership, and token accounting |
| `GraphNode` | Deterministic work or custom execution | Implement `run()` and choose the required execution path |
| `DecisionNode` | Typed classification and judging | The decision provider/runner and `onDecisionError()` policy |

`ExtractExpenseNode` and `ExtractInvoiceNode` use `LlmNode` for one-request
extraction. Their graphs set `requiresUserMessage: false` and
`responseMode: "json"`; a successful capture tool returns `finish()`.
An interactive node can return text to wait for another user message or
`go(Target)` to enter the next stage immediately. The graph and the response
choose the workflow's lifetime.

Managed LLM lifecycle hooks belong to `LlmNode`. A custom `GraphNode` calling
the gateway directly does not automatically receive them.

## Prepare input with onEnter

The protected synchronous `onEnter(langMessage, priorNode?)` hook runs once
when a `LlmNode` enters its agent loop, before the first model call and before
the empty-history seed. This includes the first node in a batch graph and
internal, nested, and parallel execution. A later invocation calls it again,
including a new user turn on the same node. Model/tool rounds, retries, and
temporary alternate-model recovery reuse the prepared input.

The default preserves the incoming message:

```ts
protected onEnter(
  langMessage: MessageTypes | null | undefined,
  _priorNode?: string,
): MessageTypes | null | undefined {
  return langMessage;
}
```

Import `MessageTypes` from `@picoflow/ezgraph`; it aliases LangChain's
`BaseMessage`. `langMessage` is the trailing incoming human message, including
a forwarded `withMessage()` input, or `undefined` when none is present. The
hook does not search earlier history for an old human request. Internal nodes
receive `undefined` because they do not read conversation history.

`priorNode` is the known nested caller's node ID. Ordinary graph entry leaves
it undefined: the durable `currentNode` cursor may already identify the
destination and does not reliably identify the source node.

Return a message to supply or replace the current input, or return
`null`/`undefined` to omit it. Earlier history remains intact. Conversational
execution records the prepared input once, without duplicating a passed-through
message; internal execution keeps it ephemeral. If history is empty after the
hook, `emptyHistorySeed` still applies: `"Start"` by default, or `null` for a
system-only call. A thrown entry-hook error propagates as an application error,
outside ordinary model recovery.

For a one-turn batch, keep the rows in node state and construct a user message
on entry:

```ts
import { HumanMessage } from "@langchain/core/messages";
import {
  LlmNode,
  createGraphStateAnnotation,
  finish,
  type MessageTypes,
  type NodeStateValue,
} from "@picoflow/ezgraph";

type BatchData = {
  rows?: { id: string; amount: number }[];
  result?: string;
};
type BatchNodes = { BatchNode?: NodeStateValue<BatchData> };
const BatchState = createGraphStateAnnotation<string, BatchNodes>("BatchNode", () => ({}));
type BatchGraphStateType = typeof BatchState.State;

export class BatchNode extends LlmNode<BatchGraphStateType, BatchData> {
  getPrompt(): string {
    return "Process each supplied row and return JSON results.";
  }

  protected override onEnter(
    langMessage: MessageTypes | null | undefined,
    _priorNode?: string,
  ): MessageTypes | null | undefined {
    const rows = this.getState().rows;
    return rows === undefined ? langMessage : new HumanMessage(JSON.stringify(rows));
  }

  protected override onResponse(result: string) {
    this.saveState({ result });
    return finish(result);
  }
}
```

Populate `nodes.BatchNode.rows` before invoking the graph. The hook supplies
the batch even without an external user message; an engine-managed graph that
accepts such input sets `requiresUserMessage: false`. This example owns
conversational completion through `finish()`. For an internal worker, save the
result in `onResponse()` and return nothing; its graph or caller owns
continuation. Keep request data in invocation-scoped state or graph context,
because node instances are shared across sessions.

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
`getLlmConfig()`, `onEnter()`, `onResponse()`, and LLM error hooks. Ownership determines which
effects it may publish:

| Placement | How it is selected | Owns |
| --- | --- | --- |
| Conversation | Register the class with `registerTurns()` or `registerTurnNodes()` | Its named conversation history, user reply, routing, and completion |
| Internal graph work | With a turn registry, add the class via `nodes()` but leave it out of `registerTurns()` | Its own node channel and token usage; edges own continuation |
| Fixed-entry internal work | Mark the class with `workers()` | Its own node channel and token usage; explicit START and worker edges own scheduling |
| Nested work | Call `child.invoke(state)` during another node's invocation | Its own node channel and token usage; the caller publishes the returned update |

In a fixed-entry graph, an unmarked `LlmNode` owns conversation; use `workers()`
for nodes that should perform internal work instead.

Internal LLM history is ephemeral and starts empty. Supply required business
facts explicitly through `onEnter()` or `getPrompt(state)`. If the entry hook
leaves history empty, the runner applies the graph's empty-history seed policy.
The worker's model calls do not automatically receive the customer's
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
| `LlmNode` | The application prompt, tools, entry-input preparation, accepted-output handling, local state, validation, and model-error policy |
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
its entry, validation, and model-error hooks through `llmLifecycle()`. A direct `LlmRunner.run()` call
needs an explicit `LlmLifecycle` to opt into those hooks.

`LlmPolicy` describes the graph's per-call timeout, empty-history seed, and
empty-response recovery settings. `BaseGraph.llmPolicy` exposes the resolved
policy, and `DEFAULT_LLM_POLICY` supplies the framework defaults. Set these
through `llmTimeoutMs`, `emptyHistorySeed`, and `emptyResponseRecovery` in the
graph definition.
