---
title: Session document migration
eyebrow: Guides
lede: onRestoreSessionDoc() is the compatibility boundary for a stored conversation. Without an override, any schema version bump silently restarts every in-flight session.
source: pf/src/picoflow/flow/flow.ts
---

You need this before shipping any change that alters the persisted shape of a session: a step
rename, a memory namespace rename, a state restructure, or an upgrade that changes
`K.sessionDocVersion`. Live conversations are stored documents, and a deploy is a schema
migration whether or not you treat it as one.

## The real signature

```ts
protected async onRestoreSessionDoc(
  sessionDoc: SessionType,
): Promise<SessionType | null>
```

Two outcomes:

| Return | Runtime behaviour |
| --- | --- |
| The document | It is saved immediately using its current revision, then restoration continues from it |
| `null` | A fresh session document is created from the current flow definition and treated as new |

Mutate the document in place and return it to migrate. Return `null` to reset.

<div class="callout callout--note"><span class="callout__title">Current restore-hook contract</span><p><code>onRestoreSessionDoc()</code> returns <code>Promise&lt;SessionType | null&gt;</code>. Return the document for both unchanged and migrated sessions; mutate it in place when needed. Return <code>null</code> to start a new session. The returned document is persisted before restoration continues.</p></div>

## When the hook runs

It runs during `bootstrap()`, after the store has loaded the document and after the runtime
has verified that it belongs to this flow and satisfies the one-flow envelope invariant. It
runs before step state, memory, model settings, context and `flow.currentStep` are read into
the new flow instance.

All of these must be true:

- a session ID was supplied and exists in the configured store;
- `runStatus` is neither `completed` nor `aborted`;
- the stored `flow.name` equals the requested registered flow name;
- the document passes the structural one-flow invariant.

Anything else bypasses the hook entirely:

| Situation | What happens instead |
| --- | --- |
| No session ID, or ID not found | A new session is created; the hook never runs |
| `runStatus` is `completed` or `aborted` | A new session is created; the hook never runs |
| Stored flow name differs | `SessionFlowMismatchError` (`SESSION_FLOW_MISMATCH`, 409) before the hook |
| Malformed flow envelope | `SessionFlowInvariantError` (`SESSION_FLOW_INVARIANT`, 409) before the hook |

The last two matter: **a renamed flow cannot migrate its own old sessions**, because the name
check happens first. Keep the registered name stable, or override the static `id` so it
survives a class rename.

<div class="callout callout--note"><span class="callout__title">Restoring always writes</span><p>When the hook returns a document, the runtime persists it immediately — even if you changed nothing. Every restored turn therefore begins with one extra store write that participates in compare-and-swap. Keep the hook cheap and idempotent.</p></div>

## The default policy is stricter than it looks

```ts
protected async onRestoreSessionDoc(sessionDoc: SessionType) {
  if (!this.isSessionCurrent(sessionDoc)) return null;
  return sessionDoc;
}
```

`isSessionCurrent()` is an exact equality check against `K.sessionDocVersion`, and
`saveSession()` stamps that constant onto every document it writes. So without an override,
**any** version difference — including a PicoFlow upgrade that bumps the constant — resets
every running conversation. Users see a session ID change and a workflow that starts over.

Two protected helpers are available to an override:

```ts
this.sessionIdleMs(doc);      // milliseconds since saveOn
this.isSessionCurrent(doc);   // doc.version === K.sessionDocVersion
```

## Versioned in-place migration

Handle each historical version explicitly, stamp the current constant, and return the
document.

```ts
import { Flow, K, type SessionType } from "@picoflow/core";

const MIN_SUPPORTED_VERSION = 1.4;

export class CustomerFlow extends Flow {
  protected async onRestoreSessionDoc(
    doc: SessionType,
  ): Promise<SessionType | null> {
    if (doc.version > K.sessionDocVersion) return null;
    if (doc.version < MIN_SUPPORTED_VERSION) return null;
    if (this.isSessionCurrent(doc)) return doc;

    if (doc.version < 1.5) {
      const oldStep = doc.flow.steps.find(
        (step) => step.name === "CustomerNameStep",
      );

      if (oldStep) {
        const oldState = oldStep.state as Record<string, unknown>;
        oldStep.name = "CollectCustomerStep";
        oldStep.state = {
          customer: { displayName: oldState["name"] ?? null },
        };
      }

      if (doc.flow.currentStep === "CustomerNameStep") {
        doc.flow.currentStep = "CollectCustomerStep";
      }

      for (const entry of doc.flow.sequence) {
        if (typeof entry !== "string" && entry.stepName === "CustomerNameStep") {
          entry.stepName = "CollectCustomerStep";
        }
      }

      const oldMemory = doc.flow.memory["customer-name"];
      if (oldMemory) {
        doc.flow.memory["customer"] = oldMemory;
        delete doc.flow.memory["customer-name"];
      }
    }

    doc.version = K.sessionDocVersion;
    return doc;
  }
}
```

Note `typeof entry !== "string"` in the sequence loop. The runtime normalises legacy string
sequence entries into `{ level, stepName }` objects *after* the hook returns, so inside the
hook you may still encounter either shape.

`K.sessionDocVersion` is currently `1.5` — a decimal, not an integer. Compare with explicit
numeric constants rather than assuming whole-number steps.

### A step rename touches six places

Renaming one step class changes all of these at once:

1. the entry in `flow.steps[].name` under which its state is stored;
2. the value of `flow.currentStep` if that step was active;
3. every matching `flow.sequence[].stepName`;
4. its default memory namespace, if `useMemory(...)` was not used;
5. any `flow.getStepState(OldStepClass, ...)` elsewhere in your code;
6. any application query that searches sessions by step name.

Migrate them together or the restored session will fail with
`Step 'CustomerNameStep' is not defined in flow 'CustomerFlow'.`

## Resetting incompatible sessions

Reset when preserving the conversation would be misleading or unsafe:

```ts
protected async onRestoreSessionDoc(
  doc: SessionType,
): Promise<SessionType | null> {
  if (doc.version < MIN_SUPPORTED_VERSION) return null;
  return doc;
}
```

Reset consequences:

- the caller receives a **different session ID** in the response and the `CHAT_SESSION_ID`
  header — tell API consumers this can happen;
- the old document is **not deleted**; retention is a separate policy;
- the user gets a conversation that starts over with no explanation unless you provide one.
  Log a reset reason, or have the new flow open with an appropriate message.

Always reject a document whose version is *newer* than the running code. Accepting it would
let the next normal save stamp it back down to the older version and destroy fields this
release does not understand.

## Migration rules

1. Make every migration idempotent. Retries must not duplicate or corrupt data.
2. Mutate only the supplied document, then return it.
3. Preserve `id`, `revision`, `flow.name` and the required envelope fields.
4. Keep `flow.currentStep` either `null` or a step registered by the current `defineSteps()`.
5. Migrate state, memory namespaces, model configuration, context, cursor and sequence
   together when a change crosses those boundaries.
6. Do not assume dates inside user state are `Date` objects; stores hydrate session metadata
   only.
7. Let compare-and-swap conflicts surface. Reloading and retrying is safer than overwriting
   another request's migration.
8. Handle both `string` and `{ level, stepName }` sequence entries.
9. Test migration from every supported historical version, repeated migration, reset
   behaviour, the returned session ID, and the first resumed user turn.

<div class="callout callout--warning"><span class="callout__title">Use the restore hook</span><p><code>onSessionDoc()</code> is not a PicoFlow hook. Put session compatibility, migration, and reset logic in <code>onRestoreSessionDoc()</code>, whose return value determines whether the loaded document is restored or replaced.</p></div>

## Failure modes

| Symptom | Cause |
| --- | --- |
| Every session restarts after a release | No override, and the schema version changed |
| `Step 'X' is not defined in flow 'Y'.` on resume | A rename was migrated in `steps[]` but not in `currentStep` |
| State appears empty after a rename | The step document name was not migrated, so a fresh empty state was used |
| History disappears after a rename | The memory namespace was not migrated with the step |
| `SESSION_FLOW_MISMATCH` before any migration runs | The registered flow name changed |
| `SessionConflictError` during restore | The immediate migration save lost a compare-and-swap race |
| Fields silently disappear | A newer document was accepted and re-saved by older code |

Related: [The session document](/docs/concepts/session-document/),
[Persistence and session stores](/docs/guides/persistence/), and
[Concurrency and session conflicts](/docs/guides/concurrency/).
