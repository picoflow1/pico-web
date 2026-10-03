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
| `LlmNode` | Document extraction, interactive chat, nested calls, and sequential or parallel model work | The shared model/tool loop, `onEnter()`, `onResponse()`, `onExit()`, candidate validation, LLM error hooks, invocation ownership, and token accounting |
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

The protected `onEnter(langMessage, priorNode?)` hook accepts a synchronous
result or a Promise. EZGraph awaits it once when a `LlmNode` enters its agent
loop, before constructing the prompt, applying the empty-history seed, and
calling the model. This includes the first node in a batch graph and
internal, nested, and parallel execution. A later invocation calls it again,
including a new user turn on the same node. Model/tool rounds, retries, and
temporary alternate-model recovery reuse the prepared input.

The default preserves the incoming message:

```ts
protected onEnter(
  langMessage: MessageTypes | null | undefined,
  _priorNode?: string,
): MessageTypes | null | undefined | Promise<MessageTypes | null | undefined> {
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
system-only call. A thrown error or rejected Promise propagates as an application
error, outside ordinary model recovery.

Use `async onEnter()` for preprocessing or loading facts before model execution:

```ts
// Application-provided lookup or preprocessing function.
declare function loadBatchFacts(rows: unknown[]): Promise<string>;

class PreparedBatchNode extends LlmNode<MyGraphState, { rows?: unknown[]; facts?: string }> {
  getPrompt() { return `Process the supplied batch using: ${this.getState().facts ?? ""}`; }

  protected override async onEnter(
    langMessage: MessageTypes | null | undefined,
    _priorNode?: string,
  ): Promise<MessageTypes | null | undefined> {
    const rows = this.getState().rows;
    if (rows === undefined) return langMessage;
    const facts = await loadBatchFacts(rows);
    this.saveState({ facts });
    return new HumanMessage(JSON.stringify(rows));
  }
}
```

The prompt is built after entry finishes, so `getPrompt(state)` and `getState()`
see facts staged by the hook. Keep per-invocation facts in node state or graph
context because node instances are shared across sessions. Cancellation is
checked before and after the await; use `currentTurnSignal()` when preprocessing
I/O needs to honor cancellation itself. The entry hook is per invocation,
including each new user turn, rather than a one-time node initializer.

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
`direct()` replaces it. In conversational execution, `go()`, `fanout()`, `directTo()`, and
`finish()` can select a next stage or completion. A `taskResult(value)` passes
typed data to this hook; its parameter is `string | Output` when a third generic
is supplied. `stay()`, tool feedback, attachments, and cleanup belong to tool
handlers, not `onResponse()`.

The same class works as a conversational node or an internal worker. In a
conversation it saves the joke and publishes the text. Internally it saves the
joke and publishes only its local-state update and token usage.

## Finalize successful work with onExit

The protected `onExit(context)` hook accepts `void` or `Promise<void>`. EZGraph
awaits it once per successful node invocation, after `onResponse()` where
applicable and after JSON completion validation or repair. Exit completes
before the node update is published or downstream nodes start. A normal reply
that keeps this node active also triggers exit.

Import `LlmNodeExitContext` and `LlmNodeExitOutcome` from `@picoflow/ezgraph`.
Their public shape is:

```ts
type LlmNodeExitOutcome<Output = string> =
  | { readonly kind: "reply"; readonly response: string }
  | { readonly kind: "taskResult"; readonly value: Output }
  | { readonly kind: "go"; readonly targets: readonly [string] }
  | {
      readonly kind: "fanout";
      readonly targets: readonly [string, string, ...string[]];
    }
  | {
      readonly kind: "directTo";
      readonly targets: readonly [string];
      readonly response: string;
    }
  | { readonly kind: "finish"; readonly response: string };

type LlmNodeExitContext<State extends GraphState, Output = string> = Readonly<{
  nodeId: string;
  mode: "conversation" | "internal";
  state: Readonly<State>;
  outcome: LlmNodeExitOutcome<Output>;
  usage: TokenUsage;
}>;
```

`state` is the current materialized invocation state, including staged entry,
tool, and response writes. `outcome` is the final semantic result; ordinary text
and `direct()` normalize to `reply`, and `taskResult` preserves the final typed
value. Target arrays contain resolved node IDs, with exactly one for `go` and
`directTo`, and at least two for `fanout`. `usage` is accumulated token usage
for this invocation, not the session total.

Inside a batch worker, stage final facts with the hook:

```ts
protected override async onExit(
  context: LlmNodeExitContext<MyGraphState, BatchResult>,
): Promise<void> {
  if (context.outcome.kind === "taskResult") {
    const summary = await summarizeBatch(context.outcome.value);
    this.saveState({ summary });
  }
}
```

Tool-selected routing and completion trigger exit even though they skip
`onResponse()`. `stay()` continues the loop; retries, rejected candidates, and
intermediate tool rounds do not trigger exit. Successful model-error recovery
does trigger it. Unhandled errors and cancellation skip exit. Cancellation is
checked before and after the await; use `currentTurnSignal()` for postprocessing
I/O that needs to stop itself. An exit-hook error propagates without model
recovery and the invocation update is not published.

Return values do not alter the outcome. Use `saveState()` to stage final local
writes and the existing response hooks/builders to choose output and routing.
Internal workers remain restricted to their own node state and token usage.
This hook runs while state is staged, before session persistence.

The lifecycle is: `onEnter` → prompt → model/tool loop → `onResponse` where
applicable → completion validation → `onExit` → publish node result.

## Execution ownership

Scheduling reuses the node's prompt, application-tool definitions,
`getLlmConfig()`, `onEnter()`, `onResponse()`, `onExit()`, and LLM error hooks. Ownership determines which
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
reply. `go()`, `fanout()`, `directTo()`, `finish()`, and `terminate_session` are not internal
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
