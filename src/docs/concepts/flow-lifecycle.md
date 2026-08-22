---
title: Flow lifecycle
eyebrow: Concepts
lede: "What happens between an HTTP request arriving and the session document being written: construction, model validation, session load, the restore hook, the model and tool loop, and persistence."
source: pf/src/picoflow/flow/flow.ts
---

A `Flow` instance lives for exactly one HTTP invocation. It is constructed, bound, hydrated
from storage, run, persisted, and discarded. Nothing carries over in memory. Understanding
that sequence explains most surprising behaviour — why `init()` runs on every request, why
`onStart()` never fires on a resumed conversation, and where a mid-turn save comes from.

## The sequence

```text
FlowEngine.run({ flowName, userMessage, sessionId, config })
  └── acquire the per-session lock
      ├── construct the Flow
      │     ├── look up flowName in the registry
      │     ├── new FlowClass()
      │     ├── addContext({ config: ... })
      │     ├── await init()
      │     └── collectSteps()  ->  defineSteps()
      ├── bootstrap(sessionId, engine)
      │     ├── resolve and validate configModel()
      │     ├── steps without an override inherit the flow model
      │     ├── validate every step model selection
      │     ├── load or create the session document
      │     ├── enforce the one-flow invariant and flow-name match
      │     ├── existing session -> onRestoreSessionDoc(doc)
      │     ├── new      -> initialStep.onStart(), first save
      │     ├── existing -> read model, memory, state, context; currentStep.onRestore()
      │     └── compose the flow-wide tool registry
      ├── isBatch() -> extra pre-run checkpoint save
      ├── run(message)
      │     ├── config._concurrent -> spawnSteps()
      │     └── otherwise -> currentStep.run(message), the model/tool loop
      └── saveSession()
            ├── compact enabled memory namespaces
            ├── write memory, step state, model, context
            ├── stamp the schema version
            └── compare-and-swap save
```

## 1. Locking

`FlowEngine.run(...)` wraps everything below in a per-session FIFO mutex. Two requests
carrying the same session ID execute one after another inside one engine instance; requests
for different IDs stay concurrent. A request with no session ID skips the lock, because it
is about to create a fresh random ID that nothing else can be holding.

This lock is process-local and engine-local. It does not coordinate a second server process.
That is what the store's revision check is for.

## 2. Construction

The registry lookup happens first. An unregistered name fails immediately:

```text
FlowClass  'DemoFlow' not registered.
```

Then, in order:

**`new FlowClass()`** — your constructor. Use it only for deterministic setup such as memory
summary configuration. It runs on every request.

**`addContext({ config })`** — the request's `config` object is merged into the flow's
in-memory context under a `config` key. For a restored session this in-memory value is about
to be replaced by the stored context, which is why a new `config` cannot reconfigure a
running session.

**`await init()`** — an async hook that runs after the name is bound and context is added,
but before steps are collected and before `getFlowEngine()` is available. Use it for
initialization that needs neither the engine nor a loaded session. It also runs on every
request, so avoid mutating external systems here.

**`collectSteps()`** — calls `defineSteps()` and builds the step map keyed by step name.

## 3. Model resolution and validation

`configModel()` is resolved lazily, once, and passed through the catalog validator. Then
every registered step is examined:

- a step with no model of its own inherits the flow's selection;
- every non-logic step's effective selection is validated against the registered providers.

Both checks happen before any session I/O. A flow that names a model with no registered
provider adapter, or an unknown model on a built-in provider, fails at startup of the turn
rather than halfway through a conversation.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>This is why a typo in a model name shows up on the very first request instead of on the third turn when that step finally activates.</p></div>

## 4. Session load or create

The session layer is asked for a document. The outcome is one of:

| Situation | Result |
| --- | --- |
| No session ID supplied | A new document is created |
| ID not found in the store | A new document is created |
| Stored `runStatus` is `completed` or `aborted` | A new document is created |
| Stored flow name differs from the requested name | `SESSION_FLOW_MISMATCH` |
| Document is not a valid one-flow envelope | `SESSION_FLOW_INVARIANT` |
| Otherwise | The existing document is returned for restore |

Note the third row: presenting a finished session ID does not produce an error. You get a
new conversation and a new ID. Clients must read the `session` field from every response.

## 5. The restore hook

For an existing document, and only for an existing document, the flow's restore hook runs:

```ts
protected async onRestoreSessionDoc(
  sessionDoc: SessionType,
): Promise<SessionType | null>
```

It receives the mutable document after the store has loaded it and after the runtime has
verified that it belongs to this flow and satisfies the one-flow invariant. It runs **before**
step state, memory, model settings, context and `flow.currentStep` are read into the new
flow instance — which is exactly why it is the right place to reshape a document.

The contract is:

| Return value | Effect |
| --- | --- |
| The document (possibly mutated) | It is saved immediately, then restoration continues from it |
| `null` | A fresh session document is created and the turn proceeds as new |

The default implementation returns `null` if the document `version` does not
equal the framework's current `K.sessionDocVersion`; otherwise it returns the
document unchanged. `isSessionCurrent(doc)` checks the version, and
`sessionIdleMs(doc)` gives an override the elapsed time since the last save:

```ts
protected async onRestoreSessionDoc(
  doc: SessionType,
): Promise<SessionType | null> {
  const restored = await super.onRestoreSessionDoc(doc);
  if (!restored) return null;
  return this.sessionIdleMs(restored) >= 30 * 60_000 ? null : restored;
}
```

<div class="callout callout--note"><span class="callout__title">Restore-hook contract</span><p>The hook returns <code>Promise&lt;SessionType | null&gt;</code>. Return the document for an unchanged or migrated session, and return <code>null</code> to reset into a new session.</p></div>

Returning `null` gives the caller a **new session ID**. It does not delete the old document.
Tell your API consumers that the ID can change, and handle retention separately.

Because the returned document is saved immediately, that save participates in
compare-and-swap like any other. Keep migrations idempotent and let conflicts surface.

## 6. Hydration

For a new session:

1. the flow document is created from `defineSteps()`, with `currentStep` set from
   `initialStep()` or the first registered step;
2. the initial step's `onStart()` runs, which by default calls `onEnter()` and then
   `onCrossing(null)`;
3. any message `onCrossing` produced is pushed into that step's memory namespace; and
4. the session is saved once, before the turn runs.

For a restored session:

1. the flow's model selection, memory namespaces, per-step state, per-step model overrides
   and context are read out of the document; then
2. the current step's `onRestore()` runs.

`onStart()` never runs on a restored session, and `onRestore()` never runs on a new one. See
[Step lifecycle](/docs/concepts/step-lifecycle/).

## 7. Tool composition

`defineTool()` is called on every registered step and on the flow, and the results are merged
into one registry with unique names. This happens after hydration, so tool definitions can
depend on restored state if they need to — though a definition that varies between turns is
usually a design smell, because the model sees a different contract each time.

## 8. Running the turn

`Flow.run(message)` dispatches:

```text
context config._concurrent is true  -> spawnSteps()
otherwise                           -> currentStep.run(message)
```

The normal path enters the shared model and tool loop:

1. the executing step's prompt is built by `getPrompt()` and installed as the system message;
2. the step's selected tools are bound to the model;
3. `structOutputSchema()` is applied if the step declares one;
4. the model is invoked, with retries;
5. token usage is tallied into the session document;
6. if the response contains tool calls, each is dispatched to its `@Tool` handler (or a
   matching `@Tools` group handler), the handler's transition is applied, and the loop
   continues with another model call unless a direct message short-circuits it;
7. if the response contains no tool call, `checkResponse()` may request a retry, then
   `onResponse()` may rewrite the text or return another step class to activate.

A transition to a different top-level step **saves the session mid-turn** before the new
step's `onCrossing()` runs. So a multi-step turn produces several writes, each advancing the
revision.

Finally the response envelope is built:

```ts
{
  success: true,
  completed: step.isEnd(),
  message: /* text of the last model content */,
  session: sessionDoc.id,
  contentType: step.contentType,
}
```

`completed` is read from the step that is current *after* the turn, so a transition into
`TerminateSessionStep` reports completion on the same response that delivers the closing
message.

<div class="callout callout--note"><span class="callout__title">Note</span><p>Prefer step hooks and transition builders over overriding <code>Flow.run()</code>. An override takes on responsibility for current-step selection, completion reporting, content-type propagation, error behaviour and the response contract.</p></div>

## 9. Persistence

`saveSession()` runs at the end of the turn:

1. **compact memory** — for each namespace with summarisation enabled, older messages are
   summarised using the configured summary model, and the summary is stored alongside the
   remaining recent messages. A compaction failure is logged as a session warning and does
   not fail the turn;
2. **write memory** back into the flow document;
3. **write every step's state and model override**, stripping transient state;
4. **write the flow's model selection and context**;
5. **stamp the schema version**; and
6. **save with compare-and-swap**, using the document's current revision.

A successful save updates the in-memory revision, so later checkpoints in the same run use a
current token.

## Errors

An unhandled error anywhere in the turn is caught by the engine:

- `SESSION_CONFLICT`, `SESSION_FLOW_MISMATCH` and `SESSION_FLOW_INVARIANT` are returned as a
  failed response with the stored document left completely untouched;
- any other error sets `runStatus` to `aborted`, appends the message to the document's error
  log, and attempts to persist that state.

Either way the caller receives:

```json
{ "success": false, "completed": true, "message": "...", "session": "...", "contentType": "text/plain" }
```

An aborted session does not resume. The next request with that ID gets a new document.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/step-lifecycle/">
		<span class="card__title">Step lifecycle</span>
		<span class="card__body">The four scenarios and exactly when each step hook fires.</span>
	</a>
	<a class="card" href="/docs/guides/migration/">
		<span class="card__title">Session document migration</span>
		<span class="card__body">Using the restore hook to change a schema under running sessions.</span>
	</a>
	<a class="card" href="/docs/guides/error-handling/">
		<span class="card__title">Error handling and completion</span>
		<span class="card__body">Aborting, completing, and deleting a session.</span>
	</a>
</div>
