---
title: Interrupts, replay, and operations
eyebrow: Compare
lede: PicoFlow retains a rich latest session document; LangGraph checkpointers retain a checkpoint history when configured.
source: codex/pico-web/picoflow-langgraph.html, picoflow/src/picoflow/types/flow-types.ts, picoflow/src/picoflow/services/flow-engine.ts, picoflow-demo/src/myflow/hotel-langgraph/hotel-langgraph.ts
---

The earlier reference document has a valuable operational insight: a saved conversation is a
debugging artifact. Its details need one correction—PicoFlow stores the latest durable session,
whereas LangGraph checkpoint history exists only when the graph has a configured checkpointer.

## Human pauses

PicoFlow's normal interaction boundary is already a durable turn: run the active step, save the
session, return a response, and resume when the next HTTP request arrives. That works well for
ordinary information collection and multi-turn conversations.

LangGraph has a distinct interrupt/resume mechanism. With a checkpointer, an interrupt can
pause graph execution at a node and resume the same thread later. This is the stronger native
model for approvals or review gates that must suspend work in the middle of an execution.

The hotel use case does not need a mid-node pause, so neither implementation demonstrates one.
Its user turns are ordinary request/response boundaries. Do not infer from this example that a
PicoFlow wait and a LangGraph interrupt have identical semantics:

| Situation | PicoFlow pattern | LangGraph pattern |
| --- | --- | --- |
| Ask the user for another field | Return the current turn and retain the active step | End the current invocation and retain thread state |
| Wait for approval before an effect | Model an approval step and save the session | Call `interrupt()` inside a node and resume with `Command` |
| Inspect pending work | Application fields and current step | Checkpoint snapshot `next` and `tasks` |
| Resume in the middle of durable graph work | Build application-specific state and re-entry | Native interrupt plus checkpointer |

LangGraph interrupts require persistence: the graph must save where execution paused. Current
documentation also warns that `interrupt()` works by propagating a special graph interrupt, so
application `try/catch` code must not swallow it. See the current
[interrupt guide](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

## Replay and time travel

PicoFlow records `flow.sequence`, memory, step state, logs, and errors in its session document.
An operator can copy that document into a safe environment, adjust durable state or history, and
run it again. That is a useful application-level replay workflow, but it is not automatic
checkpoint history.

With a LangGraph checkpointer, `getState`, `getStateHistory`, and `updateState` operate on
thread checkpoints. A prior checkpoint can be replayed or forked. The direct hotel comparison
does not get these facilities because it compiles without a checkpointer.

PicoFlow's `flow.sequence` is useful but much smaller than checkpoint history. It records which
step was entered and the nesting level; it does not preserve every earlier state or message
snapshot. Replaying from an older point requires an externally retained session copy or a
manually edited current document.

LangGraph checkpoints capture state at super-step boundaries. Replaying from a checkpoint skips
work before it and re-executes later nodes, including model and external calls. That makes
idempotency essential: “time travel” can repeat side effects unless nodes are designed for it.

## Three meanings of memory

The word “memory” is overloaded in agent frameworks:

1. **Model conversation history** — PicoFlow named memories or the direct graph's three message
   arrays.
2. **Thread execution state** — a PicoFlow session document or a LangGraph checkpointer's
   checkpoint chain.
3. **Cross-thread knowledge** — application data, or a LangGraph `Store` keyed outside one
   thread.

The hotel comparison implements the first two with application/framework session documents.
It implements no cross-thread user memory. Conflating these layers leads to bad architecture
claims—for example, saying that a message array is equivalent to checkpoint recovery.

## Failure recovery

PicoFlow persists once around a turn: the engine restores, executes the flow, then saves the
result. If a model or tool fails mid-turn, it attempts to mark the session aborted and save an
error. It does not resume halfway through the failed tool loop.

The direct graph also saves only after `compiledGraph.invoke()` returns. Because no checkpointer
is configured, a crash after one node but before the final custom store write loses every update
from that invocation. Native LangGraph checkpointing can retain successful super-steps and
pending writes, but that capability is absent from this implementation.

## Observability shape

PicoFlow puts operational data inside the session: current step, sequence, model overrides,
token totals, log/error/warning/debug/verbose arrays, and run status. This makes one database
document self-contained for incident inspection, at the cost of document growth and coupling
operational retention to conversation retention.

The direct graph's document is domain-focused. It stores state and timestamps but no node
trace, error history, token usage, model identity, retry count, or latency. Local code is easy
to debug, but a production incident needs external tracing or additional structured records.

## Production observability is mandatory

A production LangGraph service needs observability. Operators must be able to correlate a user
request with graph state, node execution, model calls, tool calls, latency, failures, retries,
and persisted checkpoints. The direct hotel graph currently supplies none of that beyond its
latest custom state document, so it is not operationally equivalent to PicoFlow yet.

LangSmith is LangGraph's official integrated route to traces, state inspection, evaluation, and
operational tooling. If a team does not adopt LangSmith, it must build and operate equivalent
instrumentation with application logs, OpenTelemetry, its database, or another observability
platform. That engineering and integration cost belongs in the direct-LangGraph estimate.

PicoFlow starts from a different default. Its session document already contains the active
step, step state, message memories, sequence, effective model metadata, token usage, and
structured log, warning, error, debug, and verbose records. This is not a full distributed-
tracing product or dashboard, but it answers many high-value incident questions from one
self-contained record without purchasing or integrating a separate agent-observability
service.

## Firewall and privacy boundary

PicoFlow, its orchestration state, and its bundled session stores can run entirely inside an
enterprise-controlled network. Production session evidence can remain in the same approved
MongoDB, Cosmos DB, SQLite, or memory boundary as the application. Model calls still follow the
chosen provider's network boundary, so a truly air-gapped deployment also needs an internally
hosted model or an approved private endpoint.

LangGraph itself can also run behind the firewall, and LangSmith tracing can be disabled. The
privacy trade-off appears when the team chooses managed LangSmith Cloud for the practical
observability layer: prompts, outputs, state, and tool traces sent for observation cross into a
separate vendor environment and may require security, privacy, procurement, residency, and
retention approval. LangChain documents how to
[disable tracing and keep graph data local](https://docs.langchain.com/langsmith/data-storage-and-privacy).

Self-hosted LangSmith keeps observability data in enterprise infrastructure, but it is an
Enterprise add-on and a platform to operate. The documented production stack includes
Kubernetes/Helm and services such as PostgreSQL, Redis, and ClickHouse, with licensing and
egress considerations unless an air-gapped mode is arranged. PicoFlow's embedded session
diagnostics are therefore a materially simpler default for teams that need useful production
diagnosis without introducing another observability control plane. See LangChain's current
[self-hosted LangSmith architecture](https://docs.langchain.com/langsmith/self-hosted).

The accurate conclusion is not that LangGraph is incapable of private deployment. It is that
production-grade direct LangGraph needs an observability decision: export traces to managed
LangSmith, procure and operate self-hosted LangSmith, integrate another internal platform, or
build the missing diagnostic layer. PicoFlow includes a substantial diagnostic baseline in the
runtime and session schema already.

## Data governance questions

Before retaining prompts, tool messages, state, and errors, decide:

- which fields may contain personal or payment information;
- whether logs duplicate sensitive message content;
- how long completed, aborted, and expired sessions remain stored;
- whether operators may edit or replay production data;
- how replay is isolated from real booking tools; and
- how deletion covers checkpoints, stores, traces, and backups.

Neither implementation answers these product-policy questions. A richer session or checkpoint
history increases debugging power and the amount of governed data at the same time.

## Operational ownership

PicoFlow standardizes status, token totals, log/error/warning collections, and a session
revision across its flows. Direct LangGraph maximizes control over the state and observability
contract, while making the application responsible for choosing and operating its checkpoint,
store, tracing, retention, and concurrency policies. The relevant question is which owner your
team wants—not whether one approach makes debugging unnecessary.
