---
layout: layouts/ezgraph.njk
title: LangGraph pain points and the EZGraph application layer
description: A detailed analysis of guided conversational applications on direct LangGraph and how EZGraph addresses the repeated application plumbing.
permalink: /ezgraph/docs/langgraph-pain-points/
ezgraph: true
ezgraphDocument: true
---
# Guided conversational chatbots on LangGraph: developer pain points, and how EZGraph answers them

EZGraph's mission is narrow and stated plainly: **make building a guided
conversational chatbot as simple as possible — modular stages, one clear
contract every team learns once, and far less boilerplate.** This document tests
that claim. It collects the pain points developers actually report when they
build guided conversations on raw LangGraph, then measures both approaches
against each other using two implementations of the *same* product that live in
this project's demo repository
([ezgraph-demo](https://github.com/picoflowio/ezgraph-demo)):

- `quote-graph` — the Sequoia Auto Insurance quoting chatbot on EZGraph.
- `quote-langgraph` — the same chatbot, same prompts, same rating engine, same
  HTTP contract, written directly against LangGraph with no EZGraph import.

Because the two share a byte-identical domain backend, the difference between
them is exactly the cost of the framework layer — which is the thing worth
measuring.

**Headline result: 40.9% less framework-facing code** (758 vs 1,283 normalized
executable lines) for identical behavior, with the reduction concentrated in
persistence, the request boundary, tool dispatch, and the agent loop — not in the
business logic, which is unchanged.

---

## Table of contents

1. [Method and scope](#1-method-and-scope)
2. [What a guided conversation actually demands](#2-what-a-guided-conversation-actually-demands)
3. [The pain points](#3-the-pain-points)
4. [quote-graph vs quote-langgraph, measured](#4-quote-graph-vs-quote-langgraph-measured)
5. [What EZGraph does not fix](#5-what-ezgraph-does-not-fix)
6. [Choosing between them](#6-choosing-between-them)
7. [Reproducing the measurements](#7-reproducing-the-measurements)
8. [References](#8-references)

---

## 1. Method and scope

### The two implementations

Both live in [ezgraph-demo](https://github.com/picoflowio/ezgraph-demo) under `src/graphs/`:

| | `quote-graph` (EZGraph) | `quote-langgraph` (raw LangGraph) |
| --- | --- | --- |
| Stages | 5 (driver, vehicle, history, coverage, quote) | 5 (identical) |
| Domain tools | 8 | 8 (identical names and schemas) |
| History channels | 3 (`quote-intake`, `quote-incidents`, `quote-present`) | 3 (`intakeMessages`, `incidentsMessages`, `presentMessages`) |
| Session stores | memory, sqlite, mongodb, cosmos | memory, sqlite, mongodb |
| Idle expiry | 30 min, configurable | 30 min, configurable |
| Model policy | `gpt-4o-mini` collecting, `gpt-5.1` presenting | identical |
| HTTP surface | `POST /ai/run`, `/ai/end`, `GET /ai/graphs` | `POST /ai-langgraph/run`, `/end`, `/graphs` |

The prompts (`prompt/*.md`, `prompt/quote-prompt.ts`), the rating engine, the
vehicle catalog, the clock helpers, and the vehicle data file are the same in
both. Measured independently, each side's domain backend normalizes to **310
lines** — identical, which confirms the comparison isolates framework cost.

### The metric

Raw line counts flatter whichever side has denser formatting, so the primary
metric is **normalized executable lines**: source lines after removing blank
lines, comment-only lines, and `import` statements (including multi-line import
blocks). Section 7 has the script.

Three scopes are reported:

- **Framework-facing graph code** — the graph, state, nodes, routing,
  persistence, and request boundary. This is the headline scope.
- **Shared domain backend** — excluded from the headline because it is identical.
- **Controllers** — reported separately, since both are thin NestJS adapters.

### Honesty notes

Three things are deliberately *not* claimed:

1. **Test-suite size is not compared.** The two suites are not scoped alike —
   the EZGraph spec also unit-tests the rating engine, and its end-to-end spec
   covers more paths. Counting them would misrepresent the framework in either
   direction. The qualitative difference is described in
   [§3.9](#39-testing-requires-faking-a-model-protocol) instead.
2. **Tool *declaration* is a wash.** EZGraph's `defineTool()` bodies total 122
   lines against LangGraph's 60 lines of bare Zod schemas plus 51 lines of
   `tool()` wrappers plus 12 lines of per-stage registration — 122 vs 123. The
   saving is in *handling* tools, not declaring them.
3. **EZGraph adds code in one place.** Its `nextStep()` methods total 100 lines,
   where LangGraph spends 68 on topology and router functions plus scattered
   `route:` writes. EZGraph makes transitions more explicit, not shorter. That
   is a deliberate trade and it is counted against the headline number.

---

## 2. What a guided conversation actually demands

A guided conversational chatbot — insurance quoting, loan intake, expense
submission, patient triage — is not an autonomous agent loop. It has a shape:

- **Ordered stages with gates.** The model may not price a policy before the
  vehicle is resolved. Skipping a stage is a defect, not creativity.
- **Slot filling with real validation.** "Date of birth" must be a calendar date,
  in the past, consistent with `yearsLicensed`. A rejection has to become a
  follow-up question, not a stack trace.
- **Long waits between turns.** The user answers in 4 seconds or 4 days, from a
  different process, behind a load balancer.
- **Backward moves.** "Actually, raise my deductible" sends the conversation from
  the quote stage back to coverage, carrying the current message with it.
- **Context isolation.** The stage that presents prices should not inherit the
  chit-chat from identity collection.
- **An auditable record.** Someone in operations will be asked what this customer
  was quoted, when, and by which model.
- **Ordinary web semantics.** One HTTP request in, one response out, with a
  sensible status code when two requests race.

LangGraph can express every one of these. The reported pain is not that it
*can't* — it is that each one is left to the application, so every team builds
its own version, and the versions disagree.

---

## 3. The pain points

Each subsection states the symptom, cites outside evidence, shows what it costs
in `quote-langgraph`, and shows what EZGraph does instead.

### 3.1 `StateGraph` is a runtime, not an application framework

**Symptom.** LangGraph is explicitly positioned as a low-level orchestration
library. That is a virtue for control and a tax for products: you own the state
schema, the reducers, the recursion limit, and every edge before you write a line
of domain logic.

**Evidence.** The LangGraph team opened a v1 feedback issue asking directly
"what feels unnecessarily complex or boilerplate-heavy?" and received hundreds of
replies ([langgraph#4973]). Independent 2026 reviews list "more boilerplate" and
"steep learning curve" as the framework's headline costs, and practitioner
guidance now converges on "start with `create_agent`, drop to `StateGraph` only
when forced" precisely because hand-wiring a graph on day one is expensive
([pikvue], [markaicode], [uvik]). One delivery shop calls a premature hand-built
`StateGraph` "the most common and most expensive mistake" it sees ([uvik]).

The catch for guided conversations: `create_agent` is a single ReAct-style loop.
A five-stage gated intake with per-stage tool sets and isolated histories is
exactly the topology it cannot express — so guided-conversation teams are pushed
to the low-level API, where the boilerplate lives.

**Cost in `quote-langgraph`.** 1,283 normalized lines, of which roughly 700 are
framework plumbing — state channels, persistence, request boundary, tool
dispatch, agent loop, topology — rather than insurance logic.

**What EZGraph does.** Keeps LangGraph as the execution engine and supplies the
application layer above it. `BaseGraph` + `ConversationNode` + `GraphEngine`
provide the request boundary, agent loop, persistence, and routing, so a stage is
a class with a prompt, tools, and a decision. Guide: §1, §6.

### 3.2 The state schema and its reducers are yours to design, and to get wrong

**Symptom.** Every channel needs a reducer and a default. Get one wrong and you
get a silent overwrite or a list that grows forever, and the failure surfaces
turns later.

**Evidence.** A practitioner account titled "state as API after three rewrites"
concludes that the design that finally worked was annotated fields with explicit
reducers — after two designs that used a shared mutable object and lost data to
silent overwrites ([mazza]). LangGraph's own state guide lists "always use
reducers for list/dict accumulation," "test reducer logic independently," and
"consider order-independence" as things the developer must remember ([lg-state]).

**Cost in `quote-langgraph`.** `quote-langgraph.state.ts` is **83 normalized
lines** declaring 17 channels, each with a hand-written `reducer` and `default`,
including two hand-rolled helpers (`replace`, `appendMessages`) and two string
unions (`QuoteLanggraphPhase`, `QuoteLanggraphRoute`) that must stay in sync with
the topology by convention alone.

**What EZGraph does.** Fixes the state shape and supplies every reducer.
`createGraphStateAnnotation(startNode, () => nodes)` takes the starting node and
the type of your per-node slice; histories merge per space, `nodes` deep-merges
with `undefined` as a deletion marker, `tokens` accumulates, scalars replace. The
equivalent declaration is **19 normalized lines — 77% less** — and declares zero
reducers. Per-node slices are typed, so two stages cannot collide on a key.
Guide: §8, §14.

### 3.3 "Wait for the user" is the hardest thing to express

**Symptom.** The core move of a guided conversation — ask, stop, resume next
request — has no first-class representation. `interrupt()` suspends execution and
`Command(resume=...)` resumes it, but the node **re-runs from the beginning** on
resume, which makes the natural "loop until the answer validates" pattern quietly
wrong.

**Evidence.** LangGraph's own interrupt documentation carries an explicit
warning: avoid `while True` + `interrupt()` inside a node, because each resume
replays every previous iteration, producing "exponential re-execution of any code
inside the loop body." The recommended pattern is to call `interrupt()` once per
node invocation, store the error in state, and use a conditional edge to loop
back ([lg-interrupts]) — i.e. rebuild a state machine around the primitive. In
the v1 feedback issue, developers report ambiguity over whether to use `Command`
or a state update, call the interrupt ergonomics "inefficient," and one asks for
the pattern to be deprecated outright in favor of tool-result-driven flows
([langgraph#4973]). Others describe resorting to re-invoking the graph with a
synthetic `{"interrupt": True}` flag to skip an already-run node — a workaround
its author calls "neither elegant nor standard."

**Cost in `quote-langgraph`.** It does not use `interrupt()` at all. It
reimplements waiting: a `phase` field in state, a `route` field written 16 times
across the tool nodes, a `routeFromPhase` function branching from `START`, and an
`inputConsumed` flag so a forwarded message is not double-counted. Waiting for
the user is spread across four constructs.

**What EZGraph does.** A wait is a persisted string. `stay()` ends the turn and
leaves `currentNode` pointing at this stage; the next request enters that stage
directly through the `START` branch `registerTurns()` installed. There is no
suspended coroutine to resume and nothing re-executes. `advance(Target)` moves on
in the same invocation, `resumeAt(Target)` sets the next entry point without
routing there now, and `forwardInput()` carries the current message into the
target's history when a stage hands off mid-sentence. Guide: §2, §11.

### 3.4 Checkpointers are framework snapshots, not application records

**Symptom.** A checkpointer persists internal graph state keyed by thread. What
an operations team needs is one readable row per conversation, versioned by the
application's own schema, migratable by the application's own code, and expirable
by the application's own policy. Those are not the same artifact.

**Evidence.** This is the most consistently reported production wound.
A postmortem describes adding one field to a state `TypedDict` and having "half
your running threads fail to deserialize on resume," with checkpoint tables
reaching 40 GB in six weeks with no retention policy, and concludes that
"checkpoint schema changes require explicit migration — LangGraph won't handle it
for you, and old threads will silently break" ([towardsai]). Another team lost
roughly 200 agent runs (~$1,200 in API spend) over three weeks to exactly this
failure — successful writes, failed reads, because `PostgresSaver`'s `jsonb`
column enforces no schema ([dev-to]). The standard remedy in every write-up is to
hand-roll what a framework could own: put a `schema_version` field in state,
check it on resume, and run a migration ([altersquare], [towardsai]).
LangChain's own knowledge base documents checkpoint bloat, `DocumentTooLarge`
errors on MongoDB, and the absence of automatic cleanup ([lc-kb]).

In the v1 feedback issue, developers also object to the *coupling*: human-in-the-
loop "requires a database like PostgreSQL to be mandatory," and several ask for
the OpenAI Agents SDK model — hand the state back and let the application decide
where it lives ([langgraph#4973]).

**Cost in `quote-langgraph`.** It declines checkpointers and writes its own
persistence: **177 normalized lines** of `quote-session-store.ts` (a store
interface plus memory, SQLite, and Mongo implementations, plus
`serializeQuoteState`/`hydrateQuoteState` to convert `BaseMessage` arrays through
`StoredMessage`), and **199 normalized lines** of request-boundary code in the
graph class (`run`, `loadSession`, `hasSession`, `getSessionState`,
`deleteSession`, `close`, `validateSessionId`, `sessionIdleMs`, `successResult`,
plus the result/input types). That is 376 lines — 29% of the whole
implementation — before any insurance logic.

**What EZGraph does.** Persistence is a first-class, application-owned document:
one JSON row per session with `version`, `revision`, `status`, `tokens`,
`errors`, `warnings`, the per-node state, the histories, the active node, and the
effective model metadata. Four stores ship (`memory`, `sqlite`, `mongodb`,
`cosmos`) behind `SessionDocumentContainer`. The graph declares
`schemaVersion` and an ordered `migrations` array; the framework refuses a
future-dated document, applies contiguous migrations, verifies graph identity,
and persists the migration under the current lease *before* your policy hook
runs. Expiry is a business decision, so it is a hook rather than a setting.

`quote-graph`'s entire persistence and lifecycle code is this:

```ts
protected override async onRestoreSessionDoc(
  sessionDoc: SessionDocument<QuoteGraphStateType>,
): Promise<SessionDocument<QuoteGraphStateType> | null> {
  if (this.idleMs(sessionDoc) >= readMs("QUOTE_GRAPH_IDLE_MS", DEFAULT_IDLE_MS)) {
    return null;
  }
  return sessionDoc;
}
```

**12 normalized lines** (including the `readMs` helper) against 376. Guide: §6,
§9.1, §13.

### 3.5 Nothing stops two turns on the same conversation

**Symptom.** A user double-taps send. Two requests hit two pods. Both load the
same checkpoint and both write. LangGraph does not arbitrate this for you.

**Evidence.** A team on object storage found that "multiple invocations for the
same `thread_id` could happen almost simultaneously, especially if a user sent
rapid-fire messages," producing corrupted JSON that retries with backoff reduced
but never eliminated; the fix was to build ETag-based optimistic locking and a
`version_id` compare-and-swap by hand ([dev-to]). A LangChain forum thread
confirms that `PostgresSaver` and `AsyncPostgresSaver` serialize *all* checkpoint
I/O through one instance-level lock — a throughput bottleneck that is still not
a correctness guarantee for concurrent turns on one thread ([lc-forum]).
Practitioner analysis of parallel write-back describes silent lost-update
anomalies and, when strict collision detection is enabled,
`INVALID_CONCURRENT_GRAPH_UPDATE` with "aggressive retry-thrashing" ([azguards]).
There are open reports of cross-thread checkpoint contamination with a shared
agent instance under concurrency ([langgraphjs#2040]) and of duplicate execution
forking checkpoints from one request ([langgraph#6728]).

**Cost in `quote-langgraph`.** Unaddressed. `run()` reads the document, invokes,
and writes it back with no revision check, so two overlapping turns silently
lose one turn's work.

**What EZGraph does.** Treats overlap as a caller bug and fails fast rather than
merging. An in-process guard rejects a second turn for a session immediately;
beyond that, a turn takes an exclusive lease (`turn: { owner, expiresAt }`) via
compare-and-swap on `revision`, and commits with the same compare-and-swap, so a
stale writer cannot overwrite a newer document. Callers get `409 SESSION_BUSY`,
`409 SESSION_CONFLICT`, or `409 SESSION_COMPLETED`. Leases expire (default 60 s)
so a crashed pod cannot wedge a conversation. Zero application lines. Guide: §5,
§13.

### 3.6 The model-tool loop gets rewritten in every node

**Symptom.** Call the model with bound tools; if it returns tool calls, execute
*all* of them, append one `ToolMessage` per call, loop; bound the iterations.
Every stage needs it, so every stage grows a copy — and the copies drift.

**Evidence.** LangGraph's prebuilt `ToolNode` and `create_agent` cover the
single-loop case, but a gated multi-stage flow with per-stage tool sets does not
fit that shape, so teams hand-roll. The v1 feedback thread includes "debugging
deeply nested subgraphs is challenging — when a tool call fails three levels
deep, tracing the exact state at each transition requires significant logging
boilerplate," and practitioner guidance stresses adding a loop budget manually
because "without a budget, this loop can run forever" ([langgraph#4973],
[scorrea]).

**Cost in `quote-langgraph`.** The loop is expressed as topology: five `*Agent`
nodes paired with five `*Tools` nodes, ten `addNode` calls and eleven
`addConditionalEdges` calls, plus `callAgent`, `latestToolCall`, `toolResult`,
`invalidToolUpdate`, `terminateUpdate`, and `messageText` — **79 normalized
lines** of message plumbing, and a `recursionLimit: 50` standing in for a real
round cap. Note the design compromise `latestToolCall` forces: it returns
*one* tool call per pass, preferring `terminate_session`. The implementation
cannot honestly execute a multi-tool batch, and if a provider ever returns two
calls, the unanswered one is dropped — which providers reject.

**What EZGraph does.** `ConversationRunner` owns the loop once, and it is not a
node in your topology. It executes **every** call in a batch and appends **every**
`ToolMessage` before honoring a stop, because providers reject a conversation
with a dangling tool call. `maxAgentRounds` (default 8) bounds one node
invocation. Attachment cleanups are released after the model has seen them,
including on stop and throw paths. Application cost: 0 lines. Guide: §6, §10.

### 3.7 Bad tool arguments become exceptions instead of conversation

**Symptom.** The model sends malformed JSON, or arguments that fail your schema.
The correct product behavior is to tell the model what was wrong and let it
correct itself. The default behavior is to throw.

**Evidence.** LangGraph leaves tool-call validation to the application, and the
v1 feedback thread asks for better custom serialization and clearer guidance
around tool I/O contracts ([langgraph#4973]). Practitioner guidance is to keep
tools in dedicated nodes so that retries and policy can be enforced there
([scorrea]) — again, a pattern the application must build.

**Cost in `quote-langgraph`.** Measured exactly: **8 `try`/`catch` blocks** around
`Schema.parse(call.args)`, **14 tool-name dispatch checks**, and a locally
redefined `reject` closure in each of the five tool nodes, plus a shared
`zodError` formatter. Roughly **113 lines** of pure dispatch-and-validate
plumbing, and every new tool adds another copy of the same shape.

**What EZGraph does.** Publication and consumption are separate — `defineTool()`
declares the schema, `@Tool("name")` handles it — and the framework does the
dispatch. Arguments are parsed and Zod-validated before your handler runs, so
handlers receive typed input. When validation fails, the framework does not throw
and does not make a hidden extra model call: it returns
`{ accepted: false, error }` to the model as the tool result, records a session
warning, and continues the loop, so the model sees the exact per-field message
and corrects itself. A schema violation becomes a conversation.

Measured in `quote-graph`: **8 `@Tool` decorators** for 8 tools, and **zero**
manual `.parse(` calls. Guide: §10.

### 3.8 Conditional-edge tables grow faster than the flow

**Symptom.** Routing lives in three places that must agree: a state field, a
router function, and an edge map. Nothing checks that they do.

**Evidence.** Practitioner guidance boils down to "if a routing condition needs
more than reading a field and comparing a value, put it in a node" — because edge
functions that do real work are hard to test and hard to replay ([mazza]).
Tutorials warn that a router returning a string absent from the mapping raises
`KeyError` **at invoke time, not at `compile()` time**, so untested paths fail in
production ([neuralbase]). The v1 thread contains requests to stop hardcoding
node-name strings, with a developer showing a deliberately verbose
`self.node.__name__` workaround ([langgraph#4973]).

**Cost in `quote-langgraph`.** `buildGraph()` is 10 `addNode` calls and 11
`addConditionalEdges` calls; add `agentRoutes`, `routeFromPhase`, `afterAgent`,
and `routeAfterTools` and routing infrastructure is **68 normalized lines**. The
`route` value is a string union in a separate file, written 16 times across tool
handlers. Every node name appears as a string literal in at least three places.

**What EZGraph does.** Routing is a return value. A node ends with `stay()`,
`advance(Next)`, `quit()`, or `finish()`, and `configAutoRoute()` derives the
topology from that outcome metadata. Endpoints are **classes**, validated against
registered nodes at `compile()`, so a wiring typo is a build error rather than a
runtime `KeyError`. Explicit `branchBy()` and fixed `addEdge()` remain available
for genuinely internal pipelines. `quote-graph`'s entire topology:

```ts
protected buildGraph() {
  const graph = this.createStateGraph(QuoteGraphState);
  graph.registerTurnNodes(
    DriverNode, VehicleNode, HistoryNode, CoverageNode, QuoteNode,
    TerminateSessionNode,
  );
  graph.configAutoRoute();
  graph.addEdge(TerminateSessionNode, END);
  return graph.compile();
}
```

**14 normalized lines** against 68. The outcomes are also not merely routing
hints: `stay()` sets response text, `inputConsumed`, the history append, token
accounting, `currentNode`, and the route together, so a half-updated turn is not
representable. Guide: §11, §14.

### 3.9 Testing requires faking a model protocol

**Symptom.** To test a conversation you need a model that returns scripted tool
calls in the right order with the right `tool_call_id` wiring — and you have to
build it.

**Evidence.** The v1 feedback thread repeatedly asks for better local
development and debugging support, including easier step tracing in a debugger
and clearer state inspection ([langgraph#4973]).

**Cost in `quote-langgraph`.** `quote-langgraph-test-model.ts` is a **192-line**
hand-written stub that inspects message history, decides which tool to call, and
constructs `AIMessage` objects with tool-call payloads — a second implementation
of the provider protocol maintained alongside the first.

**What EZGraph ships.** `ezgraph/testing` is a separate entry point (nothing in
it reaches your runtime): `scriptedGateway()` queues turns declaratively
(`.text()`, `.callsTool()`, `.callsTools()`, `.empty(finishReason)`, `.fail()`)
and records what the graph actually asked for in `gateway.calls`, while
`createTurnHarness()` drives real `GraphEngine.run()` calls against an in-memory
store so a test exercises lease, restore, invoke, and persist rather than calling
`graph.invoke()` and skipping persistence.

Two caveats, stated plainly: the demo's own `quote-graph.spec.ts` predates these
helpers and hand-rolls a gateway, and the two suites differ in scope, so no line
comparison is offered here. The framework capability is real; the demo has not
adopted it yet. Guide: §15.

### 3.10 Real model misbehavior is the application's problem

**Symptom.** Providers return turns with neither text nor a tool call —
safety-blocked, recitation-blocked, truncated at the token cap, or the model
simply chose to say nothing. Some are worth retrying and some never are, and the
right customer-facing answer differs.

**Evidence.** Not a LangGraph defect so much as a gap it leaves open: neither the
graph API nor the checkpointer classifies provider stop reasons, so each
application invents its own handling — one more place where two teams in the same
company will disagree.

**Cost in `quote-langgraph`.** Unhandled. `callAgent` throws only if the response
is not an `AIMessage`; an empty candidate flows through as an empty `response`
string and the user gets silence.

**What EZGraph does.** Classifies the stop reason as `blocked`, `truncated`,
`malformed_tool_call`, `complete`, or `unspecified`; nudges and retries the
retryable categories (default twice) before handing the rest to
`onEmptyModelResponse(context)` with the classification attached, so a node can
answer in its own voice for a content block while letting genuine faults surface.
It also seeds a freshly entered history space (default `"Start"`) for providers
that reject a system-prompt-only request, validates JSON-mode output before
commit via `onInvalidJsonResponse`, and records a session warning for every
rejected tool argument and empty response so the failure is diagnosable after the
fact. Guide: §9.3, §14.

### 3.11 Every team invents its own convention

**Symptom.** The organizational cost, and the one that compounds. Because
LangGraph leaves state shape, persistence, waiting, routing, tool dispatch, and
error handling to the application, two teams solving the same problem produce two
different codebases. A developer moving between them starts over.

**Evidence.** The v1 feedback thread is, read as a whole, a catalog of this:
requests for a state factory function because "the first node in my graphs is
always an `init_graph` node that just sets everything up," ambiguity about
`Command` versus state updates "across graphs," confusion about state management
"across nodes and subgraphs," and repeated requests for guidance on short- and
long-term memory in stateless backends ([langgraph#4973]). Every one of those is
a decision each team currently makes alone.

**Cost in `quote-langgraph`.** Its five stages are *not* structurally uniform.
Each is split across two arrow-function properties (`xAgent`, `xTools`) plus
entries in four module-level maps, and each `xTools` body organizes its dispatch
differently depending on how many tools the stage owns — compare `driverTools`
(single tool, early `if (call.name !== ...)`) with `vehicleTools` (two tools,
nested returns) and `quoteTools` (three tools, sequential name checks). Reading a
new stage means reading it in full.

**What EZGraph does.** The node contract is the convention, and it is small
enough to memorize. Verified across all five stages of `quote-graph`:

| Node | Members |
| --- | --- |
| `DriverNode` | `getPrompt`, `defineTool`, `@Tool captureDriver`, `createContext`, `nextStep` |
| `VehicleNode` | `getPrompt`, `defineTool`, `@Tool resolveVehicle`, `@Tool captureVehicleUse`, `createContext`, `nextStep` |
| `HistoryNode` | `getPrompt`, `defineTool`, `@Tool captureHistory`, `createContext`, `nextStep` |
| `CoverageNode` | `getPrompt`, `defineTool`, `@Tool selectCoverage`, `createContext`, `nextStep` |
| `QuoteNode` | `getPrompt`, **`getLlmConfig`**, `defineTool`, `@Tool adjustQuote`, `@Tool acceptQuote`, `@Tool reviseCoverage`, `createContext`, `nextStep` |

Five members, always in the same order, with `getLlmConfig` as the single
deliberate addition where the product pays for a stronger model. A developer who
has read one node can read any node in any EZGraph graph in the company — and
knows where to look for the prompt, the tools, and the transition without
searching. Guide: §6, §9.

---

## 4. quote-graph vs quote-langgraph, measured

### 4.1 The headline metric

Normalized executable lines (blank lines, comment-only lines, and imports
removed):

| Scope | EZGraph `quote-graph` | LangGraph `quote-langgraph` | Reduction |
| --- | --- | --- | --- |
| **Framework-facing graph code** | **758** | **1,283** | **40.9% less** |
| Shared domain backend | 310 | 310 | 0% (identical) |
| NestJS controller | 47 | 74 | 36.5% less |
| Graph code + controller | 805 | 1,357 | 40.7% less |
| Raw lines, nothing removed | 1,002 | 1,482 | 32.4% less |

File by file, framework-facing:

| EZGraph | Lines | LangGraph | Lines |
| --- | --- | --- | --- |
| `quote-graph.ts` | 50 | `quote-langgraph.ts` | 980 |
| `quote-graph.state.ts` | 62 | `quote-langgraph.state.ts` | 83 |
| `nodes/driver.node.ts` | 105 | `quote-session-store.ts` | 177 |
| `nodes/vehicle.node.ts` | 141 | `quote-types.ts` | 43 |
| `nodes/history.node.ts` | 101 | | |
| `nodes/coverage.node.ts` | 97 | | |
| `nodes/quote.node.ts` | 202 | | |
| **Total** | **758** | **Total** | **1,283** |

The shape of the two trees is itself informative. EZGraph's code is five node
files of comparable size, each one a stage — you can open the stage you care
about. LangGraph's is a single 980-line class that owns every stage, the request
boundary, the loop, and the routing, plus a separate 177-line persistence module.

### 4.2 Where the 525 lines went

Breaking `quote-langgraph` into concerns and pairing each with its EZGraph
counterpart. Counts are normalized lines; `≈` marks buckets measured by pattern
count rather than contiguous line range.

| Concern | LangGraph | EZGraph | Delta |
| --- | --- | --- | --- |
| Domain type declarations | 43 | 43 | 0 |
| State channels and reducers | 83 | 19 | **−64** |
| Session store (3 backends + serialize/hydrate) | 177 | 0 | **−177** |
| Request boundary (run, validate, load, save, delete, idle) | 199 | 12 | **−187** |
| Tool declaration + per-stage registration | 123 | 122 | −1 |
| Tool dispatch + argument parsing/validation | ≈113 | 0 | **−113** |
| Agent loop + message/tool-message plumbing | 79 | 0 | **−79** |
| Topology + router functions | 68 | 14 | **−54** |
| Transition decisions | ≈16, as inline `route:`/`phase:` writes | 100, as `nextStep()` | **+84** |
| Prompt assembly per stage | 50 | 29 | −21 |
| Model configuration | 19 | 10 | −9 |
| Domain validation + formatting (the product) | remainder | remainder | ≈0 |

Read that table as the argument of this document. Five buckets account for
essentially the whole delta — persistence (177), request boundary (187), tool
dispatch (113), agent loop (79), and reducers (64) — and every one of them is
infrastructure that has nothing to do with car insurance. EZGraph gives 84 lines
back in `nextStep()`, buying explicit, greppable, type-checked transitions in
exchange. The domain logic itself is unchanged, which is the point: this is not a
DSL that compresses business rules, it is a framework that deletes plumbing.

### 4.3 Modularity: the cost of adding a stage

The most honest test of modularity is how many places you touch to add a sixth
stage — say, a `DiscountsNode` between coverage and quote.

**LangGraph — 14 edit sites:**

| # | Edit | Location |
| --- | --- | --- |
| 1 | Add `"discounts"` to the `QuoteStage` union | `quote-langgraph.ts:52` |
| 2 | Add a `stageMessageKey` entry | `:92-98` |
| 3 | Declare the Zod schema const | `:100-160` |
| 4 | Wrap it in a `tool()` const | `:162-212` |
| 5 | Add a `stageTools` entry | `:214-225` |
| 6 | Bind a model in the constructor | `:267-273` |
| 7 | Write the `discountsAgent` method | `:473-526` |
| 8 | Write the `discountsTools` method | `:553-932` |
| 9 | `addNode("discountsAgent", …)` | `:427-471` |
| 10 | `addNode("discountsTools", …)` | `:427-471` |
| 11 | `addConditionalEdges` for the agent, plus one for the tools node | `:427-471` |
| 12 | Add an `agentRoutes` entry | `:957-964` |
| 13 | Add to `QuoteLanggraphPhase` | `quote-langgraph.state.ts:12-18` |
| 14 | Add to `QuoteLanggraphRoute`, plus state channels for the new data | `:20-26, :39-100` |

Eleven of those are one-line edits to shared module-level structures. Nothing
checks that they agree; a missed `agentRoutes` entry is a runtime `KeyError` on
the first customer who reaches that stage.

**EZGraph — 5 edit sites:**

| # | Edit | Location |
| --- | --- | --- |
| 1 | Write `nodes/discounts.node.ts` (the whole stage: prompt, tools, handlers, context, transition) | new file |
| 2 | Add a `DiscountsNode?: NodeStateValue<…>` key | `quote-graph.state.ts` |
| 3 | Add `[DiscountsNode, "quote-intake"]` to `historySpaces` | `quote-graph.ts:37-44` |
| 4 | Add `DiscountsNode` to `registerTurnNodes(...)` | `quote-graph.ts:64-71` |
| 5 | Change the upstream `advance(QuoteNode, …)` to `advance(DiscountsNode, …)` | `coverage.node.ts` |

One new file plus four one-line edits, and edits 3, 4, and 5 take the class — so
forgetting one is a `compile()` error or a type error, not a production
`KeyError`. Routing needs no edit at all, because `configAutoRoute()` derives it
from the outcome the new node returns.

That is what "modular" means here concretely: **a stage is a file.** Its prompt,
its tool schemas, its handlers, its validation, its persisted slice, and its
transition are in one place, and adding one does not require editing five shared
tables.

### 4.4 Boilerplate patterns, counted

Exact counts from the two trees:

| Pattern | LangGraph | EZGraph |
| --- | --- | --- |
| Manual `Schema.parse(call.args)` in `try`/`catch` | 8 | **0** |
| Tool-name dispatch checks (`call.name === / !==`) | 14 | **0** |
| `terminate_session` handling sites | 7 | **0** (framework `TerminateSessionNode`) |
| Explicit `route:` writes in application code | 16 | **0** |
| Quit checks in application code | 5 (inside dispatch chains) | 5 (`if (conversation.quitRequested) return this.quit(...)`) |
| Tool handler declarations | 8, inside `if`/`else` chains | 8 `@Tool` decorators |
| Hand-written reducers | 2 helpers × 17 channels | **0** |
| Hand-written session store implementations | 3 | **0** (4 ship with the framework) |

The `terminate_session` row is the clearest single illustration of the
contract argument. In LangGraph it is a schema, a `tool()` wrapper, an entry in
all five `stageTools` lists, and a handler branch in all five tool nodes — seven
sites, and a sixth stage would make it nine. In EZGraph every
`ConversationNode` inherits the handler, `TerminateSessionNode` supplies the
definition once, `quit()` routes through it, and `compile()` fails loudly if you
forget to register it.

### 4.5 Four excerpts, side by side

**State declaration.** LangGraph, 83 lines of channels (excerpt):

```ts
const replace = <T>(_: T, next: T): T => next;
const appendMessages = (current: BaseMessage[], update: BaseMessage | BaseMessage[]) =>
  current.concat(Array.isArray(update) ? update : [update]);

export const QuoteLanggraphState = Annotation.Root({
  phase: Annotation<QuoteLanggraphPhase>({ reducer: replace, default: () => "driver" }),
  route: Annotation<QuoteLanggraphRoute>({ reducer: replace, default: () => "end" }),
  completed: Annotation<boolean>({ reducer: replace, default: () => false }),
  response: Annotation<string>({ reducer: replace, default: () => "" }),
  userInput: Annotation<string>({ reducer: replace, default: () => "" }),
  inputConsumed: Annotation<boolean>({ reducer: replace, default: () => false }),
  config: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  driver: Annotation<DriverProfile | undefined>({ reducer: replace, default: () => undefined }),
  // … 9 more domain channels, each with reducer and default …
  intakeMessages: Annotation<BaseMessage[], BaseMessage | BaseMessage[]>({
    reducer: appendMessages, default: () => [],
  }),
  // … 2 more message channels …
});
```

EZGraph, 19 lines, no reducers:

```ts
export type QuoteGraphNodes = {
  DriverNode?: NodeStateValue<{ driver?: DriverProfile }>;
  VehicleNode?: NodeStateValue<{ resolvedVehicleId?: string; vehicle?: VehicleUse }>;
  HistoryNode?: NodeStateValue<{ history?: InsuranceHistory }>;
  CoverageNode?: NodeStateValue<{ coverage?: CoverageSelection }>;
  QuoteNode?: NodeStateValue<{
    tiers?: QuoteTier[];
    acceptedTier?: QuoteTierName;
    referenceNumber?: string;
  }>;
};

export const QuoteGraphState = createGraphStateAnnotation(
  DriverNode.name,
  () => ({} as QuoteGraphNodes),
);

export type QuoteGraphStateType = typeof QuoteGraphState.State;
```

Note what the EZGraph version *cannot* express: two stages writing the same key.
Each slice is keyed by node, so collisions are a type error rather than a
debugging session.

**Handling one tool.** LangGraph — dispatch, parse, validate, and transition in
one function, with the framework-shaped concerns interleaved with the insurance
rules:

```ts
private readonly driverTools = async (state) => {
  const call = latestToolCall(state.intakeMessages);
  if (!call) return { route: "end" };
  if (call.name === "terminate_session") return terminateUpdate("intakeMessages", call);
  if (call.name !== "capture_driver") {
    return invalidToolUpdate("intakeMessages", call,
      `Tool '${call.name}' is not available while collecting driver details.`, "driverAgent");
  }
  let parsed: z.infer<typeof captureDriverSchema>;
  try {
    parsed = captureDriverSchema.parse(call.args);
  } catch (error) {
    return invalidToolUpdate("intakeMessages", call, zodError(error), "driverAgent");
  }
  const reject = (error: string) =>
    invalidToolUpdate("intakeMessages", call, error, "driverAgent");
  // … 25 lines of actual driver validation …
  return {
    driver,
    intakeMessages: toolResult(call, { accepted: true, driver }),
    phase: "vehicle",
    response: "",
    route: "vehicleAgent",
  };
};
```

EZGraph — the handler receives typed, validated input and returns a result; the
transition is a separate, uniform decision:

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput, context: DriverContext): Promise<ConversationToolResult> {
  // … the same 25 lines of driver validation, and nothing else …
  context.driver = { /* … */ };
  return { output: { accepted: true, driver: context.driver }, stopAfterBatch: true };
}

protected nextStep(_state, context, conversation): GraphNodeUpdate<QuoteGraphStateType> {
  if (conversation.quitRequested) return this.quit(conversation);
  if (context.driver) {
    return this.advance(VehicleNode, conversation).withState({ driver: context.driver });
  }
  return this.stay(conversation);
}
```

The five lines of `{ driver, intakeMessages, phase, response, route }` in the
LangGraph version are five separate invariants the developer must remember to set
consistently on every path. `advance(VehicleNode, conversation).withState({…})`
sets all of them, and cannot set only some.

**Going backward.** "Rework my coverage" is the interesting transition, because
the customer's current message has to travel with them. LangGraph:

```ts
return {
  presentMessages: toolResult(call, { accepted: true }),
  intakeMessages: new HumanMessage("Review and update the coverage selections."),
  phase: "coverage",
  // Forward the customer's current message into the coverage stage.
  inputConsumed: false,
  response: "",
  route: "coverageAgent",
};
```

EZGraph:

```ts
if (context.revise) {
  return this.advance(CoverageNode, conversation)
    .forwardInput(state, "Review and update the coverage selections.");
}
```

**The request boundary.** LangGraph's `run()` is 199 normalized lines with the
session store: validate the message, validate or mint a session id, load the
document, check graph ownership, check idle expiry, check completion, invoke with
a recursion limit, serialize three message channels, write the document, and map
everything to an HTTP-shaped result — with no revision check, so two overlapping
turns silently lose one. EZGraph's equivalent is `GraphEngine.run()`, which the
application does not write, plus the eight-line `onRestoreSessionDoc` idle policy
in [§3.4](#34-checkpointers-are-framework-snapshots-not-application-records).

---

## 5. What EZGraph does not fix

Any comparison that finds no downsides is marketing. These are real, and the
developer guide states them too (§16.7, §14).

- **No streaming.** Turns are request/response. LangGraph's `astream_events` and
  token streaming have no EZGraph equivalent today. If the product needs
  token-by-token output now, this is disqualifying, and it is the single largest
  gap. Several v1-feedback participants specifically value streaming
  ([langgraph#4973]).
- **No escape hatch to `StateGraph`.** The underlying graph is private and there
  is no sanctioned `wrapLangGraph()` adapter. Exotic LangGraph features are
  reachable only if the facade exposes them. That is the price of the guarantees
  in [§3.8](#38-conditional-edge-tables-grow-faster-than-the-flow); it is still a
  price.
- **No arbitrary node functions.** Every node is a class registered through the
  facade, so the framework can construct it, register its tools, and verify its
  durable id.
- **Topology validation is lazy.** `buildGraph()` runs on first access to the
  graph property, and `GraphEngine.registerGraph()` does not touch it — so a
  duplicate tool definition or unwired edge surfaces as a `400` on the first
  user's first message instead of at boot. The workaround is a one-line
  `void new MyGraph(gateway).graph;` after registration. A proper eager-validation
  entry point is a known gap.
- **Class names are durable ids.** Renaming a node or graph class orphans live
  sessions unless `static id()` is overridden to return the old string. This is
  the sharpest edge in the framework and the easiest to trip over during a
  refactor.
- **Fixed top-level state shape.** You extend `nodes` and `config`; you do not add
  top-level fields.
- **Not yet built:** history compaction and context budgets, per-session token or
  cost budgets, and OpenTelemetry spans.
- **The 40.9% figure is one data point.** It is one five-stage guided
  conversation, written by the same authors on both sides. A different product —
  especially one with heavy parallel fan-out or a single-loop agent — would
  measure differently. The per-concern table in
  [§4.2](#42-where-the-525-lines-went) is more portable than the headline
  percentage, because it identifies *which* work disappears: persistence, request
  boundary, tool dispatch, agent loop, reducers. A product that needs all five
  should expect a similar result; one that needs none of them should not.

---

## 6. Choosing between them

**Use EZGraph** when the application is a multi-turn guided conversation on a
TypeScript backend: ordered stages with gates, slot filling with real validation,
waits measured in days, an auditable per-conversation record, and ordinary HTTP
semantics. Above all, use it when more than one team will build these, because the
contract in [§3.11](#311-every-team-invents-its-own-convention) is worth more over
time than the line count in [§4.1](#41-the-headline-metric).

**Use raw LangGraph** when you need token streaming today; when the topology is
genuinely exotic (deep parallel fan-out, dynamic `Send`, nested subgraphs as
tools); when you are in Python; when the graph is a small one-off where 500 lines
of plumbing is cheaper than adopting a framework; or when you need direct access
to LangGraph features the facade does not expose.

**Use LangChain's `create_agent`** — not raw `StateGraph`, and not EZGraph — when
the product really is one tool-calling loop. The 2026 consensus on this is
consistent, and both frameworks agree with it ([uvik], [markaicode]).

Worth restating: this is not a competition. EZGraph compiles to a real
`StateGraph` and runs on LangGraph. The comparison is between *writing the
application layer yourself* and *adopting one*.

---

## 7. Reproducing the measurements

Normalized lines were counted with a script that removes blank lines,
comment-only lines (`//`, `/* … */`, leading `*`), and `import` statements
including multi-line blocks:

```js
function normalize(lines) {
  let total = 0, inBlockComment = false, inImport = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlockComment) { if (line.includes("*/")) inBlockComment = false; continue; }
    if (inImport) { if (/from\s+["'].*["']/.test(line) || /;\s*$/.test(line)) inImport = false; continue; }
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) { if (!line.includes("*/")) inBlockComment = true; continue; }
    if (line.startsWith("*")) continue;
    if (/^import\b/.test(line)) {
      if (!/from\s+["'].*["']\s*;?\s*$/.test(line)) inImport = true;
      continue;
    }
    total += 1;
  }
  return total;
}
```

Pattern counts in [§4.4](#44-boilerplate-patterns-counted) are `ripgrep` counts
over the two trees, for example:

```bash
cd src/graphs/quote-langgraph
rg -c 'Schema\.parse\(call\.args\)' quote-langgraph.ts    # 8
rg -c 'call\.name ===|call\.name !==' quote-langgraph.ts  # 14
rg -c 'terminate_session' quote-langgraph.ts              # 7
rg -c 'route: "' quote-langgraph.ts                       # 16

cd ../quote-graph
rg -c '@Tool\(' nodes/*.ts        # 8 total
rg -c '\.parse\(' nodes/*.ts      # 0
```

Node-member uniformity in
[§3.11](#311-every-team-invents-its-own-convention) was extracted with:

```bash
cd src/graphs/quote-graph/nodes
for f in *.node.ts; do
  echo "--- $f"
  rg -o '^  (?:protected |async |@)?[a-zA-Z@]+[a-zA-Z]*\(' "$f" | tr -d ' (' | tr '\n' ' '
  echo
done
```

---

## 8. References

External sources, all consulted August 2026.

- [langgraph#4973] LangGraph v1 feedback issue — "What parts of LangGraph are
  confusing or unclear? What feels unnecessarily complex or boilerplate-heavy?"
  <https://github.com/langchain-ai/langgraph/issues/4973>
- [lg-interrupts] LangGraph docs, Interrupts — including the warning against
  `while True` + `interrupt()` and the resulting exponential re-execution.
  <https://docs.langchain.com/oss/python/langgraph/interrupts>
- [lg-state] LangGraph docs, State — schemas, reducers, and channels.
  <https://langchain-ai-langgraph-40.mintlify.app/concepts/state>
- [lc-kb] LangChain knowledge base — checkpointers, databases, memory, and TTL;
  checkpoint bloat, `DocumentTooLarge`, no automatic cleanup.
  <https://kb.langchain.com/articles/6253531756-understanding-checkpointers-databases-api-memory-and-ttl>
- [lc-forum] LangChain forum — does the Postgres checkpointer serialize
  concurrent requests? (instance-level lock).
  <https://forum.langchain.com/t/does-the-postgres-checkpointer-serialize-concurrent-fastapi-requests/2882>
- [langgraphjs#2040] Cross-thread checkpoint data contamination with a singleton
  agent under concurrent invocations.
  <https://github.com/langchain-ai/langgraphjs/issues/2040>
- [langgraph#6728] Duplicate subgraph task execution creating forked checkpoints
  from one request. <https://github.com/langchain-ai/langgraph/issues/6728>
- [towardsai] "LangGraph checkpointing is not free: a production postmortem" —
  schema-migration breakage, 40 GB checkpoint tables, interrupt edge cases.
  <https://pub.towardsai.net/langgraph-checkpointing-is-not-free-a-production-postmortem-398bc86861f4>
- [dev-to] "LangGraph checkpointing: three production rewrites to stop losing
  state" — silent schema mismatch, ~200 lost runs, hand-built optimistic locking.
  <https://dev.to/elenarevicheva/langgraph-checkpointing-three-production-rewrites-to-stop-losing-state-231b>
- [altersquare] "LangGraph state management: what the documentation doesn't cover
  until you're already committed" — schema versioning and migration as the
  application's job.
  <https://altersquare.io/blog/langgraph-state-management-undocumented-issues-after-commit>
- [azguards] "Mitigating checkpoint collisions and write-skew in LangGraph" —
  lost updates, `INVALID_CONCURRENT_GRAPH_UPDATE`, retry thrashing.
  <https://azguards.com/ai-engineering/mitigating-checkpoint-collisions-write-skew-in-langgraph/>
- [mazza] "LangGraph: state as API after three rewrites" — reducers, and keeping
  routing logic out of edge functions.
  <https://gianlucamazza.it/en/blog/langgraph-workflow-orchestration>
- [neuralbase] LangGraph course, conditional edges — an unmapped router return is
  a `KeyError` at invoke time, not at `compile()`.
  <https://theneuralbase.com/langgraph/learn/beginner/add-conditional-edges-routing-based-on-state/>
- [scorrea] "LangGraph in production: memory, state machines, and the
  orchestration pattern that actually works" — explicit stage machines, tool
  nodes, loop budgets.
  <https://scorrea92.medium.com/langgraph-in-production-memory-state-machines-and-the-orchestration-pattern-that-actually-works-8c300b4579e9>
- [pikvue] "LangGraph review 2026" — boilerplate and learning curve as the
  headline costs.
  <https://pikvue.com/langgraph-review-2026-low-level-framework-for-reliable-ai-agents/>
- [markaicode] "LangGraph vs LangChain in 2026: do you need the raw graph?" —
  dropping to `StateGraph` early adds real maintenance cost.
  <https://markaicode.com/vs/langgraph-vs-langchain/>
- [uvik] "LangChain vs LangGraph: 2026 decision guide" — a premature hand-built
  `StateGraph` as the most common and most expensive mistake.
  <https://uvik.net/blog/langchain-vs-langgraph/>

Internal documents:

- [`ezgraph-developer-guide.md`](/ezgraph/docs/developer-guide/) — the full
  framework reference; §16 is written for developers arriving from LangGraph, and
  §11 and §14 cover outcomes, routing, and the behaviors cited throughout.
- Demo implementations: `src/graphs/quote-graph/` and
  `src/graphs/quote-langgraph/` in
  [ezgraph-demo](https://github.com/picoflowio/ezgraph-demo).
