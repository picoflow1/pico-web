---
title: The session document
eyebrow: Concepts
lede: "One JSON document holds everything a conversation needs to resume: identity, status, token accounting, structured logs, and a single flow envelope. Writes are guarded by an integer revision."
source: pf/src/picoflow/types/flow-types.ts
---

A PicoFlow session is a single document. Not a set of rows, not a checkpoint stream — one
JSON object, loaded whole at the start of a turn and written whole at the end. That choice
is what makes the persistence model easy to reason about, and it is also why concurrent
writes need an explicit guard.

## The document tree

```text
Session document
├── id                  session identifier (UUID v4)
├── revision            compare-and-swap token, incremented on every write
├── version             session-schema version
├── createdOn           creation timestamp
├── saveOn              last successful write
├── runStatus           'running' | 'completed' | 'aborted'
├── tokens              provider-neutral token accounting
├── log / error / warn / debug / verbose
└── flow                exactly one — not flows[]
    ├── name            permanently bound to this session ID
    ├── model           { provider, name, params }
    ├── context         session-wide config
    ├── memory          namespace -> conversation history
    ├── steps           [{ name, state, model? }]
    ├── currentStep     the one durable cursor, or null
    └── sequence        [{ level, stepName }]
```

## Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Generated as a UUID v4 when the session is created. |
| `revision` | integer | Incremented by the store on every successful write. This is the concurrency token, not a schema version. |
| `version` | number | The framework's session-document schema version, stamped on every normal save. |
| `createdOn` | Date | Set once. |
| `saveOn` | Date | Updated on every save; the baseline for any Flow-owned idle policy. |
| `runStatus` | enum | `running`, `completed`, or `aborted`. |
| `tokens` | object | Cumulative token counters for the whole session. |
| `log`, `error`, `warn`, `debug`, `verbose` | arrays | Structured entries written by `SessionLogger`. |

### runStatus

`running` is the normal state. `TerminateSessionStep` sets `completed`, as does an explicit
`sessionCompleted()` call on a step. An unhandled flow error sets `aborted` and attempts to
persist the error before returning `success: false`.

Neither terminal status resumes. A request that presents a completed or aborted session ID
gets a brand-new session document with a new ID, rather than an error.

### Token accounting

`tokens` is provider-neutral. `inputTokens`, `outputTokens` and `totalTokens` are the
billable totals; the remaining fields are breakdowns of those totals, retained because
providers price them differently.

| Field | Relationship |
| --- | --- |
| `inputTokens` | Total input charged, including cached input where reported |
| `outputTokens` | Total output charged, including reasoning/thinking tokens |
| `totalTokens` | Combined |
| `reasoningTokens` | A subset of `outputTokens`. OpenAI calls these reasoning tokens; Gemini and Claude call them thoughts/thinking |
| `visibleOutputTokens` | `outputTokens` less `reasoningTokens` |
| `cachedInputTokens` | A subset of `inputTokens` — cache reads |
| `cacheCreationInputTokens` | A subset of `inputTokens` — cache writes |

Counters accumulate across every model call in the session, including the repeated calls
inside a tool loop and any memory-summary calls.

## The flow envelope

There is exactly one, and it is an object, not an array. See
[One flow per session](/docs/concepts/one-flow-per-session/) for why that matters.

### name

The registered flow name. It is validated on every load: the requested `flowName` must equal
this value, or the request fails with `SESSION_FLOW_MISMATCH` before any restore logic runs.

### model

The flow's resolved default model as `{ provider, name, params, retryAttempts? }`. It is written on every
save and read back on restore, which means a restored session keeps the model it started
with even if `configModel()` has since changed in source. Step-level overrides are stored
separately, on the step document.

### context

Session-wide configuration. Initialised from the first request's `config` object, stored
under a `config` key, and read with `getContext<T>("config.something")`.

Context is not re-read from later requests. Sending a different `config` on a restored
session does not reconfigure it.

### memory

A map from namespace to conversation history:

```ts
memory: {
  "hotel-explore": {
    messages: [ /* serialized LangChain messages */ ],
    summary: "The user is looking for a hotel in Paris ...",
    summarizedThroughId: "ExploreStep|2026-02-11T09:14:02.113Z|4821990312",
  },
}
```

Each message carries `id`, `type` (`system` | `human` | `ai` | `tool`), `content`,
`timestamp`, `name`, and the tool-call fields where relevant. Message IDs are step-attributed
— the step name is the first segment — which is how crossing detection and persistence
attribute a message to its owner.

`summary` and `summarizedThroughId` appear only for namespaces where compaction is enabled.

### steps

One entry per registered step:

```ts
steps: [
  { name: "ExploreStep", state: { criteria: { city: "Paris" } } },
  { name: "PresentStep", state: {}, model: { provider: "openai", name: "gpt-4o", params: { temperature: 0.5 }, retryAttempts: 3 } },
]
```

`model` is present only when the step's effective selection differs from the flow default.
A step that inherits the flow model stores no model key at all, which keeps the document
small and makes an override visible at a glance.

Two keys inside `state` are written by the framework rather than by your code:

| Key | Written by | Meaning |
| --- | --- | --- |
| `_saveOn` | Every `saveState(...)` call | Timestamp of the last state write for that step |
| `_prompt` | `.withPrompt(...)` on a transition | The system prompt the destination step should use; the base `getPrompt()` returns it |

Transient state is stored in memory under a `_transient` key and is explicitly stripped when
the step is written to the document. It never reaches the store.

### currentStep

The durable cursor: a step-name string, or `null` before a flow has established one. There is
no active flag on a step document. A terminal session can retain the name of its terminal step
(for example, `TerminateSessionStep`); use `runStatus`, not `currentStep` alone, to decide
whether a session can resume.

### sequence

An append-only execution trail:

```ts
sequence: [
  { level: 1, stepName: "ExploreStep" },
  { level: 1, stepName: "PresentStep" },
  { level: 2, stepName: "PriceCheckStep" },
]
```

`level` is the nesting depth. Level 1 entries are top-level `goto` transitions. Deeper
levels are `runStep(...)`/`runSteps(...)` children, which execute inside the parent's turn
and never move the cursor. This is the record you read when asking "how did this
conversation get here".

Legacy documents that stored bare strings are normalised to level 1 on load.

## Dates are only partially hydrated

JSON stores serialise `Date` values to strings. On load, PicoFlow deliberately revives only
session metadata: `createdOn`, `saveOn`, and the integer `revision`.

Everything under `flow` — including your step state — is left as the store returned it.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>A <code>Date</code> you write with <code>saveState({ bookedOn: new Date() })</code> comes back as a string on the next turn. Store timestamps as ISO strings or epoch numbers, and parse them explicitly when you read them. Migration code must make the same assumption.</p></div>

## Revision compare-and-swap

Every document carries an integer `revision`. It is the write token, and it is the reason
two concurrent requests cannot silently lose each other's work.

```text
load document at revision 7
  -> run the turn and mutate the private loaded copy
  -> save(document, expectedRevision = 7)
       -> success: the store atomically writes revision 8
       -> stale or missing: SessionConflictError
```

Only one writer can win from a given revision. After every successful save, PicoFlow updates
the in-memory document to the revision the store returned, so subsequent checkpoints in the
same run — a cross-step save, an immediate migration save, the final save — all use a
current token.

### How each store implements it

| Store | Mechanism | Deployment scope |
| --- | --- | --- |
| Memory | Compares the current in-memory revision before replacing a cloned document | One process. Examples and tests only. |
| SQLite | Atomic conditional `UPDATE ... WHERE id = ? AND revision = ?` | Multiple connections or processes sharing the database file |
| MongoDB | Atomic update filter on `_id`, flow name, and expected revision | Distributed instances sharing MongoDB |
| Cosmos DB | Expected revision plus an `_etag` `IfMatch` precondition | Distributed instances sharing Cosmos DB |

The `MEMORY` store is the default. It cannot coordinate writers in separate processes, and
its contents vanish on restart. Set `SESSION_STORE` to `SQLITE`, `MONGO` or `COSMO` for
anything durable.

### Two layers, not one

Compare-and-swap is the second of two layers. The first is a per-session FIFO mutex inside
`FlowEngine`, which serialises complete runs for the same session ID within one process. It
covers the common case — a user double-tapping send — without producing conflicts at all.

The store's compare-and-swap covers what the mutex cannot: a second server process, another
engine instance, or a direct store writer. Keep both. See
[Concurrency and session conflicts](/docs/guides/concurrency/).

### Conflicts are surfaced, not resolved

A losing save throws `SessionConflictError` with code `SESSION_CONFLICT` and
`statusCode: 409`. PicoFlow does not mark the session aborted, does not overwrite the
winning document with the loser's error, and does not replay the run.

Blind replay would be unsafe: the losing attempt may already have called a model, sent a
message, uploaded a file, or charged a card before it lost the save. Session compare-and-swap
protects the document; it cannot roll back an external side effect. Make tool side effects
idempotent before you allow a retry.

## The schema version

`version` is stamped with the framework's current `K.sessionDocVersion` on every normal
save. It exists so `onRestoreSessionDoc()` can make migrations ordered and idempotent.

It is not the same as `revision`. `revision` changes on every write; `version` changes only
when the document's schema changes.

<div class="callout callout--danger"><span class="callout__title">Never silently accept a newer version</span><p>If a stored document's <code>version</code> is higher than the running code's, a later normal save will stamp it back down and may destroy fields this build does not understand. Reject or reset explicitly.</p></div>

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/one-flow-per-session/">
		<span class="card__title">One flow per session</span>
		<span class="card__body">Why the flow envelope is singular and what that means for your API.</span>
	</a>
	<a class="card" href="/docs/concepts/flow-lifecycle/">
		<span class="card__title">Flow lifecycle</span>
		<span class="card__body">Where in a turn the document is loaded, checkpointed, and saved.</span>
	</a>
	<a class="card" href="/docs/guides/migration/">
		<span class="card__title">Session document migration</span>
		<span class="card__body">Changing the shape of a document that running conversations depend on.</span>
	</a>
	<a class="card" href="/docs/concepts/basic-flow-session/">
		<span class="card__title">Annotated BasicFlow session</span>
		<span class="card__body">Read a sanitized completed run: cursor, sequence, memory, state, tokens, and diagnostics.</span>
	</a>
</div>
