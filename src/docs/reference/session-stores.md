---
title: Session stores
eyebrow: Reference
lede: "The SessionStore contract, the four bundled implementations and how each enforces compare-and-swap, the conflict error, and the conformance suite a custom store must pass."
source: pf/src/picoflow/session/session-store.ts
---

A session store is the only durable dependency PicoFlow has. It persists whole session
documents and enforces optimistic concurrency; it does not interpret flows, steps, or
restore policy.

## The contract

```ts
export interface SessionStore {
  load(sessionId: string): Promise<SessionType | null>;
  create(flow: FlowType): Promise<SessionType>;
  save(sessionDoc: SessionType, expectedRevision: number): Promise<SessionType>;
  delete(sessionId: string, expectedRevision?: number): Promise<void>;
  close(): Promise<void>;
}
```

| Method | Required behaviour |
| --- | --- |
| `load` | Return the stored document without applying restoration policy. A Flow's idle-time or other restore decision belongs in `onRestoreSessionDoc()`, not the store |
| `create` | Build a document through `FlowCreator.createDoc(flow)` and persist it at `revision` 0 |
| `save` | Persist only if the stored revision equals `expectedRevision`, then return the document at `expectedRevision + 1` |
| `delete` | Compare-and-swap when a revision is supplied; unconditional when it is omitted |
| `close` | Release connections and handles |

`FlowSession` wraps the store: it asserts the one-flow invariant, stamps `saveOn`, passes the
document's current `revision` as the expected value, and copies the returned revision back onto
the in-memory document so later checkpoints in the same run use a fresh token.

## Choosing a store

The store is selected by the `SESSION_STORE` environment variable, uppercased, and defaults to
`MEMORY`. An unrecognised value throws
`No valid session store '<value>'. Use MEMORY, MONGO, COSMO, or SQLITE.`

Tests and dependency injection can bypass configuration entirely:

```ts
const engine = await FlowEngine.create({
  sessionStore: new MemorySessionStore(),
  flows: [CustomerFlow],
});
```

## The four bundled stores

| `SESSION_STORE` | Class | Compare-and-swap mechanism | Configuration |
| --- | --- | --- | --- |
| `MEMORY` | `MemorySessionStore` | Compares the current in-memory revision before replacing a structured clone | None |
| `SQLITE` | `SQLiteSession` | Atomic `UPDATE … WHERE id = ? AND revision = ?`; a row count other than 1 is a conflict | `SQLITE_PATH` |
| `MONGO` | `MongoSession` | Update filter combining `_id`, the flow name, and the expected revision; `matchedCount` other than 1 is a conflict | `MONGODB_URL`, `MONGODB_NAME`, `MONGODB_COLLECTION` |
| `COSMO` or `COSMOS` | `CosmoSession` | Expected revision plus an `_etag` `IfMatch` precondition | `COSMODB_URL`, `COSMODB_KEY`, `COSMODB_ID`, `COSMODB_SESSION_ID` |

`SQLiteSession` writes to a table named `session`, creates the parent directory if it is
missing, and defaults to `ignore/session/session.sqlite`. The `revision` column is the
compare-and-swap source of truth; older JSON-only rows are migrated by an `ALTER TABLE` on
open. Mongo's filter includes the flow name, so a store-level attempt to change the flow bound
to a session ID also fails.

### Deployment scope

| Store | Use it for |
| --- | --- |
| Memory | Examples, unit tests, and single-process local development. It does not survive a restart and cannot coordinate two processes |
| SQLite | Local durable development, and deployments where a shared filesystem is acceptable. Safe across connections and processes on one host |
| MongoDB | Horizontally scaled deployments sharing one database |
| Cosmos DB | Horizontally scaled deployments on Azure |

<div class="callout callout--warning"><span class="callout__title">Do not scale out on the Memory store</span><p>The <code>FlowEngine</code> session lock is process-local, and the Memory store's revision check is process-local too. Two application instances backed by the Memory store share nothing at all — each holds its own session map, so a session ID created on one instance simply does not exist on the other.</p></div>

## SessionConflictError

```ts
export class SessionConflictError extends PicoFlowError {
  constructor(sessionId: string);
}
```

| Property | Value |
| --- | --- |
| `code` | `SESSION_CONFLICT` |
| `statusCode` | `409` |
| `name` | `SessionConflictError` |
| `message` | `Session '<id>' was changed or removed by another request.` |

Thrown by a stale `save`, and by a `delete` that supplied a revision which no longer matches.
`FlowEngine` returns a failure envelope for it and deliberately does **not** mark the stored
session aborted — the winning document must remain untouched.

The other errors in this family:

| Class | Code | Status | Raised when |
| --- | --- | --- | --- |
| `SessionFlowMismatchError` | `SESSION_FLOW_MISMATCH` | 409 | A session ID is reused with a different `flowName` |
| `SessionFlowInvariantError` | `SESSION_FLOW_INVARIANT` | 409 | The document is not the singular one-flow shape, or its flow name is blank |
| `SessionStoreError` | `SESSION_STORE_ERROR` | 500 | A backend operation failed; carries `operation` and `sessionId` |

All four extend `PicoFlowError`, so `isSessionStoreError(error)` recognises them.

## Handling a conflict

There is no automatic replay. Blind retry is unsafe, because the losing attempt may already
have called a model, sent a message, uploaded a file, or charged a card before it lost the
save. Handle a conflict by returning a retryable error to the caller, reloading the latest
state, deciding whether the original command is still valid, and retrying only through an
idempotent path. See [Concurrency and session conflicts](/docs/guides/concurrency/).

## Custom store conformance

```ts
import { SessionStoreConformanceUtil } from "@picoflow/core";

await SessionStoreConformanceUtil.run(() => new MyStore());
```

`run(createStore)` exercises only the public contract, so the same suite applies to every
backend. It asserts that:

1. `create` returns `revision` 0 and `load` returns the stored revision;
2. `save` increments the revision;
3. ISO-looking strings inside user data survive a round trip unchanged;
4. a stale `save` and a stale revision-checked `delete` both throw `SessionConflictError`;
5. `delete` removes the document, after which `load` returns `null`;
6. two concurrent saves from one revision produce exactly one winner, and the loser throws
   `SessionConflictError`;
7. `load` returns a document that a Flow could consider stale, because restore policy is not
   the store's job; and
8. saving a document whose `flow.name` is blank throws `SessionFlowInvariantError`.

A store that passes is safe to register through `FlowEngine.create({ sessionStore })`. Run it in
CI against real infrastructure — the race check in step 6 is the one that matters most and the
one an in-process fake will not exercise honestly.

See [Persistence and session stores](/docs/guides/persistence/) for operational guidance and
[Environment variables](/docs/reference/environment-variables/) for the full configuration list.
