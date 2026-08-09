---
title: Concurrency and session conflicts
eyebrow: Guides
lede: Two independent safeguards protect one session document — a local FIFO lock and an optimistic revision check. Neither prevents duplicate work, and there is no automatic replay.
source: pf/src/picoflow/services/flow-engine.ts
---

Read this before running more than one application instance, before letting a client send two
turns without waiting, and before any tool handler charges money or sends a message. The
guarantees are real but narrow, and the failure mode is a request that did expensive work and
then lost the right to save it.

## Two layers, neither sufficient alone

```text
Layer 1  SessionMutex          serialises a complete run within one engine instance
Layer 2  revision compare-and-swap   decides the winner across every writer
```

Layer 1 prevents wasted work in the common case. Layer 2 is the correctness guarantee.

## Layer 1: the local session lock

`FlowEngine.runFlow()` wraps the entire run — flow creation, session load, restore and
migration, model and tool execution, and the final save — in a per-session lock:

```ts
return await this.flowSession.withSessionLock(sessionId, async () =>
  await this.runFlowLocked(flowName, userMessage, sessionId, context),
);
```

`SessionMutex` keeps a FIFO promise chain per session ID. Two requests for the same ID inside
one engine run one after the other; requests for different IDs stay concurrent.
`deleteSession()` takes the same lock, so a local delete cannot race a local run.

Two limits matter:

- **It is process- and engine-instance-local.** A second Node process, a second `FlowEngine`
  in the same process, or a direct store writer are not coordinated at all.
- **Requests without a session ID are not locked**, because each creates a fresh random ID.

`SessionMutex` itself is internal — it is not exported from `@picoflow/core`. Applications
interact with it only through `flowSession.withSessionLock(...)`.

<div class="callout callout--warning"><span class="callout__title">Horizontal scaling removes layer 1</span><p>Behind a load balancer, two turns for the same session can land on different instances. Both will load the same revision, both will call the model, and only one will be allowed to save. The lock does not span processes.</p></div>

## Layer 2: optimistic compare-and-swap

Every session document carries an integer `revision`:

```text
load document at revision 7
  -> run and mutate the loaded copy
  -> save(document, expectedRevision = 7)
       -> success:  atomically write revision 8
       -> stale or missing: throw SessionConflictError
```

Only one writer can win from a given revision. `FlowSession.save()` updates the in-memory
document to the returned revision after every successful write, because a single run
checkpoints several times: an initial save for a new session, the immediate save after
`onRestoreSessionDoc()`, a save on each cross-step transition, and the final save.

That is worth internalising — a conflict can be raised part-way through a turn, not only at
the end.

### Store safeguard matrix

| Store | Concurrent-write safeguard | Deployment scope |
| --- | --- | --- |
| Memory | Compares the current in-memory revision before replacing a cloned document | One process only; examples and tests |
| SQLite | Atomic conditional `UPDATE ... WHERE id = ? AND revision = ?` | Multiple connections or processes sharing the database file |
| MongoDB | Atomic update filter on `_id`, flow name and expected revision | Distributed instances sharing MongoDB |
| Cosmos DB | Expected revision plus an `_etag` `IfMatch` precondition | Distributed instances sharing Cosmos DB |

For anything horizontally scaled, use SQLite where its shared-filesystem constraints are
acceptable, or MongoDB or Cosmos DB. The Memory store cannot coordinate separate processes.

A custom store must pass the shared behavioural suite, which asserts that two concurrent saves
from one revision produce exactly one winner and that the loser throws `SessionConflictError`:

```ts
await SessionStoreConformanceUtil.run(() => new MyStore());
```

## SessionConflictError and 409

```text
code:       SESSION_CONFLICT
statusCode: 409
message:    Session 'x' was changed or removed by another request.
```

Two sibling errors share the same 409 class: `SessionFlowMismatchError`
(`SESSION_FLOW_MISMATCH`) and `SessionFlowInvariantError` (`SESSION_FLOW_INVARIANT`).

The engine treats all three specially. It returns a failed response **without** marking the
stored session aborted and without overwriting it — the winning document must stay untouched.
Every other error marks the session `aborted` and persists the message.

<div class="callout callout--info"><span class="callout__title">The status code does not survive the engine</span><p><code>FlowEngine.run()</code> converts the error into a <code>RunResponseType</code> of <code>{ success: false, message, completed: true, session, contentType }</code>. The <code>code</code> and <code>statusCode</code> carried by <code>PicoFlowError</code> are not propagated, which is why the demo controller maps every unsuccessful result to HTTP 400. An application that needs a precise 409 must inspect the message, or call the session layer directly where the typed error is still throwable.</p></div>

## There is no automatic replay

This is the most important sentence on the page.

When a save loses the compare-and-swap, PicoFlow does not re-run the turn. Blind replay would
be unsafe, because by the time the save fails the first attempt may already have:

- called an LLM and been billed for it;
- sent a message, an email or a webhook;
- uploaded a file to a provider;
- charged a card or created an order;
- mutated a record in another system.

The session document is protected. The side effects are not.

## Handling a conflict

1. Return a retryable conflict to the caller — 409 if your adapter can express it.
2. Reload the latest session state.
3. Decide whether the original user command is still valid against that state.
4. Retry only through an idempotent application path.

Concretely, in your tool handlers:

- derive a stable operation ID or idempotency key from the session ID and the operation, and
  pass it to the downstream system;
- for high-value operations, record intent in your own database first and use a transactional
  or outbox pattern;
- treat "already done" as success, not as an error.

Session compare-and-swap guards one document. It cannot roll back an external effect.

If duplicate cross-process execution is unacceptable at all, add a distributed lock, a queue
partition, or an actor keyed by session ID around the whole run — and keep revision
compare-and-swap as the final write guard even then.

## Application rules

1. Mutate session state only through `FlowEngine` or the `SessionStore` contract. Never bypass
   the revision check.
2. Never catch `SessionConflictError` and force-write the stale document.
3. Serialise turns per session on the client too. The server is protected, but a serialised
   client avoids wasted model calls entirely.
4. Make tool side effects idempotent before allowing any request to be retried.
5. Keep `onRestoreSessionDoc()` migrations idempotent — their immediate save also participates
   in compare-and-swap.
6. Pass the current revision to deletes that must not race an update.
7. Run the conformance suite against every custom store.
8. Do not use the Memory store in any deployment with more than one process.

## Failure modes

| Symptom | Cause |
| --- | --- |
| Intermittent `was changed or removed by another request` | Two turns for one session ran concurrently, in different processes or without client serialisation |
| Conflicts under a single instance | A direct store writer, a second `FlowEngine`, or a delete racing a run |
| Duplicate charges or messages | Two attempts both reached the side effect; only the save was serialised |
| A user's last turn "disappears" | The losing request's work was never persisted — by design |
| Conflicts surface as HTTP 400 | The engine flattens the typed error; map it yourself if you need 409 |
| Conflicts every turn with a custom store | The store is not implementing the compare-and-swap contract; run the conformance suite |
| Session marked `aborted` after a conflict | Should not happen — conflict, mismatch and invariant errors deliberately skip the abort path |

Related: [Persistence and session stores](/docs/guides/persistence/),
[Error handling and completion](/docs/guides/error-handling/), and
[Session document migration](/docs/guides/migration/).
