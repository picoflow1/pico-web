---
title: State, memory, and persistence
eyebrow: Compare
lede: The important comparison is not “can either framework persist?” but which durable contract the application owns.
source: picoflow/src/picoflow/types/flow-types.ts, picoflow/src/picoflow/session/session-store.ts, pico-demo/src/myflow/hotel-langgraph/hotel-langgraph.state.ts, pico-demo/src/myflow/hotel-langgraph/hotel-session-store.ts
---

Both approaches persist multi-turn state, but their units of persistence differ.

## PicoFlow session document

PicoFlow persists one versioned session document with a flow cursor, per-step state, named
memories, context, execution sequence, status, logs, errors, warnings, and token totals. Its
stores use the `revision` field as a compare-and-swap token; the engine also serializes same-
process turns per session. `expireAfter` is measured in seconds.

```text
session
├── revision, runStatus, expiry, tokens, operational records
└── flow
    ├── currentStep
    ├── steps[].state
    ├── memory[name]
    ├── context
    └── sequence
```

This gives several flows a common operational and persistence vocabulary. It also means the
framework owns that schema and applications must migrate persisted step names and state with
care.

For maintainers, this document is more than persistence. It is a portable diagnostic capsule:
the user/model history, durable business state, active step, transition sequence, effective
models, token totals, and structured logs remain together under one session ID. A support or
engineering tool can inspect the same shape for every PicoFlow application.

HotelFlow uses four memory namespaces:

| Step | Namespace | Entry policy |
| --- | --- | --- |
| `ExploreStep` | `hotel-explore` | Retained across search refinements; summarized after eight messages while keeping four recent messages |
| `PresentStep` | class-default `PresentStep` | Erased when the flow enters from another step |
| `CompareStep` | class-default `CompareStep` | Erased when the flow enters from another step; retained across repeated comparisons in one visit |
| Terminal step | `end` | Separate terminal exchange |

This is not only storage organization. Each namespace becomes the model history for that
stage, so isolation is a prompt-design choice as well as a persistence choice.

## LangGraph state and checkpointers

LangGraph's state schema defines the keys that nodes read and update. Reducers decide how
concurrent updates to a key combine. When a graph is compiled with a checkpointer, LangGraph
saves state checkpoints per thread at super-step boundaries; a store is a separate mechanism
for cross-thread data.

The compared direct hotel graph does **not** enable a LangGraph checkpointer. It serializes its
own `HotelSessionDocument` to memory, SQLite, or MongoDB, including three message arrays and
the routing controls. That is a valid design, but it is the reason the example owns message
serialization, expiry, state restoration, and whole-document writes itself.

## The direct state channels

The direct graph defines 17 annotated channels:

| Category | Channels |
| --- | --- |
| Control | `phase`, `route`, `completed`, `response`, `userInput`, `inputConsumed` |
| Request context | `config` |
| Search domain | `criteria`, `hotelFound`, `availableHotels` |
| Comparison and booking | `selectedHotels`, `lastComparison`, `bookedHotel`, `confirmationNumber` |
| Model history | `exploreMessages`, `presentMessages`, `compareMessages` |

Most channels use a last-write-wins reducer. `config` shallow-merges updates. Each message
channel appends. Those reducers are appropriate for this sequential graph, but the message
reducers would also combine updates if parallel branches wrote to the same channel—ordering
and semantic correctness would then need deliberate tests.

Several fields are execution controls rather than durable business facts. `response`,
`userInput`, `inputConsumed`, and `route` are nevertheless serialized after every turn. Native
LangGraph state can mark runtime-only data as untracked, while a custom session envelope can
simply omit or reconstruct it. The current implementation does neither.

## Restore behavior compared

```text
PicoFlow
  fetch schema-validated session
  -> enforce one-flow-per-session
  -> check expiry and document version
  -> optional migration hook
  -> restore cursor, steps, memories, context, models

Direct graph
  store.get(id)
  -> check graphName
  -> check modifiedAt + expireAfter
  -> deserialize three message arrays
  -> spread prior state into graph input
```

PicoFlow's richer restore contract costs coupling: persisted class IDs are public data, schema
changes need migration, and every flow accepts the framework's outer document. The direct
document is easy to understand and change for one graph, but every compatibility rule is local
application code.

## Write conflicts

The persistence difference is more consequential than the shape difference. PicoFlow obtains
an in-process per-session lock and writes with a revision compare-and-swap. All bundled stores
reject a stale revision.

The direct stores have `get`, `set`, `delete`, and `close`; every `set` is unconditional. The
Mongo adapter uses `replaceOne` keyed only by ID, SQLite uses an upsert keyed only by ID, and
the memory adapter calls `Map.set`. Two overlapping turns can therefore lose one complete
update. This is a property of the custom store, not LangGraph: a configured checkpointer would
introduce a different persistence and concurrency model.

## Expiration is not equivalent

PicoFlow interprets `expireAfter` and `SESSION_EXPIRATION` in seconds and defaults the session
to 600 seconds. The direct graph interprets the same environment-variable name in milliseconds
and defaults to 50,000 milliseconds. In the combined demo, `SESSION_EXPIRATION=50000` means
about 13.9 hours to one implementation and 50 seconds to the other.

This should be fixed or namespaced before treating the HTTP endpoints as equivalent. Unit
differences at a shared configuration boundary are operational bugs, not framework trade-offs.

## Message growth and compaction

The direct graph keeps separate histories, which preserves useful stage context and prevents
one giant mixed message list. Unlike HotelFlow, however, it never erases or summarizes them.
Repeated searches, comparisons, and returns keep appending messages to both the prompt and the
stored document.

For a durable chatbot, define a policy for each channel: keep all, keep the latest N, summarize,
extract facts into domain state, or deliberately erase on entry. “Persisted” is not the same as
“safe to grow forever.”

## Native LangGraph persistence is a third design

Compiling with a checkpointer would remove the need to manually load and save the latest state,
and would enable thread history, pending writes, interrupts, and replay. Adding a LangGraph
store would address cross-thread memories. It would not automatically create PicoFlow's outer
session contract, logs, token totals, one-flow invariant, or exact HTTP response envelope.

For the current APIs, see LangGraph's
[persistence guide](https://docs.langchain.com/oss/javascript/langgraph/persistence). A fair
future benchmark should implement this third version rather than implying that the current
custom session layer represents the only direct LangGraph architecture.

## Replaying a production failure safely

PicoFlow's most important maintenance workflow is taking the exact production session document
to an isolated test environment and continuing it from a chosen step. This preserves the
context that is usually hardest to reconstruct: the user's wording, model/tool history,
cross-step state, selected models, transition path, warnings, and error evidence.

```text
production session document
  -> copy and redact under incident controls
  -> import into isolated test storage with a new session ID
  -> set runStatus to running
  -> select flow.currentStep
  -> restore or trim that step's state and memory to the desired point
  -> replace real tools and credentials with sandbox/test versions
  -> replay the triggering request
  -> compare new logs, state, response, and transition sequence
```

This can turn a production-only bug into a repeatable test fixture without reconstructing the
conversation by hand. It is especially effective for bugs caused by a rare combination of old
memory, cross-step state, model output, and routing.

Two guardrails are essential:

1. Changing `flow.currentStep` changes where execution resumes; it does not magically roll back
   state or message history. Exact rollback needs a retained earlier snapshot. Without one, the
   operator must deliberately trim or restore the relevant memory and state.
2. Never replay the production document in place. Use a new ID, an isolated store, test model
   credentials, and idempotent or mocked external tools so replay cannot repeat a booking,
   payment, email, or other side effect.

PicoFlow stores the latest document rather than an automatic checkpoint chain, so teams that
want point-in-time replay should retain revision snapshots or change history according to their
privacy and retention policy. Even without automatic history, the common self-contained format
makes capture, transport, inspection, and test replay much simpler than a graph-specific state
plus separately correlated telemetry.

## What this means for a decision

PicoFlow is useful when a portfolio needs one application-session contract with built-in
operational fields and revision protection. LangGraph is useful when the graph's native
checkpoint history and state schema should be the durable contract, or when persistence must be
shaped independently for each workflow. A direct graph can use a LangGraph checkpointer; doing
so changes the comparison and should be evaluated as a different architecture, not dismissed as
unavailable.
