---
title: Operate and debug session documents
eyebrow: Guides
lede: Keep an accessible operational record for every conversation, diagnose incidents from one document, and reproduce failures safely without a separate PicoFlow observability service.
source: picoflow/src/picoflow/types/flow-types.ts, picoflow/src/picoflow/services/flow-engine.ts, picoflow/src/picoflow/session/
---

Every PicoFlow turn restores and saves one versioned session document. That document is both the
durable conversation record and the first place an operator should look when something goes
wrong. It contains the active step, business state, named model memories, transition sequence,
effective model configuration, token totals, status, and structured log, warning, error, debug,
and verbose records.

PicoFlow does not require a separate PicoFlow cloud or observability control plane for this
baseline. Keep the application and its session store in the enterprise-approved network and
database boundary. Model requests still follow the provider you choose; an air-gapped deployment
needs an internally hosted model or an approved private endpoint.

## Start with one incident record

For a slow, failed, or surprising customer turn, load the session document by its session ID.
Read these fields together before changing code or retrying a request:

| Question | Fields to inspect |
| --- | --- |
| Is the session live, complete, or aborted? | `runStatus`, `saveOn`, `createdOn` |
| Which workflow and stage own the case? | `flow.name`, `flow.currentStep`, `flow.sequence` |
| What facts and customer/model context were present? | `flow.steps[].state`, `flow.memory`, `flow.context` |
| Which model behavior was in effect? | `flow.model`, per-step `model` overrides, `tokens` |
| What did the runtime record? | `log`, `warn`, `error`, `debug`, `verbose` |
| Could another writer have won? | `revision`, conflict errors, `saveOn` |

This is an application-readable case file, not a replacement for every distributed trace,
metric, alert, or retention policy. It answers the high-value question first: *what happened to
this customer conversation?*

## Build internal operational metrics from the document database

All PicoFlow flows use the same outer document shape. A database query or scheduled aggregation
can therefore build portfolio views without first normalizing each workflow's custom graph state.

Useful metrics include:

- running, completed, and aborted sessions by `flow.name`;
- error and warning rates over `saveOn` time windows;
- active sessions grouped by `flow.currentStep` to find stalled stages;
- token totals by flow, model, tenant field, or time period;
- long-lived sessions from `createdOn` to `saveOn`; and
- repeat failures grouped by error code, active step, or model selection.

Choose indexes and retention rules for the queries your operations team actually runs. The
runtime supplies a stable document shape; it does not provision indexes, dashboards, alerts, or
governance policy automatically. Treat message histories, tool payloads, and diagnostic records
as potentially sensitive data when assigning access and retention.

## Reproduce a production failure safely

The session document makes a rare production-only failure portable. Copy the evidence into an
isolated environment rather than trying to reconstruct a conversation from screenshots, logs,
and a trace ID across several systems.

```text
production session document
  -> copy and redact under incident controls
  -> import into isolated test storage with a new session ID
  -> set a runnable status
  -> choose flow.currentStep
  -> restore or deliberately trim relevant step state and memory
  -> replace live credentials and side-effecting tools with sandbox/test versions
  -> replay the triggering request
  -> compare the response, saved state, logs, tokens, and transition sequence
```

Never replay a production document in place. A replay can otherwise repeat a booking, payment,
email, or other external effect. Use a new ID, isolated storage, test credentials, and mocked or
idempotent tools.

### Resuming is not automatic rollback

Changing `flow.currentStep` chooses where a copied session resumes. It does **not** rewind step
state or message history. Exact rollback requires an earlier retained document snapshot. Without
one, deliberately restore or trim the relevant state and memory before replaying.

The `flow.sequence` trail explains the path that led to the current state, but it is not a full
history of state snapshots. For a prior-state replay, retain a versioned copy under your own
incident and retention policy.

## A simpler observability default, not a capability claim

LangGraph can run privately, use a checkpointer, and integrate with LangSmith, OpenTelemetry,
application logs, or another internal observability platform. PicoFlow's distinction is that a
session document already supplies a common case-record and diagnostics baseline for every flow.

With a direct graph, a team can build an equivalent operational view. It must decide what state,
model metadata, logs, token records, session identifiers, retention, metrics, and replay
workflow to capture—and then standardize that work across applications. PicoFlow supplies the
outer document and lifecycle convention before a second or third conversation is built.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">Session document: state, diagnosis, and replay</span>
		<span class="card__body">The complete document tree, field semantics, durable cursor, and revision model.</span>
	</a>
	<a class="card" href="/docs/guides/persistence/">
		<span class="card__title">Persistence and session stores</span>
		<span class="card__body">Choose Memory, SQLite, MongoDB, or Cosmos DB and configure durable storage.</span>
	</a>
	<a class="card" href="/docs/guides/concurrency/">
		<span class="card__title">Concurrency and session conflicts</span>
		<span class="card__body">Why session locking and revision compare-and-swap protect a whole-document write.</span>
	</a>
	<a class="card" href="/docs/resources/interrupts-replay-and-operations/">
		<span class="card__title">PicoFlow and LangGraph operations</span>
		<span class="card__body">The precise comparison with checkpoint history, interrupts, and observability choices.</span>
	</a>
</div>
