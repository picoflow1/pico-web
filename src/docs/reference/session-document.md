---
title: Session document schema
eyebrow: Reference
lede: "Every field PicoFlow persists: the session envelope, the single flow object, step documents, memory namespaces, the execution sequence, token accounting, and the log arrays."
source: pf/src/picoflow/types/flow-types.ts
---

One session document contains exactly one flow envelope. The shape below is the Zod schema in
`pf/src/picoflow/types/flow-types.ts`, which is the authority — not the abbreviated tree in the
developer guide.

```jsonc
{
  "id": "b3f0…",
  "revision": 7,
  "version": 1.5,
  "runStatus": "running",
  "createdOn": "2026-03-04T05:06:07.000Z",
  "saveOn": "2026-03-04T05:12:41.113Z",
  "expireAfter": 600,
  "flow": {
    "name": "HotelFlow",
    "model": { "provider": "openai", "name": "gpt-4o", "params": {} },
    "context": { "config": { "tenantId": "demo" } },
    "memory": { "hotel-explore": { "messages": [], "summary": "…" } },
    "steps": [{ "name": "ExploreStep", "state": {} }],
    "currentStep": "PresentStep",
    "sequence": [{ "level": 1, "stepName": "ExploreStep" }]
  },
  "tokens": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 },
  "log": [],
  "error": [],
  "warn": [],
  "debug": [],
  "verbose": []
}
```

## The envelope

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | non-empty string | The session ID. A UUID v4 at creation |
| `revision` | non-negative integer | The compare-and-swap token. Incremented by the store on every successful write |
| `version` | number | The document schema version. Currently `K.sessionDocVersion`, `1.5` |
| `runStatus` | `running`, `completed`, `aborted` | Lifecycle state |
| `createdOn` | Date | Creation timestamp |
| `saveOn` | Date | Last successful write; the expiration baseline |
| `expireAfter` | number | Lifetime in **seconds**, copied from `SESSION_EXPIRATION` at creation |
| `flow` | object | The one flow envelope. Never an array |
| `tokens` | object | Provider-neutral token accounting |
| `log`, `error`, `warn`, `debug`, `verbose` | object arrays | Structured session log entries |

<div class="callout callout--note"><span class="callout__title">revision is not version</span><p><code>revision</code> is the concurrency token the store compares and swaps on. <code>version</code> is the document schema version your migration code branches on. They change for entirely different reasons, and <code>saveSession()</code> stamps <code>version</code> on every write.</p></div>

The session tree includes the diagnostic arrays and uses `flow.currentStep` as
the durable cursor. There is no separate `flow.start` field.

### Expiration

`expireAfter` is copied into the document once, at creation, from `CoreConfig.sessionExpiration`
(default `600`). Changing `SESSION_EXPIRATION` therefore affects new sessions only. The default
`Flow.onRestoreSessionDoc()` treats a document as expired when
`Date.now() - saveOn > expireAfter * 1000`. Stores deliberately do not apply this policy —
`load()` returns a document regardless of its restoration eligibility.

## The flow object

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | non-empty string | The registered flow name. Permanently bound to this session ID |
| `model` | `{ provider, name, params }` | The resolved flow default, with sensitive params stripped |
| `context` | object | Session-wide configuration, seeded from the first request's `config` |
| `memory` | record of namespace to memory document | Conversation history per namespace |
| `steps` | array of step documents | One entry per registered step |
| `currentStep` | string or `null` | The single durable cursor |
| `sequence` | array of sequence items | Ordered step activation history |

The one-flow invariant is asserted on load, before every save, and inside `nextSessionRevision()`.
A violation raises `SessionFlowInvariantError` with code `SESSION_FLOW_INVARIANT` and
`statusCode` 409. A request that reuses a session ID under a different `flowName` raises
`SessionFlowMismatchError` (`SESSION_FLOW_MISMATCH`, 409) before the restore hook can run.

### Step documents

```ts
type StepType = {
  name: string;
  state: object;
  model?: { provider: string; name: string; params: Record<string, any> };
};
```

`name` is `Step.id`, which defaults to the class name — renaming the class is a schema
migration. `state` is written with the `_transient` subtree removed, and carries a `_saveOn`
timestamp stamped by `saveState()`. Transition-supplied prompts are stored here as `_prompt`.

`model` is present only when the step's resolved selection differs from the flow's. Logic steps
never write one. Restoring a step document whose `model` has a blank `provider` throws.

### Memory namespaces

```ts
type MemoryType = {
  messages: ChatMessageType[];
  summary?: string;
  summarizedThroughId?: string;
};
```

Namespace keys must match `/^[A-Za-z][A-Za-z0-9_-]{0,127}$/` and may not be `__proto__`,
`constructor`, or `prototype`. Each persisted message is:

| Field | Notes |
| --- | --- |
| `id` | `genMessageId()` output — step name, timestamp, and a random suffix joined by pipes |
| `type` | `system`, `human`, `ai`, or `tool` |
| `content` | Flattened to text |
| `timestamp` | Stamped at write time |
| `name` | Tool name for tool messages, otherwise empty |
| `tool_call_id` | Required on tool messages; a missing value fails restore |
| `status` | `success` or `error`, on tool messages |
| `tool_calls` | `{ name, args, id }` entries on AI messages that requested tools |
| `additional_kwargs` | Written only when non-empty; carries the `direct` and `stopTool` hints |

`summary` and `summarizedThroughId` appear only for namespaces with compaction enabled.
Pre-1.17 array-shaped memory documents are converted to this map by `Memory.normalizeDoc()`.

### The execution sequence

```ts
type FlowSequenceItemType = {
  level: number;   // integer, minimum 1
  stepName: string;
};
```

An entry is appended by `Flow.goto()` and by `Flow.enterChild()`. `level` is `1` for the
top-level cursor and increments for each nesting depth opened by `runStep()` or `runSteps()`,
so a trace of nested work stays readable.

<div class="callout callout--warning"><span class="callout__title">Legacy string entries</span><p>Older documents stored bare step-name strings in <code>sequence</code>. <code>Flow.bootstrap()</code> normalises each one to <code>{ level: 1, stepName }</code> — but only <em>after</em> <code>onRestoreSessionDoc()</code> has run. Migration code that walks the sequence must therefore handle both strings and objects, or leave string entries alone for the normaliser.</p></div>

## Token accounting

```ts
type TokenUsageType = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  visibleOutputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
};
```

`inputTokens`, `outputTokens`, and `totalTokens` are the billable totals. The rest are
breakdowns of those totals, retained because providers price them differently:
`reasoningTokens` is a subset of output, `visibleOutputTokens` is output less reasoning, and
the two cache fields are subsets of input.

Totals are accumulated by `Flow.tallyToken()` from both the LangChain-normalised
`usage_metadata` and the provider-only breakdowns in `response_metadata.usage`. Gemini reports
thoughts separately from candidate output, so PicoFlow adds them; OpenAI and Claude already
include reasoning in their reported output total. Structured output and some adapters return no
usage metadata at all, in which case nothing is added.

## Log arrays

`SessionLogger` appends to `log`, `error`, `warn`, `debug`, or `verbose`. Each entry is
`{ timestamp, level, message }` merged with any extra JSON supplied at the call site.

The runtime writes here for hallucinated tools, missing tool handlers, model retry attempts,
skipped memory compaction, batch progress, and aborted runs.

## Date hydration

Stores revive `createdOn` and `saveOn` deliberately and normalise `revision`. They do **not**
walk user data: an ISO-looking string inside `flow.context` or a step's `state` comes back as a
string. This is asserted by the store conformance suite. Do not assume dates inside your own
state are `Date` objects after a restore.

See [The session document](/docs/concepts/session-document/) for the conceptual view,
[Session stores](/docs/reference/session-stores/) for the persistence contract, and
[Session document migration](/docs/guides/migration/) for changing this shape safely.
