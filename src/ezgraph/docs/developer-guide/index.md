---
layout: layouts/ezgraph.njk
title: EZGraph developer guide
description: The complete developer guide for authoring, running, persisting, testing, and evolving EZGraph applications.
permalink: /ezgraph/docs/developer-guide/
ezgraph: true
ezgraphDocument: true
---
# The EZGraph developer's guide

This guide assumes you have never used EZGraph and have never used LangGraph. It
starts with the mental model, builds one working graph end to end, then documents
every construct, every hook you can override, and every behavior the framework
performs on your behalf.

If you already know LangGraph, you can still read from the top — but
[§16, For developers coming from LangGraph](#16-for-developers-coming-from-langgraph)
is written specifically for you and explains what EZGraph removes, adds, and
forbids.

---

## Table of contents

1. [What EZGraph is](#1-what-ezgraph-is)
2. [The mental model in five minutes](#2-the-mental-model-in-five-minutes)
3. [Setup](#3-setup)
4. [Your first graph, end to end](#4-your-first-graph-end-to-end)
5. [The turn lifecycle](#5-the-turn-lifecycle)
6. [Core architecture: every construct and why it exists](#6-core-architecture-every-construct-and-why-it-exists)
7. [The graph definition, field by field](#7-the-graph-definition-field-by-field)
8. [Graph state, field by field](#8-graph-state-field-by-field)
9. [Every hook you can override](#9-every-hook-you-can-override)
10. [Tools](#10-tools)
11. [Outcomes and routing](#11-outcomes-and-routing)
12. [Models](#12-models)
13. [Persistence, concurrency, and schema versioning](#13-persistence-concurrency-and-schema-versioning)
14. [Behaviors that exist to make your life easier](#14-behaviors-that-exist-to-make-your-life-easier)
15. [Testing](#15-testing)
16. [For developers coming from LangGraph](#16-for-developers-coming-from-langgraph)
17. [Pitfalls](#17-pitfalls)
18. [Export index](#18-export-index)

---

## 1. What EZGraph is

EZGraph is a TypeScript framework for **multi-turn, stateful conversations with
an LLM**, built on top of LangGraph and LangChain. You write plain TypeScript
classes; the framework owns the request boundary, the model↔tool loop, session
persistence, concurrency control, and provider quirks.

It is designed around one specific shape of application:

> A user sends a message. Your graph does some model calls and tool calls,
> possibly moves the conversation to a new stage, and returns one response. Some
> time later the same user sends another message and the conversation continues
> exactly where it left off — in a different process, on a different machine, days
> later.

Concretely, EZGraph gives you:

- **A request/response entry point.** `GraphEngine.run()` takes a user message and
  a session ID and returns an HTTP-shaped result. There is no long-lived
  in-memory conversation object to manage.
- **Nodes as classes.** A conversational stage is a class with a prompt, some
  tools, and a decision about what happens next.
- **Semantic turn outcomes.** Instead of hand-wiring conditional edges, a node
  says `stay()`, `advance(NextNode)`, `quit()`, or `finish()`.
- **Application-owned persistence.** One JSON document per session in SQLite,
  MongoDB, Cosmos DB, or memory — a document you can read, migrate, and expire
  yourself.
- **Fail-fast concurrency.** Two overlapping turns for the same session cannot
  interleave; the second one is rejected with `409`.
- **Provider neutrality with real defaults.** A validated model catalog, per-node
  model overrides, token accounting, timeouts, cancellation, and classified
  handling of empty or blocked model responses.

What EZGraph is **not**: it is not a streaming framework (turns are
request/response today), not a general-purpose workflow engine, and not a thin
wrapper you can drop raw LangGraph calls into. The topology API deliberately
refuses to expose the underlying `StateGraph`.

---

## 2. The mental model in five minutes

Five concepts carry almost everything.

### A session is a document

Every conversation is one JSON document, keyed by session ID, in your session
store. It holds the chat histories, the active node, your per-node state,
accumulated token usage, warnings, and errors. Nothing lives in process memory
between turns.

### A turn is one `run()` call

```ts
const result = await engine.run({
  graphName: "HotelGraph",
  sessionId: "abc-123",
  userMessage: "find me a hotel in Portland",
});
```

That call loads the document, runs the graph, saves the document, and returns.
The turn is the unit of concurrency, cancellation, logging, and persistence.

### A node is a conversational stage

```ts
class ExploreNode extends ConversationNode<HotelGraphStateType, LocalState, Context> {
  getPrompt(state) { /* the system prompt for this stage */ }
  defineTool() { /* the tools this stage publishes */ }
  nextStep(state, context, conversation) { /* what happens next */ }
}
```

A node owns a prompt, tools, and a decision. It does not own persistence,
message plumbing, or routing tables.

### An outcome is the node's decision

```ts
return this.stay(conversation);                    // ask the user something else
return this.advance(PresentNode, conversation);    // move to the next stage
return this.quit(conversation);                    // the user asked to stop
return this.finish("Here is your result.", conversation); // the graph is done
```

These are not just routing hints. Each one is a complete, consistent state
update: response text, history append, token accounting, `currentNode`, the
completion flag, and the route — all set correctly together, so you cannot
produce a half-updated turn.

### `currentNode` is how a conversation resumes

The document remembers which node the conversation is sitting in. On the next
turn, the graph enters that node directly. This is what makes a "wait for the
user" interrupt just a persisted string instead of a suspended coroutine.

---

## 3. Setup

**Requirements:** Node.js ≥ 22.5, TypeScript 5.x.

```bash
npm install @picoflow/ezgraph
```

This is the published [`@picoflow/ezgraph` npm package](https://www.npmjs.com/package/@picoflow/ezgraph).

Model providers are optional peer dependencies. Install the ones you use:

```bash
npm install @langchain/openai      # openai, azure_openai
npm install @langchain/anthropic   # anthropic
npm install @langchain/google      # google
```

### TypeScript configuration

Tool handlers use a method decorator, so decorator support and metadata emission
are required:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are not required, but
the framework is written under them and its types are most precise with them on.

### Runtime import

Import `reflect-metadata` **once**, at the very top of your application entry
point, before any node module is loaded:

```ts
import "reflect-metadata";
```

### Environment

Session persistence is selected by environment variable when you use
`GraphEngine.create()`:

| Variable | Values / default | Purpose |
| --- | --- | --- |
| `SESSION_STORE` | `memory` (default), `sqlite`, `mongodb`, `cosmos` | Which store backs the session document |
| `SESSION_TURN_LEASE_MS` | `60000` | How long one turn may hold its exclusive lease |
| `SQLITE_DB_PATH` | `./data/sessions.sqlite` | SQLite file |
| `MONGODB_URL`, `MONGODB_NAME`, `MONGODB_COLLECTION` | — | All three required for `mongodb` |
| `COSMODB_URL` + `COSMODB_KEY`, or `COSMO_ENDPOINT` + `AZURE_TENANT_ID` + `COSMO_DB_CLIENT_ID` + `COSMO_DB_CLIENT_SECRET` | — | Cosmos DB, key or service principal |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, … | — | Provider credentials |

For the NestJS reference application, copy its
[`.env.example`](https://github.com/picoflowio/ezgraph-demo/blob/main/.env.example)
to `.env` and set the API key for the provider you choose. It starts with
`PORT=8000`, `SESSION_STORE=sqlite`, and `SQLITE_DB_PATH=./data/sessions.sqlite`;
MongoDB or Cosmos values are needed only when you select those stores.

---

## 4. Your first graph, end to end

We will build a two-stage assistant: it collects a city, then reports the
weather. Four files.

### 4.1 State

State is declared once per graph with `createGraphStateAnnotation`. The first
argument is the node the conversation starts in; the optional second argument
supplies the initial per-node state object, which is where you attach types.

```ts
// weather-graph.state.ts
import { createGraphStateAnnotation, type NodeStateValue } from "@picoflow/ezgraph";
import { CollectNode } from "./nodes/collect.node.js";

export type WeatherGraphNodes = {
  CollectNode?: NodeStateValue<{ city?: string }>;
  ReportNode?: NodeStateValue<{ city?: string }>;
};

export const WeatherGraphState = createGraphStateAnnotation(
  CollectNode.id(),
  () => ({}) as WeatherGraphNodes,
);

export type WeatherGraphStateType = typeof WeatherGraphState.State;
```

`CollectNode.id()` is the node's **durable identity**, which defaults to the
class name. Use `id()` rather than `name` so an overridden ID keeps working.

### 4.2 The first node

```ts
// nodes/collect.node.ts
import { z } from "zod";
import {
  ConversationNode,
  Tool,
  type ConversationNodeRunResult,
  type ConversationToolResult,
  type GraphNodeUpdate,
  type ToolDefinition,
} from "@picoflow/ezgraph";
import type { WeatherGraphStateType } from "../weather-graph.state.js";
import { ReportNode } from "./report.node.js";

type CollectContext = { city?: string };

export class CollectNode extends ConversationNode<
  WeatherGraphStateType,
  { city?: string },  // this node's persisted local state
  CollectContext      // this turn's working context
> {
  getPrompt(): string {
    return "Ask the user which city they want the weather for. When they name one, call capture_city. If they ask to stop, call terminate_session.";
  }

  defineTool(): readonly ToolDefinition<{ city: string }>[] {
    return [
      {
        name: "capture_city",
        description: "Record the city the user asked about.",
        schema: z.object({ city: z.string().min(1) }),
      },
    ];
  }

  @Tool("capture_city")
  captureCity(
    { city }: { city: string },
    _context: CollectContext,
  ): ConversationToolResult {
    return this.toolResult({ accepted: true })
      .withContext({ city })
      .haltAfterBatch();
  }

  protected createContext(state: WeatherGraphStateType): CollectContext {
    const saved = this.state(state).city;
    return saved === undefined ? {} : { city: saved };
  }

  protected nextStep(
    _state: WeatherGraphStateType,
    context: CollectContext,
    conversation: ConversationNodeRunResult,
  ): GraphNodeUpdate<WeatherGraphStateType> {
    if (conversation.quitRequested) return this.quit(conversation);
    if (context.city) {
      return this.advance(ReportNode, conversation)
        .withState({ city: context.city })
        .withStateFor(ReportNode, { city: context.city });
    }
    return this.stay(conversation);
  }
}
```

Three things to notice:

- `defineTool()` **publishes** a tool; `@Tool("capture_city")` **consumes** it.
  Splitting them lets one node own a tool's schema while several nodes handle it.
- The handler mutates nothing. `withContext({ city })` records a typed effect
  that the framework applies to the turn context after the handler returns.
- `nextStep()` checks `quitRequested` *before* domain success, because a model
  can call several tools in one batch and an explicit request to stop should win.

### 4.3 The second node

```ts
// nodes/report.node.ts
import {
  ConversationNode,
  type ConversationNodeRunResult,
  type GraphNodeUpdate,
} from "@picoflow/ezgraph";
import type { WeatherGraphStateType } from "../weather-graph.state.js";

export class ReportNode extends ConversationNode<
  WeatherGraphStateType,
  { city?: string }
> {
  getPrompt(state: WeatherGraphStateType): string {
    const city = this.state(state).city;
    return `Report today's weather conversationally for ${city ?? "the requested city"}, then stop.`;
  }

  protected createContext(): Record<string, never> {
    return {};
  }

  protected nextStep(
    _state: WeatherGraphStateType,
    _context: Record<string, never>,
    conversation: ConversationNodeRunResult,
  ): GraphNodeUpdate<WeatherGraphStateType> {
    if (conversation.quitRequested) return this.quit(conversation);
    return this.finish(conversation.response ?? "All set.", conversation);
  }
}
```

### 4.4 The graph

```ts
// weather-graph.ts
import { END } from "@langchain/langgraph";
import {
  BaseGraph,
  GRAPH_END_NODE,
  ModelCatalog,
  TerminateSessionNode,
  type GraphDefinition,
  type LlmGateway,
} from "@picoflow/ezgraph";
import { WeatherGraphState, type WeatherGraphStateType } from "./weather-graph.state.js";
import { CollectNode } from "./nodes/collect.node.js";
import { ReportNode } from "./nodes/report.node.js";

export class WeatherGraph extends BaseGraph<WeatherGraphStateType> {
  static getGraphDefinition(): GraphDefinition {
    return {
      llmConfig: ModelCatalog.model("openai:gpt-4o", { retries: 3 }),
      endNode: GRAPH_END_NODE,
      initialHistorySpace: "collect",
      historySpaces: [
        [CollectNode, "collect"],
        [ReportNode, "report"],
        [TerminateSessionNode, "terminal"],
      ],
    };
  }

  constructor(llmGateway: LlmGateway) {
    super(llmGateway, WeatherGraph.getGraphDefinition());
  }

  protected buildGraph() {
    const graph = this.createStateGraph(WeatherGraphState);
    graph.registerTurnNodes(CollectNode, ReportNode, TerminateSessionNode);
    graph.configAutoRoute();
    graph.addEdge(TerminateSessionNode, END);
    return graph.compile();
  }
}
```

`TerminateSessionNode` is not optional decoration. `ConversationNode` inherits a
`terminate_session` handler, and that tool's *definition* comes from
`TerminateSessionNode.defineTool()`. If you extend `ConversationNode` without
registering `TerminateSessionNode`, `compile()` fails with
`Tool 'terminate_session' is not defined in this graph.`

### 4.5 Running it

```ts
import "reflect-metadata";
import { GraphEngine } from "@picoflow/ezgraph";
import { WeatherGraph } from "./weather-graph.js";

const engine = await GraphEngine.create({ graphs: [WeatherGraph] });

// Turn 1: CollectNode has no city yet, so it stays and asks.
const first = await engine.run({
  graphName: "WeatherGraph",
  sessionId: "demo-1",
  userMessage: "hi",
});
// { status: 200, body: { success: true, completed: false, message: "Which city …" } }
// Persisted: currentNode = "CollectNode"

// Turn 2: CollectNode captures the city and advances.
const second = await engine.run({
  graphName: "WeatherGraph",
  sessionId: "demo-1",
  userMessage: "Portland",
});
// { status: 200, body: { success: true, completed: true, message: "It is 72 degrees …" } }
// Persisted: currentNode = "end", completed = true
```

Between those two calls your process could restart. Turn 2 reads the document,
sees `currentNode: "CollectNode"`, and enters that node directly — that resume is
the whole point of persisting the active node.

Note what turn 2 does *not* do: it does not stop after `advance(ReportNode, …)`.
`advance()` routes into the target **in the same invocation**, so `ReportNode`
runs immediately, produces the weather report, and finishes. Use `stay()` when
you want the turn to end and wait for the user. This is the single most common
early misreading of the outcome helpers.

---

## 5. The turn lifecycle

This is exactly what one `GraphEngine.run()` does, in order. Knowing this
sequence explains most framework behavior.

1. **Resolve the graph.** Unknown graph name → `400`.
2. **Validate the user message.** Empty and `requiresUserMessage !== false` →
   `400`.
3. **Validate the session ID.** Must match `[A-Za-z0-9_-]{1,128}`. Missing → a
   fresh UUID.
4. **In-process guard.** If this process is already running a turn for this
   session → `409 SESSION_BUSY`.
5. **Install the turn scope.** The caller's `AbortSignal` and a fresh log
   collector are attached to the async execution (`AsyncLocalStorage`), not to any
   object.
6. **Begin the turn.** Take an exclusive lease on the document with a
   compare-and-swap on `revision`. A live lease held by someone else →
   `409 SESSION_BUSY`.
7. **Restore.** `graph.restoreSessionDoc(document)` verifies graph identity,
   applies schema migrations, then calls your `onRestoreSessionDoc()` policy.
   Returning `null` starts the session over.
8. **Persist a migration**, if one ran, under the same lease.
9. **Reject a finished session.** If the stored state is already `completed`,
   release the lease and return — `200` with a polite message for a chat graph,
   `409 SESSION_COMPLETED` for a JSON graph.
10. **Hydrate and invoke.** Rebuild `GraphState` from the document, append the
    user message to the active history space, and invoke the compiled LangGraph.
11. **Save.** Persist the resulting state, token usage, warnings, and errors, and
    clear the lease — again a compare-and-swap on `revision`.
12. **Render.** `200` with a chat envelope, or the graph's own JSON object for a
    JSON-mode graph.

If step 10 or 11 throws, the engine records the error into the document, releases
the lease, and returns `400` with the message. A `SessionTurnError` becomes `409`
with its code.

Inside step 10, each node invocation runs its own loop:

1. `getPrompt(state)` produces the system prompt.
2. The node's history space is read. If empty, it is seeded (see
   `emptyHistorySeed`).
3. Up to `maxAgentRounds` iterations: call the model with the published tools; if
   the model returns text, stop; if it returns tool calls, execute **all** of
   them, append a `ToolMessage` for each, and loop.
4. An empty response is classified and possibly nudged (see
   [§14](#14-behaviors-that-exist-to-make-your-life-easier)).
5. `nextStep()` (or your `run()`) turns the conversation result into one outcome.
6. `invoke()` validates JSON mode and records effective-model metadata.

---

## 6. Core architecture: every construct and why it exists

### `GraphEngine` — the request boundary

**Why:** somebody has to own "one user request." Without a boundary, session
loading, concurrency, cancellation, and log scoping leak into every graph.

The engine holds the registry, the session manager, and the gateway factory. It
returns `{ status, body, session, contentType }` — deliberately HTTP-shaped, so
wiring it to Express, Fastify, or NestJS is a pass-through, but with no HTTP
dependency in the framework.

### The session document — persistence you own

**Why not LangGraph's checkpointer?** A checkpointer stores framework-internal
snapshots. What a production conversation actually needs is an
*application-level* document: one row per session, readable in a database
browser, versioned by *your* schema number, migratable by *your* code, and
expirable by *your* policy. EZGraph therefore does not use checkpointers at all.

```ts
type SessionDocument<State> = {
  version: number;          // framework document schema (SESSION_DOCUMENT_VERSION)
  id: string;               // session ID
  revision: number;         // compare-and-swap counter
  status: "in_progress" | "completed" | "error";
  tokens: TokenUsage;
  errors: SessionLogEntry[];
  warnings: SessionLogEntry[];
  graph: {
    id: string;             // durable graph ID; a session belongs to one graph forever
    schemaVersion: number;  // your graph's schema version
    currentNode?: string;
    config?: Record<string, unknown>;
    histories: Record<string, StoredMessage[]>;
    nodes?: object;         // your per-node state
    model: GraphLlmModelMetadata;
  };
  turn?: { owner: string; expiresAt: string };  // the exclusive lease
  createdAt: string;
  modifiedAt: string;
};
```

### `BaseGraph` — the graph contract

**Why:** a graph is more than a topology. It is a durable identity, a schema
version, a default model, a response mode, history-space assignments, and an
agent-loop policy. `BaseGraph` makes all of that one declarative object
(`GraphDefinition`) that is validated at construction, so a misconfigured graph
fails at startup rather than mid-conversation.

### `GraphState` and `createGraphStateAnnotation` — one state shape, correct reducers

**Why:** hand-writing reducers is the most common source of subtle state bugs.
EZGraph fixes the shape and supplies a correct reducer for each field: histories
merge per space with LangChain's message reducer, `nodes` deep-merges with
`undefined` as a deletion marker, `tokens` accumulates, and scalar turn fields
replace.

### `StateGraphExt` — a deliberately narrow topology facade

**Why:** the underlying `StateGraph` is private. Every node must be added as a
class so the framework can construct it, register its tools, and check its
identity. Every edge endpoint is validated against added nodes, so "add a node and
forget to wire it" fails at `compile()` rather than becoming a runtime routing
surprise. Note that `compile()` runs lazily on first use — see
[§14](#validated-up-front-not-mid-conversation).

### `GraphNode` — a stage as a class

**Why:** a node needs a prompt, a tool set, a model config, local state, and a
decision. Expressing that as a class gives you inheritance for shared behavior
(`ConversationNode` is exactly that), a durable ID from the class name, and typed
local state via generics.

Node instances are **created once and shared by every session and every
concurrent turn**, and they are frozen after construction. See
[§17](#17-pitfalls).

### `ConversationNode` — the shape most stages want

**Why:** almost every conversational stage does the same three things: build a
working context, run the agent loop, choose an outcome. `ConversationNode` does
the first and second for you, adds the shared `terminate_session` handling, and
asks only for `createContext()` and `nextStep()`.

### `ConversationRunner` — the agent loop, once

**Why:** the model↔tool loop has a dozen edge cases (multi-tool batches, tool
errors, attachment cleanup, empty candidates, round caps). Implementing it per
node guarantees drift. One runner owns message sequencing; nodes own typed tool
effects.

### Node outcomes — consistency by construction

**Why:** "respond and stay" is not one field. It is response text, an
`inputConsumed` flag, a history append of the assistant message, token
accounting, `currentNode`, and a route. A `stay()` sets all six correctly.
Builders are immutable and their fluent methods are **non-enumerable**, so
LangGraph sees only real state fields.

### `LlmGateway` and the model catalog — provider neutrality with teeth

**Why:** node code should not know whether it is talking to OpenAI or Gemini. The
gateway exposes five intents (`structured`, `generate`, `respond`, `agent`,
`toolCall`); the catalog validates that a model exists and that its parameters
are legal for its family *before* the first request.

### `TurnContext` and session logs — request scope without request objects

**Why:** nodes are shared singletons, so per-turn data cannot live on them. Both
the cancellation signal and the warning/error collector travel with the async
execution through `AsyncLocalStorage`. This is why `SessionLogWarning()` works
from anywhere inside a turn with no plumbing.

---

## 7. The graph definition, field by field

Returned from your `static getGraphDefinition()` and passed to `super()`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `llmConfig` | `GraphLlmConfig` | **required** | Default model for every node. Validated immediately. |
| `endNode` | `string` | **required** | Persisted terminal state. Use `GRAPH_END_NODE` (`"end"`) unless you need another marker. |
| `schemaVersion` | `number` | `1` | Your graph's persisted state schema. |
| `migrations` | `GraphSchemaMigration[]` | `[]` | Ordered, contiguous `from → from + 1` migrations. |
| `requiresUserMessage` | `boolean` | `true` | `false` lets a turn start with no user text (batch/JSON graphs). |
| `responseMode` | `"chat" \| "json"` | `"chat"` | `"json"` returns the graph's own object as the response body. |
| `historySpaces` | `readonly [NodeClass, string][]` | `[]` | Which named history each node reads and appends to. |
| `initialHistorySpace` | `string` | `"default"` | Space used before the graph has entered a node. |
| `maxAgentRounds` | `number` | `8` | Max sequential model↔tool rounds **inside one node invocation**. Not a turn or session limit. |
| `llmTimeoutMs` | `number` | unbounded | Wall-clock budget for one provider request (per retry attempt, not total). |
| `emptyHistorySeed` | `string \| null` | `"Start"` | Message that seeds a freshly entered history space. `null` sends the system prompt alone. |
| `emptyResponseRecovery` | `{ retries, nudge } \| null` | `{ retries: 2, nudge: … }` | Retry policy for a model turn with neither text nor a tool call. `null` accepts the empty turn. |

Every field is validated in the constructor: `maxAgentRounds` and `llmTimeoutMs`
must be positive integers, `emptyResponseRecovery.retries` a non-negative
integer, `schemaVersion` a positive integer, migrations ordered and contiguous,
and the model config legal for its parameter profile. All of that throws while
you construct the graph. Tool and topology checks happen slightly later — see
[§14](#validated-up-front-not-mid-conversation).

### Why `maxAgentRounds` is not a "max turns"

It bounds **one node invocation's** model↔tool loop. A node that calls three
tools sequentially before answering uses four rounds. It does not limit how many
user turns a session can have, how deep your graph is, or how many nodes run in
one invocation. Exceeding it throws
`Conversation exceeded N agent rounds.`

---

## 8. Graph state, field by field

```ts
type GraphState<CurrentNode extends string = string, Nodes extends object = GraphNodeStates> = {
  histories: Record<string, BaseMessage[]>;
  currentNode: CurrentNode;
  config: Record<string, unknown>;
  nodes: Nodes;
  tokens: TokenUsage;
  inputConsumed: boolean;
  response: string;
  completed: boolean;
  outcomeRoute: string | undefined;
};
```

| Field | Reducer | Who writes it |
| --- | --- | --- |
| `histories` | per-space message merge | The runner, outcome helpers, `withHistory()` |
| `currentNode` | replace | Outcome helpers. This is the resume point. |
| `config` | shallow merge | The caller, via `run({ config })` |
| `nodes` | deep merge; `undefined` deletes a key | `save()`, `remove()`, `withState()`, `withStateFor()` |
| `tokens` | additive | Outcome helpers, from the conversation result |
| `inputConsumed` | replace | Outcome helpers; `forwardInput()` sets it back to `false` |
| `response` | replace | `respond()`, `complete()`, `stay()`, `finish()` |
| `completed` | replace | `complete()`, `finish()` |
| `outcomeRoute` | replace | Outcome helpers; read by `configAutoRoute()` |

You never declare these fields. `createGraphStateAnnotation()` builds the
annotation, including the reducers; your only inputs are the starting node ID and
your typed `nodes` shape.

### `config`

Per-turn caller input, merged into the document. Use it for tenant IDs, locale,
feature flags — anything the caller knows and the graph needs. It is shallow
merged, so a later turn can override one key without resending the rest.

### `nodes` — per-node local state

Each node reads and writes its own slice through typed helpers, so two nodes
cannot accidentally share a key:

```ts
this.state(state).city                        // read this node's slice
this.save({ city: "Portland" })               // raw update for this node
this.remove("city")                           // delete a key
this.stay(conversation).withState({ city })    // the usual path, on an outcome
this.advance(Next, conversation).withStateFor(Next, { seeded: true })
```

The framework also stores a `model` key in each node's slice when that node uses
a non-default model, so you can see from the document which model actually
answered.

---

## 9. Every hook you can override

### 9.1 Graph-level

| Member | Kind | When it runs | Default |
| --- | --- | --- | --- |
| `static getGraphDefinition()` | required by convention | At construction and at registration | — |
| `static id()` | override | Whenever durable identity is needed | The class name. **Override only to preserve an ID across a class rename.** |
| `protected abstract buildGraph()` | **required** | Once, lazily, on first `graph` access | — |
| `protected onRestoreSessionDoc(doc)` | hook | Every turn, after migrations, before hydration | Returns the document unchanged |
| `protected idleMs(doc)` | helper/override | When you call it | `Date.now() - Date.parse(doc.modifiedAt)`, or `0` if unparseable |
| `prepareInput(state, message)` | override | Every turn with a user message | Appends the message to the active history space |
| `restoreSessionDoc(doc)` | override (rarely) | Every turn | Identity check → migrations → `onRestoreSessionDoc()` |

**`onRestoreSessionDoc` is your session-policy hook.** There is no framework
`expireAfter` setting, on purpose: expiry is a business decision. Return `null`
to start the session over, a modified document to reshape it, or the document
unchanged.

```ts
protected override async onRestoreSessionDoc(
  doc: SessionDocument<HotelGraphStateType>,
): Promise<SessionDocument<HotelGraphStateType> | null> {
  if (this.idleMs(doc) >= 30 * 60_000) return null;  // stale booking chat: start over
  return doc;
}
```

**Migrations** run before your hook, so `onRestoreSessionDoc` always sees a
current-schema document:

```ts
migrations: [
  {
    from: 1,
    migrate: (doc) => ({
      ...doc,
      graph: { ...doc.graph, nodes: renameLegacyKeys(doc.graph.nodes) },
    }),
  },
],
schemaVersion: 2,
```

### 9.2 Node-level: required members

| Member | Class | Purpose |
| --- | --- | --- |
| `getPrompt(state)` | `GraphNode` | The system prompt for this node. |
| `run(state)` | `GraphNode` | The whole node body. Must return a state update. |
| `createContext(state)` | `ConversationNode` | Fresh per-turn working context, hydrated from persisted state. |
| `nextStep(state, context, conversation)` | `ConversationNode` | Select exactly one outcome. |

`ConversationNode` implements `run()` for you as
`createContext → runConversation → nextStep`. Implement `run()` directly only
when you need a non-conversational node (a worker, a fan-out parent, a
deterministic transform).

### 9.3 Node-level: optional overrides

| Member | Default | Override when |
| --- | --- | --- |
| `defineTool()` | `[]` | This node publishes tool definitions. |
| `getLlmConfig()` | `{}` (graph default) | This node needs a different model or parameters. |
| `route(state)` | throws | You use the low-level `branch(NodeClass, …)` topology API. |
| `static id()` | class name | Preserving a durable ID across a rename. |
| `supportsAutomaticOutcomeRouting` | `false` on `GraphNode`, `true` on `ConversationNode` | Rarely. It tells `configAutoRoute()` whether to add an outcome branch for this node. |
| `protected handleTool(state, call, context)` | dispatches to the `@Tool` method, with argument recovery | You need custom dispatch, tracing, or authorization around every tool call. |
| `protected onInvalidJsonResponse(context)` | rethrows | A JSON-mode node should repair or retry malformed terminal output. |
| `protected onEmptyModelResponse(context)` | throws `EmptyModelResponseError` | A blocked or truncated turn should answer in your own voice. |
| `protected runConversation(state, context)` | agent loop + empty-response hook | You need to wrap or instrument the loop. Call `super`. |
| `protected historySpace()` | the graph's assignment for this node | Almost never; declare `historySpaces` in the definition instead. |

#### `onInvalidJsonResponse`

For `responseMode: "json"`, `invoke()` validates a completed response *before*
LangGraph commits the update. Your hook's return value **replaces** the proposed
update, so return a complete outcome:

```ts
protected override async onInvalidJsonResponse(
  context: InvalidJsonResponseContext<MyState>,
) {
  const repaired = await this.repair(context.response, context.error);
  if (repaired) return this.complete(repaired);

  // Or keep the session alive at this node for another attempt.
  return {
    ...this.respond(JSON.stringify({ status: "output_repair_required" })),
    currentNode: this.id,
    completed: false,
  } as GraphNodeUpdate<MyState>;
}
```

If your replacement claims completion or exposes a response, that response is
validated again — a JSON graph cannot emit non-JSON.

#### `onEmptyModelResponse`

Called when a turn ends with no text and no tool call. `context.reason.category`
tells you whether a retry was ever possible:

| Category | Meaning | Retryable |
| --- | --- | --- |
| `blocked` | Safety, content filter, recitation, blocklist, refusal | No |
| `truncated` | Hit the output token cap | No |
| `malformed_tool_call` | The provider rejected the model's own tool call | Yes |
| `complete` | The model chose to say nothing | Yes |
| `unspecified` | No usable provider reason | Yes |

The retryable categories have already been nudged and retried by the time your
hook runs. So the hook exists mainly to give a graceful answer for the
non-retryable ones:

```ts
protected override onEmptyModelResponse(
  context: EmptyModelResponseContext<HotelGraphStateType>,
): string | Promise<string> {
  if (context.reason.category === "blocked") {
    return "I can't help with that request, but I can still find you a hotel. What city and dates are you looking at?";
  }
  return super.onEmptyModelResponse(context);
}
```

Note the return type: `string | Promise<string>`. Widen your override signature
to match even if your implementation is synchronous.

### 9.4 Node-level: protected helpers

Not hooks — the vocabulary you write node bodies with.

| Helper | Returns |
| --- | --- |
| `this.state(state)` | This node's typed local state |
| `this.save(patch)` / `this.remove(...keys)` | Raw local-state updates |
| `this.history(state)` / `this.historyUpdate(messages)` | This node's messages / an append update |
| `this.respond(text)` | Update: response + input consumed + assistant message appended |
| `this.complete(text)` | `respond()` plus terminal node and `completed: true` |
| `this.stay(conversation, response?)` | Outcome: keep this node active |
| `this.advance(Target, conversation)` | Outcome: move to `Target`; supports `forwardInput()` |
| `this.quit(conversation)` | Outcome: route through `TerminateSessionNode` (`ConversationNode` only) |
| `this.finish(response, conversation)` | Outcome: terminal, completed |
| `this.resumeAt(Target, conversation)` | Record `Target` as the next user-turn resume point without routing there now |
| `this.transition(Target, conversation, canForward)` | The lower-level form behind `advance`/`quit` |
| `this.toolResult(output)` | A tool-result builder |
| `this.llmConfig()` | The effective model config for this node |
| `this.llmCallOptions()` | The effective timeout + the caller's cancellation signal |
| `this.runConversation(state, context)` | Run the agent loop from a custom `run()` |
| `this.llmGateway` | The gateway, for direct `generate`/`structured`/`toolCall` calls |

---

## 10. Tools

### Definition and consumption are separate

```ts
// Publication: the schema and description the model sees.
defineTool(): readonly ToolDefinition<{ city: string }>[] {
  return [{ name: "capture_city", description: "…", schema: z.object({ city: z.string() }) }];
}

// Consumption: this node handles it, so this node offers it to the model.
@Tool("capture_city")
captureCity(input: { city: string }, context: MyContext, state: MyState) { … }
```

Rules the framework enforces:

- A tool name may be **defined** once per graph. Two nodes defining
  `capture_city` throws when the graph is built.
- A node may **handle** a tool name once. Two `@Tool("x")` methods on one node
  throws.
- A node offers the model exactly the tools it handles. A defined-but-unhandled
  tool is invisible.
- A handled-but-undefined tool throws at `compile()`, before any model call.
- `terminate_session` is always sorted last in the tool list, so a domain tool
  never gets shadowed by the quit tool in the model's attention.
- Handlers are inherited: `@Tool` metadata is collected up the prototype chain,
  which is how `ConversationNode.endChat` works for every subclass.

### Handler signature

```ts
@Tool("name")
handler(
  input: TypedInput,       // already parsed and Zod-validated
  context: ToolContext,    // this turn's working context
  state: State,            // read-only graph state
): ConversationToolResult | Promise<ConversationToolResult>
```

`input` is validated before your handler runs. You never parse arguments.

### Argument recovery

If the model sends malformed JSON or arguments that fail your Zod schema, the
framework does **not** throw and does **not** make a hidden extra model call. It
returns `{ accepted: false, error }` to the model as the tool result and records a
warning. The agent loop continues, the model sees precisely what was wrong, and it
corrects itself on the next round. A schema violation becomes a conversation, not
a `500`.

### The tool result builder

```ts
return this.toolResult({ temperature })            // model-visible output
  .withContext(({ weather }) => ({                  // typed effect on turn context
    weather: { ...weather, [city]: temperature },
  }))
  .withMessages(extraMessage)                       // extra model-visible messages
  .withCleanup(() => file.cleanup())                // release a provider attachment
  .stopAfterBatchWhen(({ weather }) => hasBoth(weather));  // conditional stop
```

| Modifier | Effect |
| --- | --- |
| `withContext(patchOrFn)` | Applied in order after the handler returns |
| `withMessages(msgs)` | Appended to history after the tool message |
| `withCleanup(fn)` | Runs after the next model turn |
| `haltAfterBatch()` | Unconditional stop after this batch |
| `stopAfterBatchWhen(pred)` | Stop if the predicate holds against the updated context |

Deferring context effects is what makes multi-tool batches composable: each
handler declares its change, the framework applies them in order, then evaluates
stop predicates against the final context.

Raw `ConversationToolResult` objects still work if you prefer
`{ output, stopAfterBatch: true }`.

### Batch semantics

The runner always executes **every** tool call in the current assistant-message
batch and appends **every** corresponding `ToolMessage` before honoring a stop.
Providers reject a conversation with an unanswered tool call, so a stop can never
leave a dangling one. Pending attachment cleanups are released before a stopped
return and before a rethrown tool error.

### File attachments

`ProviderFileManager` uploads a local file to OpenAI, Google, or Anthropic and
returns `{ contentPart, fileId, cleanup }`. Attach `contentPart` to a message via
`withMessages()` and hand `cleanup` to `withCleanup()`; the runner releases it
after the model has seen it.

---

## 11. Outcomes and routing

[`conversation-node-outcomes.md`](/ezgraph/docs/developer-guide/) covers this in
depth. The essentials:

| Outcome | Invariants it sets |
| --- | --- |
| `stay(conversation, response?)` | This node stays active, response required, input consumed, history + tokens recorded, route ends the invocation |
| `advance(Target, conversation)` | `Target` becomes the resume node, response cleared, input consumed, history + tokens recorded, route enters `Target` |
| `quit(conversation)` | Routes through the shared `TerminateSessionNode`; input forwarding intentionally unavailable |
| `finish(response, conversation)` | Terminal node, `completed: true`, response required, history + tokens recorded |
| `resumeAt(Target, conversation)` | Records `Target` as the next user-turn entry **without** routing there now |

Every outcome supports `.withState()`, `.withStateFor(Node, …)`,
`.withHistory(space, messages)`, and `.via(Node)`. Only `advance()` supports
`.forwardInput(state, fallback?)`, which marks the input unconsumed and copies the
latest user message into the target's history space when the spaces differ.

`.via(Node)` changes only the immediate route. The durable `currentNode` stays
what the outcome chose — so a worker can run in the same invocation without
changing where the next user turn lands.

### Three ways to route

```ts
// 1. Automatic, from outcome metadata. The usual choice for conversation graphs.
graph.configAutoRoute();

// 2. Explicit, keyed on persisted currentNode.
graph.branchBy(WeatherNode, {
  cases: [{ when: FavoritesNode, routeTo: FooLogicNode }],
  otherwise: END,
});

// 3. Fixed edges, for internal work that makes no decision.
graph.addEdge(FooLogicNode, GooLogicNode);
graph.addEdge([Child1Node, Child2Node], DobNode);   // fan-in
```

An explicit `branch()`/`branchBy()` on a source wins; automatic routing skips
that source. `registerTurns(...)` declares which nodes a later user turn may
enter, mapping your terminal state to LangGraph's `END`; `registerTurnNodes(...)`
does `nodes(...)` and `registerTurns(...)` together.

### History spaces

A history space is a named message list. Assign one per node in the definition.
Nodes sharing a space share context; nodes with their own space start clean.
That is how you keep a compliance-sensitive stage from inheriting chit-chat, or
give a summarizer an isolated window — without manually slicing arrays.

---

## 12. Models

### Built-in models

```ts
llmConfig: ModelCatalog.model("openai:gpt-4o", { retries: 3 })
llmConfig: ModelCatalog.model("google:gemini-3.5-flash", { retries: 3, temperature: 0.2 })
```

`ModelCatalog.model()` is statically typed per model: the parameter object is
checked against that model's **family profile** (`chat`, `reasoning`, or
`thinking`), so `temperature` on a reasoning model or `reasoningEffort` on a chat
model is a compile error, and the value is validated again at runtime.

Common parameters across families: `retries` (required), `maxOutputTokens`,
`forceToolCalls`, `requiredCapabilities`.

### Capabilities

Declare what a node actually needs and let startup fail loudly if the model
cannot do it:

```ts
ModelCatalog.model("openai:gpt-4o", {
  retries: 2,
  requiredCapabilities: { pdfInputs: true, toolCalling: true },
})
```

Available: `imageInputs`, `imageUrlInputs`, `pdfInputs`, `audioInputs`,
`videoInputs`, `reasoningOutput`, `toolCalling`, `toolChoice`,
`structuredOutput`.

### Per-node overrides

```ts
getLlmConfig(): GraphLlmConfigOverride {
  return ModelCatalog.model("openai:gpt-5.1", { retries: 3, reasoningEffort: "low" });
}
```

A full config replaces the graph default. A params-only object patches the
current model, and `null` removes an inherited optional parameter:

```ts
getLlmConfig(): GraphLlmConfigOverride {
  return { params: { temperature: 0, maxOutputTokens: null } };
}
```

When a node uses a non-default model, the effective model metadata is persisted
into that node's state slice, and removed when it returns to the default — so the
document always tells you which model answered.

### Models and providers you add yourself

A model the built-in catalog does not list yet — a brand-new model from a
provider it already supports — is described in JSON:

```ts
const catalog = ModelCatalog.create({
  version: 1,
  profiles: {
    "openai-next": {
      provider: "openai",
      family: "chat",
      paramsSchema: { temperature: { type: "number" } },
      parameterMappings: { temperature: "temperature" },
    },
  },
  models: { "openai:gpt-next": { profile: "openai-next" } },
});
```

A catalog can neither replace a built-in model nor a built-in profile — it only
extends. A profile referencing a provider the runtime does not know needs an
adapter registered on a `ModelProviderRegistry` and passed to
`ModelCatalog.create(document, { providers })`; otherwise construction throws
`uses unregistered provider`.

The engine takes provider adapters directly. This is also how you supply
credentials or endpoints programmatically instead of via environment variables:

```ts
const providers = [
  ...ModelProvider.createBuiltinAdapters({ openai: { apiKey: secret } }),
  ModelProvider.createCustomAdapter({ provider: "acme", runtimeProvider: "openai" }),
];
const engine = await GraphEngine.create({ graphs: [MyGraph], providers });
```

Provider configuration is excluded from the model cache key, so credentials never
end up in a cache identifier.

### Token usage

Every model result carries `TokenUsage` — `input_tokens`, `output_tokens`,
`thinking_tokens`, `tool_input_tokens`, `cached_input_tokens`, `total_tokens` —
and outcomes fold it into `state.tokens`, which accumulates for the life of the
session in the document. No counters to wire.

### Cancellation and timeouts

`llmTimeoutMs` in the definition bounds one provider request. The caller's signal
arrives per turn:

```ts
await engine.run({ graphName, sessionId, userMessage, signal: request.signal });
```

The engine publishes it on the turn context; `llmCallOptions()` merges it with
the graph timeout for every model call, including calls you make directly through
`this.llmGateway`. Because the signal travels through `AsyncLocalStorage`, it
reaches shared node instances without being stored on them.

---

## 13. Persistence, concurrency, and schema versioning

### Stores

`memory` (tests and development), `sqlite` (single-node), `mongodb`, and
`cosmos`. All four implement `SessionDocumentContainer`, whose distinguishing
operation is `compareAndSwap(predicate, document)` — the primitive behind
concurrency control. Implement that interface to add your own store.

### Concurrency: fail fast, never merge

Two overlapping turns for the same session are a bug in the caller, not something
to reconcile. EZGraph therefore:

1. rejects a second turn already running in this process, and
2. takes an exclusive **lease** (`turn: { owner, expiresAt }`) with a
   compare-and-swap on `revision`, and
3. commits with the same compare-and-swap, so a stale writer cannot overwrite a
   newer document.

| Code | Status | Meaning |
| --- | --- | --- |
| `SESSION_BUSY` | 409 | Another turn holds the lease |
| `SESSION_CONFLICT` | 409 | The document changed under this turn |
| `SESSION_COMPLETED` | 409 | A finished JSON session cannot take another turn |

Leases expire (`SESSION_TURN_LEASE_MS`, default 60s), so a crashed process does
not wedge a session forever. There is no retry, no merge, and no "last write
wins" — the caller retries or surfaces the conflict.

### Status codes

| Status | When |
| --- | --- |
| 200 | Turn ran; chat envelope or the graph's JSON object |
| 400 | Unknown graph, missing user message, invalid session ID, or an error during the turn |
| 409 | `SESSION_BUSY`, `SESSION_CONFLICT`, `SESSION_COMPLETED` |

### Schema versioning

`schemaVersion` is *your* state schema, distinct from the framework's
`SESSION_DOCUMENT_VERSION`. Bump it and add a migration whenever a persisted
shape changes. On restore, the framework refuses a document from the future,
applies contiguous migrations, verifies the graph ID did not change, persists the
migrated document under the current lease, and only then runs your policy hook.

A session also belongs to exactly one graph for its whole lifetime. Pointing a
second graph at the same session ID is an error, not a merge.

### Observability

- `SessionLogWarning(tree)` / `SessionLogError(tree)` from anywhere inside a turn.
  Entries are timestamped and persisted on the document.
- `state.tokens` accumulates usage across the session.
- Each node's `model` metadata records the model that actually answered.
- `engine.getSession(id)` returns the raw document.

The framework itself records warnings for rejected tool arguments and empty model
responses, so those failure modes are diagnosable after the fact without your
adding a single log line.

---

## 14. Behaviors that exist to make your life easier

This section is the "why is this framework worth it" list. Everything here is
automatic.

### Correctness by construction

| Behavior | What it prevents |
| --- | --- |
| Outcomes set every related field together | Half-updated turns: a response with no history, a transition with stale `currentNode`, tokens that silently vanish |
| Builder methods are non-enumerable | Fluent helpers leaking into persisted state |
| `stay()`/`finish()` require non-empty text | Shipping an empty assistant message to a user |
| Typed local state per node | Two nodes fighting over the same state key |
| `undefined` as a deletion marker in `nodes` | Zombie keys that survive every "clear" |
| Nodes frozen after construction | Per-turn data on a shared instance leaking across sessions |
| Session logs and cancellation via `AsyncLocalStorage` | Cross-session log bleed under concurrency |

### Validated up front, not mid-conversation

These are all configuration errors that throw before any conversation logic runs:

| Checked at graph **construction** | Checked when the graph is **built** |
| --- | --- |
| Unknown model, illegal model parameters | Duplicate tool definition across nodes |
| Invalid `maxAgentRounds`, `llmTimeoutMs`, `retries` | Duplicate tool handler on one node |
| Invalid `schemaVersion` | Handled-but-undefined tool |
| Non-contiguous or duplicate migrations | Duplicate node registration |
| Invalid graph ID | Unregistered edge or branch endpoint |
| | Reserved terminal state in `registerTurns()` |
| | Duplicate `branchBy()` cases |

**Know where the boundary is.** `buildGraph()` is lazy: it runs the first time
anything reads the graph's `graph` property, and `GraphEngine.registerGraph()`
does not read it. So a topology or tool error in the right-hand column surfaces
as a `400` on the **first turn**, not at boot:

```json
{ "success": false, "completed": false,
  "message": "Tool 'dup' is defined by both 'ANode' and 'BNode'." }
```

Force those checks at startup by touching the property once after registration:

```ts
const engine = await GraphEngine.create({ graphs: [WeatherGraph] });
// Fail fast on topology and tool wiring instead of on a user's first message.
void new WeatherGraph(gateway).graph;
```

A cleaner eager-validation entry point is a known gap, tracked in the
[design analysis](/ezgraph/docs/langgraph-pain-points/).

### Resilience against real model behavior

| Situation | What EZGraph does |
| --- | --- |
| Malformed JSON tool arguments | Returns `{ accepted: false, error }` to the model, logs a warning, keeps the loop going |
| Arguments that fail your Zod schema | Same, with the exact per-field messages |
| Multi-tool batch | Executes all calls, appends all tool messages, then honors a stop |
| Tool throws | Releases pending attachments, then rethrows |
| Empty response, retryable reason | Nudges and retries (default: twice) |
| Empty response, blocked or truncated | Stops nudging, hands you `onEmptyModelResponse` with the classified reason |
| Provider that rejects a system-only request | Seeds a new history space with `"Start"` (configurable, disable with `null`) |
| Runaway model↔tool loop | Fails at `maxAgentRounds` instead of burning tokens forever |
| Caller disconnects | The turn's `AbortSignal` cancels in-flight provider calls |
| Slow provider | `llmTimeoutMs` bounds each request |
| Provider attachments | Cleaned up after the model has seen them, including on stop and error paths |
| Malformed JSON-mode output | Validated before commit; `onInvalidJsonResponse` decides the policy |
| Replay of a finished session | Clean `200` message for chat, `409 SESSION_COMPLETED` for JSON — never a corrupted document |

### Boilerplate you never write

Message array plumbing, tool-call/tool-message pairing, tool argument parsing,
session load/save, optimistic-concurrency retries, state reducers, resume
dispatch from a persisted node, token counters, per-node model bookkeeping,
provider client construction and caching, and a mock gateway for tests.

---

## 15. Testing

`ezgraph/testing` is a separate entry point, so nothing in it ships in your
runtime path.

### `scriptedGateway()` — a model you can dictate

```ts
import { scriptedGateway } from "ezgraph/testing";

const gateway = scriptedGateway()
  .callsTool("capture_city", { city: "Portland" })
  .text("It is 72 degrees in Portland.");
```

| Method | Queues |
| --- | --- |
| `text(s)` | A plain assistant turn |
| `callsTool(name, args?, id?)` | An assistant turn with one tool call |
| `callsTools([{ name, args }, …])` | A multi-tool batch |
| `structuredResult(obj)` | A `structured()` result |
| `toolDecision(call \| undefined)` | A `toolCall()` decision, including "no tool" |
| `empty(finishReason?)` | An empty turn with provider metadata, for testing safety blocks and token caps |
| `fail(error)` | A provider failure |
| `repeat(n, fn)` | The same turn several times |

Inspect what the graph actually asked for via `gateway.calls` — method, system
prompt, history, tool names in publication order, model config, and call options.
`drained` and `remaining` catch over- and under-scripted tests.

### `createTurnHarness()` — real turns, in memory

```ts
import { createTurnHarness, scriptedGateway } from "ezgraph/testing";

const harness = createTurnHarness<WeatherGraphStateType>({
  graph: WeatherGraph,
  gateway: scriptedGateway()
    .text("Which city would you like the weather for?")
    .callsTool("capture_city", { city: "Portland" })
    .text("It is 72 degrees in Portland."),
});

const first = await harness.send("hi");
assert.equal(first.currentNode, "CollectNode");
assert.equal(first.completed, false);

const second = await harness.send("Portland");
assert.equal(second.state?.nodes.ReportNode?.city, "Portland");
assert.equal(second.completed, true);
assert.deepEqual(second.warnings, []);

await harness.close();
```

Queue the turns in the order the graph will consume them. The three queued turns
above are: `CollectNode`'s first answer, its tool call on turn 2, and
`ReportNode`'s report in that same invocation.

The harness drives real `GraphEngine.run()` calls against an in-memory store, so
a test exercises the whole path — lease, restore, invoke, persist — rather than
calling `graph.graph.invoke()` and skipping persistence. Each turn returns
`status`, `response`, `completed`, `code`, `body`, the persisted `document`, the
hydrated `state`, `currentNode`, `warnings`, and `errors`. Repeated `send()` calls
reuse one session, so multi-turn conversations accumulate exactly as in
production.

---

## 16. For developers coming from LangGraph

If you know LangGraph, the fastest framing is: **EZGraph is an opinionated
application layer that keeps LangGraph's execution model and replaces everything
around it.** Your graph still compiles to a real `StateGraph`. What changes is
who owns state, persistence, routing, and the agent loop.

### 16.1 Concept mapping

| LangGraph | EZGraph | Note |
| --- | --- | --- |
| `StateGraph` | `StateGraphExt` via `this.createStateGraph(State)` | Narrow facade; the `StateGraph` is private |
| `Annotation.Root({...})` with hand-written reducers | `createGraphStateAnnotation(startNode, () => nodes)` | Shape and reducers are fixed |
| `addNode("name", fn)` | `graph.addNode(NodeClass)` / `graph.nodes(...)` | Classes only, never functions |
| `addEdge("a", "b")` | `graph.addEdge(ANode, BNode)` | Class endpoints, validated |
| `addConditionalEdges(src, fn, map)` | `graph.branch(Node, map)` with `route()`, or `graph.branchBy(Node, { cases, otherwise })`, or `graph.configAutoRoute()` | Three levels, low to high |
| Checkpointer + `thread_id` | Session document + `sessionId` | No checkpointers at all |
| `interrupt()` / `Command` resume | `stay()` + persisted `currentNode` | An interrupt is a stored string |
| `ToolNode` / prebuilt agent | `ConversationRunner` inside `runConversation()` | Not a node in your topology |
| `bind_tools` | `defineTool()` + `@Tool` | Publication and consumption split |
| `config.configurable` | `state.config`, merged per turn | Persisted with the session |
| `END` | Your `endNode` (usually `GRAPH_END_NODE`) mapped to `END` | Terminal state is persisted and application-visible |
| Streaming / `astream_events` | Not available | Turns are request/response today |

### 16.2 What EZGraph removes

**Checkpointers.** LangGraph persists framework snapshots keyed by thread; EZGraph
persists one application document per session, with your schema version, your
migrations, and your expiry policy. It is a row you can read, index, and reason
about — and one that survives a framework upgrade because it is not a framework
snapshot.

**Hand-written reducers.** The state shape is fixed and each field's reducer is
supplied. You choose the starting node and the type of your `nodes` slice.

**Routing tables for conversational flow.** In LangGraph, "the user answered, so
move to the next stage" is a conditional edge plus a state field plus a
convention. In EZGraph it is `advance(NextNode, conversation)` and
`configAutoRoute()`.

**Interrupt/resume machinery.** There is no suspended execution to resume.
`stay()` persists `currentNode` and the turn ends; the next request enters that
node via the `START` branch that `registerTurns()` installed.

**Hand-rolled agent loops.** The model↔tool loop, multi-tool batches, tool
message pairing, attachment cleanup, and round caps are all in one place.

**Mock-everything test setup.** `ezgraph/testing` provides a scripted gateway and
a real-turn harness.

### 16.3 What EZGraph adds

- **A request boundary** with HTTP-shaped results, concurrency control, and
  cancellation.
- **Semantic outcomes** that set every related state field consistently.
- **Typed per-node local state**, so nodes cannot collide on state keys.
- **History spaces**, so stages can share or isolate context declaratively.
- **A validated model catalog** with family-aware parameter typing, capability
  requirements, per-node overrides, and persisted effective-model metadata.
- **Classified empty-response handling** (`blocked` vs `truncated` vs
  `unspecified`) with a node-level recovery hook.
- **Tool-argument recovery** that turns malformed model output into a corrective
  tool result instead of an exception.
- **Startup validation** of tools, topology, models, and migrations.
- **Node isolation enforcement**: shared node instances are frozen, and per-turn
  data travels via `AsyncLocalStorage`.

### 16.4 What EZGraph forbids, and why

| Forbidden | Why |
| --- | --- |
| Adding a node as a function | The framework must construct the instance to register its tools and verify its durable ID |
| Reaching the underlying `StateGraph` | Raw calls would bypass node registration, tool validation, and endpoint checks |
| Edges to nodes that were not added | Turns a routing typo into a `compile()` error |
| Two nodes defining the same tool name | Tool ownership must be unambiguous |
| Mutating a node instance at turn time | Nodes are shared singletons; the freeze converts a cross-session leak into an immediate throw |
| Two concurrent turns per session | Interleaved conversation state has no correct merge |
| A session switching graphs | The document's schema belongs to one graph |
| Non-JSON output from a `json` graph | The transport contract is validated before commit |

### 16.5 Side by side

A two-stage conversation that waits for user input between stages.

**LangGraph, roughly:**

```ts
const graph = new StateGraph(MyState)
  .addNode("collect", async (state) => {
    const model = llm.bindTools([captureCity]);
    const messages = [new SystemMessage(COLLECT_PROMPT), ...state.messages];
    let response = await model.invoke(messages);
    while (response.tool_calls?.length) {
      messages.push(response);
      for (const call of response.tool_calls) {
        const result = await runTool(call);           // you parse args here
        messages.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id }));
      }
      response = await model.invoke(messages);        // you bound the loop yourself
    }
    return { messages: [response], stage: state.city ? "report" : "collect" };
  })
  .addNode("report", reportNode)
  .addConditionalEdges("collect", (s) => (s.stage === "report" ? "report" : END), {
    report: "report",
    [END]: END,
  })
  .addEdge(START, "collect")
  .compile({ checkpointer });

await graph.invoke({ messages: [new HumanMessage(text)] }, { configurable: { thread_id: id } });
```

You also own: where `stage` lives and how it is reduced, how the next request
re-enters `collect` vs `report`, argument validation, the loop bound, token
accounting, and what happens when the model returns an empty candidate.

**EZGraph:**

```ts
class CollectNode extends ConversationNode<MyState, { city?: string }, { city?: string }> {
  getPrompt() { return COLLECT_PROMPT; }

  defineTool(): readonly ToolDefinition<{ city: string }>[] {
    return [{ name: "capture_city", description: "…", schema: z.object({ city: z.string() }) }];
  }

  @Tool("capture_city")
  captureCity({ city }: { city: string }) {
    return this.toolResult({ accepted: true }).withContext({ city }).haltAfterBatch();
  }

  protected createContext(state: MyState) {
    const saved = this.state(state).city;
    return saved === undefined ? {} : { city: saved };
  }

  protected nextStep(_state: MyState, context: { city?: string }, conversation: ConversationNodeRunResult) {
    if (conversation.quitRequested) return this.quit(conversation);
    if (context.city) return this.advance(ReportNode, conversation).withState({ city: context.city });
    return this.stay(conversation);
  }
}

// in buildGraph()
graph.registerTurnNodes(CollectNode, ReportNode, TerminateSessionNode);
graph.configAutoRoute();
graph.addEdge(TerminateSessionNode, END);
```

The loop, argument validation, history plumbing, resume dispatch, token
accounting, and persistence are gone from your code — not hidden behind a
convention, but owned by the framework.

### 16.6 Migration recipe

1. **Map your state.** Turn per-stage fields into typed `nodes` slices; keep
   caller-supplied values in `config`. Move `messages` into one or more history
   spaces.
2. **Turn each node function into a class.** Prompt → `getPrompt()`, bound tools →
   `defineTool()` + `@Tool`, the model↔tool loop → delete it.
3. **Replace stage flags with outcomes.** A stage flag plus conditional edge
   becomes `stay()` / `advance()` / `finish()`, and `configAutoRoute()`.
4. **Declare user-turn entries.** `registerTurns(...)` replaces your
   resume-from-checkpoint logic.
5. **Keep genuinely internal edges.** Worker pipelines, fan-out, and joins stay
   `addEdge(...)`; they make no conversational decision.
6. **Replace the checkpointer.** Pick a `SESSION_STORE` and write
   `onRestoreSessionDoc()` for expiry.
7. **Move the model into the definition.** `llmConfig` for the graph,
   `getLlmConfig()` per node.
8. **Rewrite tests** against `createTurnHarness()` and `scriptedGateway()`.

### 16.7 What you give up

Be deliberate about these:

- **No streaming.** Turns are request/response. If you need token streaming
  today, EZGraph is not it.
- **No arbitrary node functions.** Everything is a class, added through the
  facade.
- **No direct `StateGraph` access.** Exotic LangGraph features are reachable only
  if the facade exposes them. There is no sanctioned `wrapLangGraph()` adapter
  yet.
- **No cross-session merge.** Concurrent turns fail fast by design.
- **Fixed state shape.** You extend `nodes` and `config`, not the top-level
  fields.
- **Not yet built:** history compaction / context budgets, per-session token or
  cost budgets, and OpenTelemetry spans.

---

## 17. Pitfalls

**Storing turn data on the node.** Node instances are created once, shared by
every session, and frozen. This throws:

```ts
class BadNode extends ConversationNode<MyState> {
  private city?: string;                      // shared across all sessions
  protected createContext(state: MyState) {
    this.city = this.state(state).city;       // TypeError: object is not extensible
    return {};
  }
}
```

Put per-turn data in the tool context, and per-session data in local state via
`withState()`. Genuinely session-independent memoization can use a `#private`
field, which freezing does not cover.

**Forgetting `TerminateSessionNode`.** Any `ConversationNode` subclass handles
`terminate_session`, so some node must define it. Register
`TerminateSessionNode` or `compile()` throws.

**Checking domain success before `quitRequested`.** A model can call a domain tool
and `terminate_session` in the same batch. Check the quit flag first.

**Assuming `advance()` waits for the user.** `advance()` routes into the target
*in the same invocation*. Use `stay()` to end the turn, or `resumeAt()` to set
the next user-turn entry without routing there now.

**Overriding `onEmptyModelResponse` with a narrow return type.** The base
signature is `string | Promise<string>`. A `string`-only override fails to
typecheck.

**Renaming a node or graph class.** The class name is the durable, persisted ID.
Renaming orphans live sessions unless you override `static id()` to return the
old string.

**Expecting a framework `expireAfter`.** There isn't one. Implement
`onRestoreSessionDoc()` and use `idleMs()`.

**Missing `reflect-metadata`.** Without it, `@Tool` metadata is not collected and
nodes appear to have no tools.

**`maxAgentRounds` misread as a turn limit.** It bounds one node invocation's
model↔tool loop. Raise it for nodes that legitimately chain several tools.

---

## 18. Export index

Everything below is exported from `ezgraph`, except the last group, which is
`ezgraph/testing`.

**Graphs** — `BaseGraph`, `GraphDefinition`, `GraphNodeConstructor`,
`GraphSchemaMigration`, `HistorySpace`

**Nodes and tools** — `GraphNode`, `ConversationNode`, `TerminateSessionNode`,
`GraphNodeRuntime`, `Tool`, `GRAPH_NODE_CLASS`, `ToolDefinition`, `ToolInput`,
`GraphNodeUpdate`, `GraphNodeLocalState`, `GraphNodeTarget`, `NodeOutcomeBuilder`,
`OutcomeRouteTarget`, `ConversationNodeRunResult`, `InvalidJsonResponseContext`,
`EmptyModelResponseContext`

**State** — `GraphState`, `createGraphStateAnnotation`, `GRAPH_END_NODE`,
`GraphStateSupport`, `mergeNodeStates`, `GraphNodeStates`, `NodeStateValue`

**Topology** — `StateGraphExt`, `GraphEndpoint`, `GraphNodeClass`,
`GraphNodeFactory`, `RegisteredNode`, `CurrentNodeSelector`,
`CurrentNodeBranchOptions`

**Engine** — `GraphEngine`, `GraphEngineOptions`, `GraphEngineCreateOptions`,
`GraphConstructor`, `RunResult`, `GraphRegistry`, `RegisteredGraph`,
`ConfigManager`, `ConfigManagerOptions`

**Agent loop** — `ConversationRunner`, `ConversationPolicy`,
`ConversationRunResult`, `ConversationToolResult`,
`ConversationToolResultBuilder`, `EmptyResponseRecovery`,
`EmptyModelResponseError`, `DEFAULT_CONVERSATION_POLICY`,
`DEFAULT_EMPTY_HISTORY_SEED`, `DEFAULT_EMPTY_RESPONSE_RECOVERY`,
`DEFAULT_MAX_AGENT_ROUNDS`, `assertMaxAgentRounds`, `assertEmptyResponseRetries`

**Models** — `ModelCatalog`, `GraphLlm`, `ModelProvider`, `ModelProviderRegistry`,
`BUILT_IN_MODEL_CATALOG`, `GRAPH_LLM_PROVIDERS`, `GRAPH_LLM_FAMILIES`,
`GRAPH_LLM_CAPABILITIES`, `GraphLlmConfig`, `GraphLlmConfigOverride`,
`GraphLlmParameters`, `GraphLlmCapability`, `GraphLlmFamily`, `GraphLlmProvider`,
`GraphLlmRequiredCapabilities`, `GraphLlmModelMetadata`, `BuiltInModelId`,
`BuiltInGraphLlmConfig`, `BuiltInModelParameters`, `CommonModelParameters`,
`RuntimeGraphLlmConfig`, `ModelCatalogDocument`, `ModelParameterProfile`,
`ModelProviderAdapter`, `ModelProviderInitialization`,
`ModelProviderRuntimeConfig`, `RegisteredModelProviderAdapter`,
`BuiltInModelProviderConfigs`, `CustomModelProviderOptions`,
`LangChainLlmGateway`, `LangChainLlmGatewayOptions`,
`langChainModelInitialization`, `LangChainModelInitialization`

**Gateway** — `LlmGateway`, `LlmGatewayFactory`, `LlmGatewayTool`,
`LlmGatewayToolCall`, `LlmCallOptions`, `LLM_GATEWAY_FACTORY`,
`assertLlmTimeoutMs`, `ProviderFileManager`, `LlmFile`

**Stop reasons** — `modelStopReason`, `isRetryableStopReason`,
`describeStopReason`, `ModelStopCategory`, `ModelStopReason`

**Turn scope and logs** — `withTurnContext`, `currentTurnContext`,
`currentTurnSignal`, `TurnContext`, `SessionLogWarning`, `SessionLogError`,
`createSessionLogs`, `withSessionLogs`, `SessionLogEntry`, `SessionLogs`

**Persistence** — `SessionManager`, `SessionDocument`, `SessionDocumentContainer`,
`SessionGraphDocument`, `SessionGraphMetadata`, `SessionGraphStatus`,
`SessionTurnError`, `SessionTurnLease`, `SessionTurnCode`, `SessionWritePredicate`,
`SessionWriteResult`, `SessionWriteOptions`, `BeginTurnResult`, `SESSION_BUSY`,
`SESSION_CONFLICT`, `SESSION_COMPLETED`, `SESSION_DOCUMENT_VERSION`,
`sessionTurnLeaseMs`, `sessionRevision`, `isLiveSessionTurn`,
`matchesSessionWritePredicate`, `MemorySessionDocumentContainer`,
`SqliteSessionDocumentContainer`, `MongoDbSessionDocumentContainer`,
`CosmosSessionDocumentContainer`

**Token usage** — `TokenUsage`, `ModelResult`, `ModelExecution`, `modelExecution`,
`addTokenUsage`, `emptyTokenUsage`, `normalizeTokenUsage`, `tokenUsageFromMessage`

**`ezgraph/testing`** — `scriptedGateway`, `ScriptedGateway`, `ScriptedCall`,
`SCRIPTED_MODEL`, `SCRIPTED_TOKEN_USAGE`, `createTurnHarness`, `TurnHarness`,
`HarnessTurn`

---

## Related documents

- [`conversation-node-outcomes.md`](/ezgraph/docs/developer-guide/) — outcomes,
  typed tool effects, and routing in depth
- [`ezgraph-vs-langgraph-analysis.md`](/ezgraph/docs/langgraph-pain-points/) — the
  design audit behind these decisions, including known gaps
