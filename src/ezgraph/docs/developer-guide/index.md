---
layout: layouts/ezgraph.njk
title: Developer guide | EZGraph
description: Build LLM nodes for batch extraction and multi-turn chat with explicit state writes, direct tool responses, and error recovery.
permalink: /ezgraph/docs/developer-guide/
ezgraph: true
ezgraphDocument: true
---

# EZGraph developer guide

EZGraph is a TypeScript layer for durable LangGraph applications, including
one-request extraction workflows and multi-turn chat.
Each graph node owns its prompt, tools, state writes, and transition decision.
LangGraph owns execution; EZGraph supplies the contracts that keep a conversation
resumable and auditable.

The current API has one rule worth remembering:

> A tool handler writes durable state itself, then returns `go`, `stay`, `direct`, `directTo`, or `finish`.

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
directly does not automatically receive them. `ConversationRunner` remains the
name of the shared internal model/tool runner.

### Rename existing imports and subclasses

Replace `ConversationNode` with `LlmNode` and `ConversationNodeRunResult` with
`LlmNodeRunResult`. Update imports, subclass declarations, and any source-level
imports from `conversation-node.js` to `llm-node.js`. The old exports are removed;
there is no compatibility alias. Node IDs, saved state, histories, and the four
error-hook contracts are unchanged by the base-class rename.

## Initial node and history routing

The first argument to `createGraphStateAnnotation()` declares the initial
`currentNode`. In the example above, a new session starts at `DriverNode`.
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

### Migrating an existing graph

Remove `initialHistorySpace` from `GraphDefinition`. Keep the initial node's
entry in `historySpaces`, and declare that node in `createGraphStateAnnotation()`.
If other nodes previously relied on the initial history setting as a shared
fallback, add explicit mappings for them too. Unmapped nodes now use `"default"`.
Existing session documents keep their saved cursor and histories.

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
A parallel superstep permits one context writer; consolidate workers' node state
in a join node to update shared context.

`createGraphStateAnnotation()` declares the context channel. Custom
`Annotation.Root()` schemas can import `GraphContextChannel` from
`@picoflow/ezgraph` and declare `context: new GraphContextChannel()`.
Outside execution, inspect the session
returned by `GraphEngine.getSession()`; older documents without context restore
with `{}`. The addition preserves document version 16 and graph schema versions.

In QuoteGraph, coverage calculation and quote adjustment write rating timestamps.
Acceptance reads that shared metadata and saves an acceptance timestamp. Business
facts remain in node state, request options remain in `config`, and context is
included in prompts only when application code explicitly adds it. See the
[QuoteGraph context example](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/#shared-runtime-context).

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

## Return one direct tool response

| Response | Meaning |
| --- | --- |
| `stay(feedback)` | Keep this node active and give the model corrective tool feedback. The agent loop continues. |
| `go(Target)` | Save the target as the durable resume node and enter it in the same graph invocation. |
| `direct(content)` | Stop model work and return code-owned content while keeping this node active. |
| `directTo(Target, content)` | Return code-owned content and save the target as the next user-turn node without running it now. |
| `finish(content)` | Stop model work and complete the graph with code-owned content. |

`stay()` exists only inside a tool handler's agent loop. The other builders
are shared: a [decision node](#decision-nodes-with-jev) returns them from
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

## Error handling

`LlmNode` owns response validation and model-error policy. Its three
error hooks also exist on `BaseGraph`, so a node can handle a failure locally or
delegate it to a graph-wide default.

| Hook | Called for | Return value |
| --- | --- | --- |
| `checkResponse(candidate)` | A non-empty, unblocked model candidate, before text acceptance or tool dispatch. The candidate is the raw `AIMessage`. | `true` rejects and retries; `false` accepts. This hook is node-only. |
| `onLlmBlocked(context)` | A thrown prompt block or a blocked candidate, including candidates containing text or tool calls. | Fixed text or a response builder handles the block; `null` delegates. |
| `shouldRetryLlmError(context)` | A thrown model invocation error. | `false` stops retries immediately; `true` allows retries within the configured budget; `undefined` delegates. |
| `onLlmError(context)` | A terminal invocation error, an exhausted empty response, or an exhausted rejected response. | Fixed text, a response builder, or `retryWithModel()` recovers; `null` delegates. |

For `onLlmBlocked()` and `onLlmError()`, EZGraph calls the node first, then the
graph only when the node returns `null`. If both return `null`, the failure
propagates. An unhandled block throws `LlmResponseBlockedError`.

For `shouldRetryLlmError()`, EZGraph calls the node first, then the graph only
when the node returns `undefined`. If both delegate, the configured retry
budget applies. Returning `true` never increases that budget.

### Validate candidates before tools run

A rejected or blocked candidate is never accepted into conversation history,
and its proposed tools never run. `checkResponse()` receives the complete AI
message, so validation can inspect both text and tool calls. It is not called
for thrown invocation errors, empty responses, or blocks.

For example, a collector can reject partial output that hit a token cap:

```ts
import { AIMessage } from "@langchain/core/messages";
import {
  LlmNode,
  direct,
  modelStopReason,
  type LlmBlockedContext,
  type LlmBlockedResponse,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";
import type { QuoteGraphStateType } from "../quote-graph.state.js";

export class DriverNode extends LlmNode<QuoteGraphStateType> {
  getPrompt(): string {
    return "Collect the driver's identity and licence details.";
  }

  override checkResponse(candidate: string | object): boolean {
    return AIMessage.isInstance(candidate)
      && modelStopReason(candidate).category === "truncated";
  }

  override async onLlmBlocked(
    _context: LlmBlockedContext,
  ): Promise<LlmBlockedResponse | null> {
    return direct("I cannot help with that request.");
  }

  override async onLlmError(
    context: LlmErrorContext,
  ): Promise<LlmErrorResponse | null> {
    if (context.kind === "response_rejected") {
      return direct("I could not complete the response. Please try again.");
    }
    return null; // Delegate other terminal failures to the graph.
  }
}
```

`MAX_TOKENS` and other token-cap reasons are not safety blocks. Partial text can
be accepted unless `checkResponse()` rejects it. An empty truncated response
enters `onLlmError()` without a corrective nudge. Provider refusals bypass
`checkResponse()`, ordinary retries, and `onLlmError()`; they enter
`onLlmBlocked()` instead.

### Set retry and graph-wide recovery policy

`params.retries` counts **additional** retries: `retries: 2` allows three
attempts for invocation errors or rejected candidates. `LlmNode`'s
runner supplies `retries: 0` to each gateway call and owns the retries itself,
so SDK retries cannot hide failures from your hooks. Retried invocations and
rejected candidates wait 500 ms between attempts.

A node or graph can stop invocation retries for an error it considers terminal.
The following override uses the numeric HTTP status when the gateway exposes
one, and delegates every other case:

```ts
import type { LlmAttemptErrorContext } from "@picoflow/ezgraph";

// Inside a LlmNode or BaseGraph subclass.
override shouldRetryLlmError(
  context: LlmAttemptErrorContext,
): boolean | undefined {
  const error = context.error as Error & { status?: number };
  if ([400, 401, 403].includes(error.status ?? 0)) return false;
  return undefined;
}
```

A graph-wide recovery override can give delegated failures a consistent reply:

```ts
import {
  direct,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";

// Inside your BaseGraph subclass.
override async onLlmError(
  context: LlmErrorContext,
): Promise<LlmErrorResponse | null> {
  if (context.kind === "invocation_error") {
    return direct("The service is unavailable. Please try again later.");
  }
  return direct("I could not produce a complete response. Please try again.");
}
```

Empty candidates keep the graph's `emptyResponseRecovery` policy: by default,
two retries with a corrective nudge. Disabling that policy with `null` skips
nudges and offers the empty result directly to `onLlmError()`. Empty recovery
is bounded by `maxAgentRounds`; model-error and rejection retries occur within
a round. Usage totals include empty and rejected candidates.

### Inspect failure context and choose a response

All error contexts include `nodeId`, `provider`, `model`, and the caller's
`signal` when supplied. The remaining fields distinguish the failure:

| Context | Additional fields |
| --- | --- |
| `LlmAttemptErrorContext` | `error`, one-based `attempt`, and `maxAttempts`. |
| `LlmErrorContext` | `error`, `attemptsMade`, `maxAttempts`, `kind`, and `stoppedBecause`. `kind` is `invocation_error`, `empty_response`, or `response_rejected`; the latter two retain `lastResponse`. Invocation errors stop because retries were declined or attempts were exhausted. |
| `LlmBlockedContext` | Normalized `reason`, provider `rawReason`, `phase` (`prompt` or `candidate`), and optional `safetyRatings` and `providerDetails`. |

Recovery can return a string or `direct()`, `directTo()`, `go()`, or `finish()`.
These use the same routing, target-state, and completion contracts as ordinary
node responses. `stay()`, tool feedback, and cleanup are tool-only and cannot
be returned by an error hook.

Cancellation is checked before, between, and after hooks, as well as during
retry delays. A canceled turn cannot return fallback content. A thrown hook
exception propagates without calling the graph fallback. Setup failures,
tool-handler failures, and agent-round-limit errors also propagate outside
ordinary model recovery. Custom gateways should use `LlmSetupError` for
configuration or tool-binding failures and honor the supplied retry and
cancellation policy.

### Recover with one temporary alternate model

`onLlmError()` can return `retryWithModel()` with a validated EZGraph model
configuration. For example, a node using `openai:gpt-5.4` can try an alternate
provider after terminal invocation failure:

```ts
import {
  ModelCatalog,
  retryWithModel,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";

// Inside a LlmNode or BaseGraph subclass.
override async onLlmError(
  context: LlmErrorContext,
): Promise<LlmErrorResponse | null> {
  if (context.kind === "invocation_error"
      && context.model === "openai:gpt-5.4") {
    return retryWithModel(ModelCatalog.model(
      "anthropic:claude-sonnet-4-5",
      { retries: 0 },
    ));
  }
  return null;
}
```

The alternate remains active through tool follow-up and receives one attempt
per model call, regardless of its configured `params.retries`. It uses the
existing prompt, tools, conversation history, and call timeout. It does not
change the node's configured model for later turns. A second alternate in the
same recovery sequence is rejected, and `onLlmBlocked()` cannot select an
alternate model.

Completed tool effects and their feedback remain in place during recovery;
EZGraph does not rerun those handlers. A newly generated tool call still
executes normally, so deterministic code should make durable side effects
idempotent. Use saved node state to decide whether recovery should offer a
fixed reply, hand off, or try another model.

These hooks apply to `LlmNode`'s shared loop. Plain `GraphNode` calls
retain their existing `onEmptyModelResponse()` behavior; direct gateway calls
and typed `DecisionNode` validation use their own contracts.

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

`LlmNode` inherits `terminate_session`. Every graph containing one
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

## Decision nodes with Jev

`DecisionNode` is EZGraph's counterpart to PicoFlow's `DecisionStep`. It asks a
decision model a fixed set of typed questions and hands the validated answers
to your code. The built-in provider is TypeSafe's
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), a
non-generative "System One" model reached through LangChain's
`TypeSafeClassifier`. Jev evaluates a state against your questions and returns
probabilities; it never writes prose, calls tools, or picks a route string.

Use a decision node for bounded judgments: intent routing, readiness checks,
and draft review. Use a `LlmNode` for language and tools.

### Declare questions, then route in code

Three question types exist. Declare them once with `as const satisfies
DecisionQuestionMap` so answer types are inferred from the criteria.

| Type | Declaration | Answer |
| --- | --- | --- |
| `choice` | `criteria: { label: description, ... }` | `choice` (one declared label), `probabilities`, `confidence` |
| `score` | `criteria: [level0, level1, ...]` (at least two) | `score` from `0` to the last index, may be fractional; `legend`, `probabilities`, `confidence` |
| `noul` | `instructions` and/or `criteria: { true, false }` | `noul`, a probability in `[0, 1]`; no separate confidence |

This router is adapted from the demo's `RouterDecisionNode`:

```ts
import { HumanMessage } from "@langchain/core/messages";
import {
  DecisionNode,
  directTo,
  finish,
  go,
  type DecisionAnswers,
  type DecisionContext,
  type DecisionQuestionMap,
  type GraphNodeResponse,
} from "@picoflow/ezgraph";

export const ROUTING_QUESTIONS = {
  destination: {
    type: "choice",
    criteria: {
      dates: "Set or revise dates",
      budget: "Set or revise nightly budget",
      review: "Show saved criteria",
      search: "Execute a hotel search",
      exit: "End the conversation",
      unclear: "Ambiguous or outside this flow",
    },
  },
} as const satisfies DecisionQuestionMap;

export class RouterDecisionNode extends DecisionNode<
  HotelStateType,
  typeof ROUTING_QUESTIONS
> {
  override defineQuestions() {
    return ROUTING_QUESTIONS;
  }

  // Optional. Prepended to every question's instructions.
  override getPrompt(state: HotelStateType) {
    return `Route the latest hotel request. Saved criteria:\n${summarize(state)}`;
  }

  // Optional JSON facts, merged with the framework-owned request fields.
  protected override getDecisionFacts(state: HotelStateType) {
    return { criteria: readCriteria(state) };
  }

  override onDecision(
    answers: DecisionAnswers<typeof ROUTING_QUESTIONS>,
    context: DecisionContext,
    state: HotelStateType,
  ): GraphNodeResponse<HotelStateType> {
    const route = answers.destination.choice; // typed as the declared labels
    this.saveState({ lastRoute: route });
    if (answers.destination.confidence < 0.6 || route === "unclear") {
      return directTo(RouterDecisionNode, "Tell me what to change: dates, budget, or search.");
    }
    if (route === "exit") return finish("Thanks for considering our hotels.");
    if (route === "review") return directTo(RouterDecisionNode, summarize(state));
    if (route === "search") return go(CriteriaReadinessDecisionNode);
    return go(nodeFor(route)).withMessage(new HumanMessage(context.request));
  }
}
```

`onDecision()` returns the same builders as a tool handler: `go`, `direct`,
`directTo`, or `finish`. A plain state update or a LangGraph `Command` also
works. It cannot return `stay()`, and it cannot return a bare string; use
`direct(content)` for that. `saveState()` and `graph.saveNodeState()` work as
they do in any node.

Probabilities are evidence, not policy. Thresholds, deterministic validation,
eligibility, and irreversible effects remain in application code. The demo's
readiness judge searches only when deterministic validation finds no issues
**and** Jev returns `ready` with `faithful.noul >= 0.75`.

### What Jev receives

Every call sends one JSON state and the prepared questions:

```ts
{
  ...getDecisionFacts(state),   // your JSON-compatible facts
  request: "newest human message in this node's history space",
  priorRequests: ["up to four earlier human messages"],
}
```

`request` and `priorRequests` are reserved. Facts that try to replace them
throw. Messages marked `ezgraphInternal`, such as the `terminate_session`
handoff, are excluded, while a real user message forwarded with
`withMessage()` counts. Nodes that must judge the same conversation should
share a history space, for example `[RouterDecisionNode, "hotel-intake"]`.
`defineQuestions(state)` runs once per invocation, so labels may depend on
durable state. Questions and input are snapshotted before any retry.

A decision node cannot publish chat tools or override the chat model. Both
throw at compile time, so the graph fails at startup instead of on a customer turn.

### Configure and register the provider

Set graph defaults in `GraphDefinition.decisionConfig`. A node can override any
field with `getDecisionConfig()`. Resolution order is framework defaults, then
graph, then node.

```ts
static getGraphDefinition(): GraphDefinition {
  return {
    llmConfig: ModelCatalog.model("openai:gpt-4o", { retries: 2, temperature: 0 }),
    decisionConfig: {
      provider: "typesafe", // default
      model: "jev-latest",  // default
      timeoutMs: 15_000,    // per attempt; default 30_000
      maxRetries: 2,        // extra attempts; default 0
    },
    endNode: GRAPH_END_NODE,
  };
}
```

Register decision providers at the composition root, beside the chat-model
providers:

```ts
GraphEngine.create({
  graphs: [DecisionHotelGraph],
  decisionProviders: DecisionProvider.create({
    typesafe: { apiKey: process.env.TYPESAFE_API_KEY },
  }),
  providers: ModelProvider.createBuiltinAdapters({
    openai: { apiKey: process.env.OPENAI_API_KEY },
  }),
});
```

Install the optional peer dependency `@langchain/typesafe` and set
`TYPESAFE_API_KEY` (or pass `apiKey`). The package loads lazily on the first
decision call. The engine resolves provider IDs when graphs are registered,
so a missing provider fails at startup. There is never a silent fallback to a
chat model. To use a different backend, implement `DecisionProviderAdapter`
(`id`, `decide()`, and optionally `shouldRetry()`) and add it to
`decisionProviders`. IDs must be unique.

### Failures, retries, and fallbacks

`DecisionRunner` owns the call policy. The TypeSafe SDK's own retries are disabled.

- Timeouts and errors the adapter marks transient are retried up to
  `maxRetries` times. For Jev these are 408, 429, 5xx, and connection or timeout errors.
- Responses that fail validation are not retried: a wrong answer type, an
  unknown label, an out-of-range score, or probabilities that do not sum to 1.
- Missing credentials, the missing package, invalid questions or facts, and
  401/403 are configuration errors. They throw and skip every fallback.
- Caller cancellation aborts the attempt and skips the fallbacks.
- Exceptions thrown by `onDecision()` or `onDecisionError()` propagate and are
  never retried.

For the remaining provider, timeout, and validation failures, a node
`onDecisionError(context)` can return a deterministic, code-owned response.
Returning `null` delegates to `BaseGraph.onDecisionError()`. If both return
`null`, the original error is rethrown.

```ts
protected override onDecisionError(
  context: DecisionErrorContext<HotelStateType>,
): GraphNodeResponse<HotelStateType> {
  const issues = validateCriteria(readCriteria(context.state));
  return issues.length
    ? directTo(nodeFor(issues[0]!.field), promptFor(issues[0]!.field))
    : go(SearchHotelsNode);
}
```

`context` includes `nodeId`, `provider`, `model`, `failure`
(`"provider" | "timeout" | "validation"`), `attempts`, `error`, and `state`.

### Usage and audit

Decision usage is tracked separately from chat-model `tokens` as
`state.decisionUsage` / `SessionDocument.decisionUsage`:
`{ calls, inputTokens, outputTokens, totalTokens }`. Every response the runtime
observes is counted, including one rejected by validation.
`SessionDocument.decisions` records provider, configured and actual model,
attempts, duration, request ID, and outcome for each call. Prompts, questions,
facts, and answers are never written there.

### Porting a PicoFlow `DecisionStep`

| PicoFlow | EZGraph |
| --- | --- |
| `class X extends DecisionStep<typeof Q>` | `class X extends DecisionNode<State, typeof Q>` |
| `Flow.defineSteps()` | `graph.registerTurnNodes(...)` |
| `Flow.configDecision()` | `GraphDefinition.decisionConfig` |
| `.useDecision({...})` | `getDecisionConfig()` |
| `getDecisionFacts()` | `getDecisionFacts(state)` |
| `.useMemory("name")` | `historySpaces: [[X, "name"]]` |
| `onDecision(answers, context)` | `onDecision(answers, context, state)` |
| returning a string | `direct(content)` |
| `Flow.onDecisionError()` | `BaseGraph.onDecisionError()` |
| `FlowEngine.create({ decisionProviders })` | `GraphEngine.create({ decisionProviders })` |

Question maps, answer types, `DecisionProvider.create({ typesafe })`, and the
defaults (`typesafe`, `jev-latest`, 30 s, zero retries) are the same.

The [DecisionHotelGraph tutorial](/ezgraph/docs/tutorials/decision-hotel-graph/)
walks through a complete graph with three decision nodes. A router,
a readiness judge, and a grounded-presentation judge sit between
`LlmNode` collectors, each with its own fallback.

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
  "test2:quote-graph": "USE_ENV=1 KEEP_SESSION=1 node --import tsx --test test/quote-graph/quote-graph.e2e.spec.ts",
  "test:decision-hotel-graph": "node --import tsx --test test/decision-hotel-graph/*.spec.ts",
  "test2:decision-hotel-graph": "USE_ENV=1 KEEP_SESSION=1 node --import tsx --test test/decision-hotel-graph/decision-hotel-graph.e2e.spec.ts"
}
```

`USE_ENV=1` is the single live-provider switch. `KEEP_SESSION=1` retains the
session only when a replay needs inspection. Assertions about durable state
belong in deterministic tests; semantic judges and provider calls remain
explicitly opt-in.

The deterministic tier runs real `GraphEngine` turns against an in-memory
session store. Import the helpers from `@picoflow/ezgraph/testing`.
`scriptedGateway()` dictates chat-model output. `scriptedDecisions()` queues
Jev answers or failures, so no TypeSafe key is needed:

```ts
import {
  createTurnHarness,
  scriptedDecisions,
  scriptedGateway,
} from "@picoflow/ezgraph/testing";

const decisions = scriptedDecisions()
  .answers({
    destination: {
      type: "choice",
      choice: "review",
      confidence: 0.97,
      probabilities: { dates: 0.01, budget: 0.01, review: 0.97, search: 0.01, exit: 0, unclear: 0 },
    },
  })
  .fail(new Error("simulated Jev outage")); // exercises onDecisionError()

// HotelGraph registers the RouterDecisionNode shown above.
const harness = createTurnHarness<HotelStateType>({
  graph: HotelGraph,
  gateway: scriptedGateway(),
  decisions,
});

const review = await harness.send("show my criteria");
assert.equal(review.currentNode, "RouterDecisionNode");

const outage = await harness.send("search");
assert.equal(outage.currentNode, "DateRangeNode"); // deterministic fallback
assert.ok(decisions.drained);

const sent = decisions.calls[0]!.request.state as { request: string };
assert.equal(sent.request, "show my criteria");
```

Scripted answers pass the same validation as live ones, so every declared
label needs a probability. `decisions.calls` records each exact request, and
`decisions.drained` confirms that every queued answer was used. A test can also
pass a hand-written `DecisionProviderAdapter` that derives answers from
`request.state`, which is how the demo's 23-turn hotel contract works.

For conversational error policy, script invocation failures with
`scriptedGateway().fail(...)`, empty responses with `.empty()`, and rejected
candidates with `.text(...)` or `.callsTool(...)`. Verify node-to-graph
precedence, retry counts, blocked responses, and cancellation. Also test failure
after a successful tool: the durable state and tool feedback should survive
handled recovery, and completed handlers should execute only once.

## Migration checklist

1. Rename node imports and subclasses to `LlmNode<State>`; remove any older local-state and context generics.
2. Move channel shapes into the graph's `*GraphNodes` registry.
3. Replace `this.toolResult()` with `stay`, `go`, `direct`, `directTo`, or `finish`.
4. Replace `turnState()` with `getState()` and `turnGraphState()` with `graph.graphState()`.
5. Replace deferred `withState` effects with `saveState()` or `graph.saveNodeState()`.
6. Remove `createContext`, `nextStep`, outcome builders, and `configAutoRoute()`.
7. Port PicoFlow `DecisionStep` classes to `DecisionNode` using the
   [mapping table](#porting-a-picoflow-decisionstep), and register
   `decisionProviders` on the engine.
8. Add conversational error policy through the [error handling hooks](#error-handling).
   Keep typed decision failures under `onDecisionError()`.
9. Test the entry, correction, transition, restore, completion, and
   model- and decision-fallback paths.

See the [QuoteGraph walkthrough](/ezgraph/quote-graph/) for a complete guided
application, the [DecisionHotelGraph tutorial](/ezgraph/docs/tutorials/decision-hotel-graph/)
for decision nodes backed by Jev, and the [tutorial](/ezgraph/tutorial/) for a
small runnable graph.
