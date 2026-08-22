---
title: Reliability and production gaps
eyebrow: Compare
lede: A production decision should compare failure semantics, races, configuration collisions, growth limits, and external side effects—not only the successful transcript.
source: picoflow/src/picoflow/services/flow-engine.ts, picoflow/src/picoflow/session/, pico-demo/src/controllers/, pico-demo/src/myflow/hotel-flow/, pico-demo/src/myflow/hotel-langgraph/
---

Neither hotel implementation should be treated as production-ready merely because its happy
path works. Their risks are different: PicoFlow centralizes failure policy but the demo's domain
handlers are permissive; the direct graph validates the domain more carefully but owns a thin
session runtime without conflict protection or operational records.

## Session races

PicoFlow protects one session in two layers. `FlowSession.withSessionLock()` serializes turns
inside one engine process. Every bundled store also compares the document's `revision` before a
write, protecting against stale writers in other processes. A loser receives a conflict rather
than silently replacing newer state.

The direct graph performs this sequence:

```text
store.get(id) -> hydrate -> graph.invoke -> store.set(document)
```

Memory uses `Map.set`, SQLite uses an unconditional upsert, and MongoDB uses unconditional
`replaceOne(..., { upsert: true })`. There is no lock, version predicate, or retry. Two turns on
one session can both read state N and then write N+1; the later write wins and the other user
turn disappears.

Fix this before horizontal scaling or browser retry concurrency. Add an expected revision to
the document and make the storage update conditional, or adopt a LangGraph checkpointer whose
concurrency semantics match the deployment.

## Configuration collisions in the combined demo

The two implementations share environment variable names but not always units or meaning:

| Setting | PicoFlow | Direct graph |
| --- | --- | --- |
| `SESSION_STORE` | MEMORY, SQLITE, MONGO, or COSMO | memory, sqlite, or mongodb |
| SQLite path | `SQLITE_PATH` | `SQLITE_DB_PATH` |
| Mongo settings | `MONGODB_URL`, name, collection | The same three names |

PicoFlow Flow classes own their idle policy in `onRestoreSessionDoc()` rather
than reading a shared expiry environment variable. The direct hotel graph also
uses a code default (50 seconds). Document these independent policies at their
respective endpoints rather than trying to control both with one variable.

If both select the same Mongo collection, framework session documents and graph-specific
documents are mixed in one collection. Their random IDs make direct collision unlikely, but
queries, retention rules, schema validation, and incident tooling now span two incompatible
document shapes. Separate collections are cleaner.

## Error semantics and observability

PicoFlow's engine records structured errors in the session and attempts to persist an aborted
status. It also carries logs, warnings, debug records, token totals, and model metadata. One
known API problem remains: the failure envelope currently sets `completed: true`, so callers
must branch on `success`, not `completed` alone.

The direct graph consistently returns `completed: false` on errors, but maps validation,
provider, graph, and persistence failures to HTTP 400. It does not save the error, a failure
status, token usage, the active failing node, or a stack-safe diagnostic identifier. A bad user
request and a database outage are operationally indistinguishable at the HTTP status level.

That gap must be closed before production. LangSmith is the most integrated LangGraph option;
without it, the team needs to add structured node/model/tool tracing, correlation IDs, durable
failure records, metrics, redaction, retention, and an incident-query surface. PicoFlow's
session document supplies much of the diagnostic record by default, although platform-level
metrics and distributed traces may still be appropriate around it.

## Unbounded histories

PicoFlow enables compaction only for `hotel-explore`, keeping recent messages and a summary.
`PresentStep` and `CompareStep` erase their isolated memory when entered from another step.

The direct graph appends to `exploreMessages`, `presentMessages`, and `compareMessages` forever.
Re-entering a phase adds synthetic context but does not clear old messages. Long sessions grow
the stored document and prompt, increase cost, and may eventually exceed model or database
limits. Add phase-aware trimming or summarization before calling this production durable
memory.

## External effects

Both demos generate a confirmation number but do not call a booking system. In a real flow,
booking is an irreversible or externally visible effect. Neither a PicoFlow compare-and-swap
nor a LangGraph checkpoint can undo a reservation after a later session write fails.

Use an idempotency key tied to session and operation, write an intent/outbox record before the
external call, and make retries return the original booking result. This requirement is
framework-independent.

## Other concrete gaps

- The PicoFlow pricing helper has an impossible guard, `!basePrices && basePrices.length > 0`,
  and its chart helper pads all values with one column width. The direct copies fix/refactor
  these, which is why total helper line counts are not a clean framework comparison.
- Both pricing engines reuse a 2025 holiday fixture by month and day for later years. Floating
  holidays can land on the wrong date in 2027.
- PicoFlow stores the chosen hotel but not the generated confirmation number. The direct graph
  stores both, making support investigation easier.
- The direct in-memory store returns stored objects without cloning. Treat it as a test adapter,
  not an isolation boundary.
- Neither implementation demonstrates cancellation, per-tool timeouts, rate limits, PII
  redaction, authorization, or a production booking transaction.

The fair conclusion is mixed: the direct implementation is safer at its domain boundary;
PicoFlow is safer at its shared session boundary. A production implementation should combine
both strengths.
