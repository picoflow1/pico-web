---
title: State, memory, context, transient
eyebrow: Concepts
lede: PicoFlow stores four different kinds of data with four different lifetimes. Choosing the wrong one is the most common source of bugs that only appear on the second turn.
source: pico-demo/docs/step-authoring-contract.md
---

Every value your flow handles belongs in exactly one of four places. They are easy to
confuse because three of them survive a turn and two of them are keyed by step. Get this
page right and most of PicoFlow's surprising behaviour stops being surprising.

## The four at a glance

| | What it is | Scope | Lifetime | Persisted | Primary API |
| --- | --- | --- | --- | --- | --- |
| **State** | Arbitrary durable JSON | One step | Until overwritten or the session ends | Yes | `saveState` / `getState` |
| **Memory** | LangChain conversation history | One namespace, shared by any step that selects it | Until erased or compacted | Yes | `useMemory` / `getMemory` |
| **Context** | Session-wide configuration | The whole flow | Set once, at session creation | Yes | `getContext` |
| **Transient** | Scratch data | One step | One HTTP invocation | **No** | `saveTransientState` |

The quickest decision procedure:

- Is it a domain value the conversation collected? → **state**, on the step that owns it.
- Is it something the model needs to remember it said? → **memory**.
- Was it supplied by the caller when the session started? → **context**.
- Is it a handoff between two steps inside one request? → **transient**.

## State

Durable, per-step JSON. This is where domain data lives: the captured date of birth, the
selected hotel, the validated customer record.

### Reading and writing

```ts
this.saveState({ email: "user@example.com" });

const email = this.getState<string>("email");
const all = this.getState();              // the whole state object
const city = this.getState<string>("criteria.city");   // dotted paths work
this.removeState("email");
```

`getState<T>(key?)` reads a nested key with a lodash-style path, or the entire object when
called with no argument.

### saveState replaces the first key and merges the rest

`saveState` is not a plain merge and it is not a plain assignment. It removes the **first**
top-level key of the supplied object from existing state, then deep-merges the whole object
in.

```ts
this.saveState({ criteria: { city: "Paris", nights: 3 } });
this.saveState({ criteria: { city: "Berlin" } });
// criteria is now { city: "Berlin" } — nights is gone.
```

That replacement behaviour is usually what you want: re-saving a structured value should not
leave stale sub-keys behind. But it applies only to the first key.

```ts
this.saveState({ criteria: { city: "Berlin" }, filters: { wifi: true } });
// criteria is REPLACED. filters is deep-MERGED with whatever was there.
```

<div class="callout callout--warning"><span class="callout__title">Save one top-level key per call</span><p>Multi-key <code>saveState</code> calls have inconsistent semantics: the first key is replaced, the rest are deep-merged. Call <code>saveState</code> once per top-level key and the behaviour is always &quot;replace this key&quot;.</p></div>

Every `saveState` also writes a `_saveOn` timestamp into the step's state. `_prompt` is
written the same way by `.withPrompt(...)`. Both are framework keys; do not use those names.

### Cross-step state

A step can read and write another registered step's durable state through the flow:

```ts
const name = this.flow.getStepState<string>(NameStep, "name");
this.flow.saveStepState(AddressStep, { verified: true });
```

`DOBStep` does exactly this to personalise its prompt with the name that `NameStep`
collected. The step class is the key, which is another reason class names are schema.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Prefer reading another step's state over duplicating the value into your own. Two copies of a customer record in one session document will diverge.</p></div>

### What state is not for

State is serialised to the session store as plain JSON. It is not a place for class
instances, functions, or live handles. And because stores hydrate only session metadata,
a `Date` you save comes back as a string. Store ISO strings or epoch numbers and parse them
on read.

## Memory

Persisted LangChain conversation history, partitioned by **namespace**. This is what the
model actually sees as its message history.

### Namespaces

A step selects its namespace at registration time:

```ts
protected defineSteps(): Step[] {
  return [
    new NameStep(this).useMemory("default"),
    new AddressStep(this).useMemory("default"),
    new DOBStep(this).useMemory("default"),
    new InContextStep(this).useMemory("separate"),
    new TerminateSessionStep(this).useMemory("temp"),
  ];
}
```

**The default namespace is the step's class name.** A step that never calls `useMemory(...)`
gets a private history under its own name.

Steps that share a namespace share history. That is the mechanism for conversational
continuity across a multi-stage flow: `NameStep`, `AddressStep` and `DOBStep` above all read
and write `"default"`, so by the time the user reaches the date-of-birth stage the model can
still see what they said about their name.

Separate namespaces isolate roles and keep tool traces from one stage out of another's
context window — which is both a quality decision and a cost decision.

Namespace names become persisted object keys, so they are validated: they must start with a
letter, contain only letters, digits, `_` and `-`, be at most 128 characters, and must not
be `__proto__`, `constructor` or `prototype`.

### Working with memory

| API | Purpose |
| --- | --- |
| `useMemory(namespace)` | Select this step's namespace. Chainable, used in `defineSteps()` |
| `getMemory()` | The selected history array. Initialises its system-message slot |
| `getLastMessage()` | The most recent message in the selected namespace |
| `eraseMemory()` | Protected. Empties the selected namespace |
| `genMessageId()` | A step-attributed ID for a custom LangChain message |

Index 0 of a namespace is reserved for the system message; it is replaced with the result of
`getPrompt()` before every model call.

Message IDs are step-attributed — the step name is the first segment — which is how PicoFlow
knows which step produced a message when deciding whether a crossing needs a synthetic
opener. Use `genMessageId()` when constructing raw LangChain messages, or use
`HumanMessageEx` / `AiMessageEx` / `DirectMessage`, which handle it.

### Erasing memory does not erase state

```ts
protected async onEnter() {
  this.eraseMemory();
}
```

`HotelFlow`'s `CompareStep` and `PresentStep` both do this: entering the stage starts a clean
conversational slate, while every hotel, price and criterion collected so far remains in step
state untouched.

<div class="callout callout--note"><span class="callout__title">Note</span><p>This separation is the practical benefit of keeping domain values out of the transcript. If the only record of the selected hotel is a sentence the model wrote, erasing memory loses it. If it is in <code>PresentStep</code> state, erasing memory costs nothing.</p></div>

### Compaction

Long conversations are compacted rather than truncated. Configure it on the flow's memory
container, in the constructor:

```ts
public constructor() {
  super();
  this.getMemory()
    .setSummaryModel({ provider: "openai", name: "gpt-4o" })
    .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
    .enableSummary("hotel-explore");
}
```

Compaction runs at the end of a turn, before the session is written. Older messages in an
enabled namespace are replaced by a rolling summary; `recentMessages` newest messages are
kept verbatim. Defaults are 16 and 8. The summary is stored in the document alongside the
remaining messages and injected as a second system message on later calls.

Compaction is opt-in per namespace, and its model must resolve through a registered provider
like any other. A failure is recorded as a session warning and does not fail the turn.

## Context

Session-wide configuration, established once when the session is created.

```ts
// caller
{ "flowName": "BasicFlow", "message": "Hi", "config": { "isPresident": true } }
```

```ts
// flow or step
const isPresident = this.getContext<boolean>("config.isPresident");
```

The request's `config` object is stored under a `config` key, which is why every read is
prefixed with `config.`. Reads use lodash paths, so nested values work:
`getContext<string>("config.tenant.region")`.

Context is available before the first model call, which makes it the only place a value can
influence `initialStep()`:

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

### A new config does not reconfigure a restored session

<div class="callout callout--danger"><span class="callout__title">Context is set once per session</span><p>The request's <code>config</code> is merged into the flow's in-memory context during construction, but restoring an existing session then overwrites that context with the stored value. Sending a different <code>config</code> on turn two has no effect and produces no error.</p></div>

This is deliberate. Context describes the session — tenant, locale, document to process,
feature flags — and letting a later request silently change it would mean a conversation's
own assumptions could shift underneath it.

If configuration must change, choose one of:

- **start a new session** with the new config, which is correct for anything immutable such
  as tenant or document identity; or
- **implement an explicit, validated step** that changes the value as a durable state
  transition you can see in the session document.

The flow also exposes `addContext(json)` and `setContext(object)`. They mutate the in-memory
context and are persisted with the turn, but they are runtime plumbing — reach for them in
migration or coordinator code, not as a substitute for the two options above.

## Transient state

Invocation-only scratch data, deliberately omitted at persistence.

```ts
this.saveTransientState({ pricingResponse });
const pricing = this.getTransientState<PricingResponse>("pricingResponse");

this.flow.saveTransientStepState(CompareStep, { candidates });
```

Transient values are held under a `_transient` key inside the step's in-memory state and are
**explicitly stripped** when the step is written to the session document. They never reach the
store.

Use it for:

- passing a large intermediate result from a parent step to a nested child within one
  request;
- caching an expensive computation across the several model calls of a single tool loop;
- holding anything you must not persist — raw file bytes, a decrypted value, a third-party
  response you have no retention right to.

Do not use it for anything the next turn needs. There is no error when a transient value is
missing on the following request; `getTransientState` simply returns `undefined`, and the
symptom is a step that behaves correctly on turn one and mysteriously on turn two.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Transient state pairs naturally with <code>runStep()</code>. The parent computes something expensive, writes it transiently to the child with <code>flow.saveTransientStepState(ChildStep, ...)</code>, runs the child, and nothing bloats the session document.</p></div>

## Putting it together

A hotel search turn touches all four:

```ts
@Tool
protected async search_hotels(args: Record<string, any>): Promise<ToolResponseType> {
  // context: which tenant's catalog to search — fixed for the session
  const tenant = this.getContext<string>("config.tenantId");

  const criteria = { city: args.city, checkIn: args.checkIn, nights: args.nights };
  const results = await this.catalog.search(tenant, criteria);

  if (results.length === 0) {
    // memory: the model reads this feedback and asks the user to widen the search
    return stay("No hotels matched. Ask the user to relax the budget or dates.");
  }

  // state: durable, owned by this step, survives memory erasure
  this.saveState({ criteria });
  this.saveState({ resultIds: results.map((r) => r.id) });

  // transient: the full result objects are large and re-derivable
  this.flow.saveTransientStepState(PresentStep, { results });

  return go(PresentStep).withPrompt("Present the search results.");
}
```

State keeps what the conversation must not lose. Memory keeps what the model must remember
saying. Context keeps what the caller decided. Transient keeps what only this request needs.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">The session document</span>
		<span class="card__body">Where each of these lands on disk.</span>
	</a>
	<a class="card" href="/docs/concepts/step-lifecycle/">
		<span class="card__title">Step lifecycle</span>
		<span class="card__body">When onEnter can safely erase memory.</span>
	</a>
	<a class="card" href="/docs/guides/nested-execution/">
		<span class="card__title">Nested execution</span>
		<span class="card__body">Where transient state earns its keep.</span>
	</a>
</div>
