---
title: Persistence and session stores
eyebrow: Guides
lede: Pick a session store, configure it, and understand the difference between completing a workflow and deleting its record. Memory is the default and it does not survive a restart.
source: pf/src/picoflow/session/flow-session.ts
---

Every PicoFlow conversation is one JSON document. Choosing where that document lives is a
deployment decision you should make before the first real user, because the default is
process-local memory and loses everything on restart.

## Choosing a store

| Store | `SESSION_STORE` | Durable | Safe across processes | Use for |
| --- | --- | --- | --- | --- |
| Memory | `MEMORY` (default) | No | No | Examples, unit tests, throwaway local runs |
| SQLite | `SQLITE` | Yes | Yes, over a shared file | Local development, single-node deployments |
| MongoDB | `MONGO` | Yes | Yes | Horizontally scaled deployments |
| Cosmos DB | `COSMO` or `COSMOS` | Yes | Yes | Azure deployments |

All four implement the same contract, including revision-based compare-and-swap. The
difference is where the atomic check happens — see
[Concurrency and session conflicts](/docs/guides/concurrency/).

An unrecognised value fails fast at startup:

```text
No valid session store 'POSTGRES'. Use MEMORY, MONGO, COSMO, or SQLITE.
```

## Configuration

```bash
SESSION_STORE=SQLITE
SQLITE_PATH=ignore/session/session.sqlite   # default when unset

# SESSION_STORE=MONGO
MONGODB_URL=mongodb://localhost:27017/?directConnection=true   # required
MONGODB_NAME=picoflow
MONGODB_COLLECTION=sessions

# SESSION_STORE=COSMO
COSMODB_URL=http://localhost:8081/
COSMODB_KEY=...
COSMODB_ID=picoflow
COSMODB_SESSION_ID=sessions
```

<div class="callout callout--danger"><span class="callout__title">DOCUMENT_DB is dead configuration</span><p>The demo's <code>.env-example</code> sets <code>DOCUMENT_DB=COSMO</code>. No PicoFlow source reads that variable. The store is selected exclusively from <code>SESSION_STORE</code>, read in <code>CoreConfig</code> and defaulting to <code>MEMORY</code>. A project that only sets <code>DOCUMENT_DB</code> silently runs on the in-memory store and loses every session on restart.</p></div>

Configuration is read once, when `FlowEngine` is constructed, through a `ConfigManager` whose
precedence is explicit values, then the environment, then a dotenv file. Changing an
environment variable at runtime has no effect.

## What the document contains

```text
Session document
├── id                    uuid, returned as CHAT_SESSION_ID
├── revision              integer compare-and-swap token, incremented on every write
├── version               session schema version (K.sessionDocVersion)
├── runStatus             "running" | "completed" | "aborted"
├── createdOn, saveOn     Date
├── tokens                input/output/total plus reasoning, visible, cached breakdowns
├── log, error, warn, debug, verbose    structured SessionLogger entries
└── flow                  exactly one envelope — never an array
    ├── name              the registered flow name, permanently bound to this ID
    ├── model             { provider, name, params, retryAttempts? } with credential keys stripped
    ├── context           the first request's config
    ├── memory            namespace -> { messages, summary?, summarizedThroughId? }
    ├── steps             [{ name, state, model? }]
    ├── currentStep       the one durable cursor, or null
    └── sequence          [{ level, stepName }] execution trace
```

`revision` and `version` are unrelated. `revision` guards writes; `version` describes the
schema and drives [migration](/docs/guides/migration/).

<div class="callout callout--note"><span class="callout__title">Only metadata dates are revived</span><p>Stores hydrate <code>createdOn</code> and <code>saveOn</code> back into <code>Date</code> objects. Anything date-shaped inside step state, memory or context is deliberately left as the string you stored. Do not assume <code>getState("dueDate")</code> returns a <code>Date</code> after a restore.</p></div>

## The store contract

```ts
export interface SessionStore {
  load(sessionId: string): Promise<SessionType | null>;
  create(flow: FlowType): Promise<SessionType>;
  save(sessionDoc: SessionType, expectedRevision: number): Promise<SessionType>;
  delete(sessionId: string, expectedRevision?: number): Promise<void>;
  close(): Promise<void>;
}
```

`load()` applies no policy. It does not check a Flow's idle rule, run status or schema version — those
decisions belong to `Flow.onRestoreSessionDoc()`. `save()` must reject a stale revision with
`SessionConflictError`.

Inject an alternative implementation through the engine, which is also how tests substitute a
store:

```ts
FlowEngine.create({
  flows: [CustomerFlow],
  providers: [...],
  sessionStore: new MyStore(),
});
```

Then verify it against the shared behavioural suite:

```ts
await SessionStoreConformanceUtil.run(() => new MyStore());
```

The suite covers revision numbering, conflict on a stale save, conflict on a stale delete,
preservation of ISO-looking strings in user data, and the requirement that two concurrent
saves from one revision produce exactly one winner.

## Flow-owned session idle policy

The store does not evaluate session age. A Flow that needs an idle rule calls
`sessionIdleMs(doc)` from `onRestoreSessionDoc()` and returns `null` to start a
new session. Retention and cleanup remain separate application responsibilities.

## Completion versus deletion

These are different operations with different consequences.

| Operation | What it does | Document | Session ID |
| --- | --- | --- | --- |
| `TerminateSessionStep` | Sets `runStatus = "completed"` in `onEnter()`, reports `isEnd()` | Retained | Cannot be resumed; a new request with it creates a new session |
| `sessionCompleted()` / `markCompleted()` | Sets `runStatus = "completed"` directly | Retained | Same |
| Unhandled error | Engine sets `runStatus = "aborted"` and persists the message | Retained | Same |
| `deleteSession(id)` | Removes the row or document, under the same lock and revision check as a write | Gone | Gone |

```ts
// Completing a conversation
return go(TerminateSessionStep).withPrompt("Confirm the saved customer.");

// Deleting the record
await flowEngine.deleteSession(sessionId);
```

A completed session is a record you can audit: transcript, state, token totals, log entries.
Delete only when the record itself must not exist — a retention policy, a privacy request.

`deleteSession()` returns `{ success, session }` and, on failure, a `message`. Note that it
is not a `RunResponseType`; it has no `completed` or `contentType`.

<div class="callout callout--warning"><span class="callout__title">endChat() is deprecated</span><p><code>FlowEngine.endChat(sessionId)</code> now simply delegates to <code>deleteSession()</code>. The name is misleading: ending a conversation does not imply destroying its record. Call <code>deleteSession()</code> directly, and migrate any <code>POST /ai/end</code> style endpoint to an HTTP <code>DELETE</code> route so the API stops conflating completion with deletion.</p></div>

## Failure modes

| Symptom | Cause |
| --- | --- |
| Sessions vanish after a restart | `SESSION_STORE` unset or set to `MEMORY` |
| Sessions vanish after a deploy, with a durable store | `DOCUMENT_DB` was set instead of `SESSION_STORE` |
| Conversations restart mid-way | A Flow-owned restore policy returned `null`; inspect its idle or validation rule |
| Conversations restart after a release | `onRestoreSessionDoc()` reset them on a schema version bump |
| `Configuration value 'MONGODB_URL' is required.` | Mongo selected without a connection string |
| `SessionConflictError` on save | Another writer advanced the revision first |
| `Session 'x' belongs to flow 'A', not 'B'.` | A session ID was reused with a different `flowName` |
| `Session 'x' violates the one-flow invariant` | The document was hand-edited or written by something other than PicoFlow |
| Dates come back as strings | Only session metadata dates are revived |

Related: [The session document](/docs/concepts/session-document/),
[Concurrency and session conflicts](/docs/guides/concurrency/), and
[Session stores](/docs/reference/session-stores/).
