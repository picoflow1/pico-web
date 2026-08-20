---
title: One flow per session
eyebrow: Concepts
lede: A session document contains exactly one Flow, never an array. A session ID is a cursor into one workflow, not a container for a user's activity, and flow naming is part of the persisted schema.
source: pico-demo/docs/picoflow-workflow-developer-guide.md
---

This is PicoFlow's central persistence invariant:

> **One session document contains exactly one Flow.**

A flow can have many session documents — one per conversation, per request workflow, per
batch worker. A single session document never contains several flows. Its session ID is
permanently bound to the registered flow name that created it.

## Why it is an invariant and not a convention

The alternative design — a session document holding an array of flows, so one ID can carry a
user across a hotel booking and then an invoice upload — sounds convenient and creates a set
of problems that have no good answers:

- **Which flow's step state does `getStepState(SomeStep)` read** when two flows both
  register a step with that name?
- **What does `currentStep` mean** when there are three flows in the document?
- **What does compare-and-swap protect** when three independent workflows write to the same
  revision?
- **What does expiry apply to** when one workflow finished a month ago and another is live?
- **What does a migration hook migrate** when the document contains three schema versions?

PicoFlow answers all of these by refusing the situation. The cost is that your application
tracks more than one session ID. The benefit is that every question about a session document
has exactly one answer.

## Where the invariant is enforced

It is checked at every session boundary, not just on creation:

| Boundary | Check |
| --- | --- |
| Creation | The store writes `sessionDoc.flow` as a single object |
| Load | The envelope must exist, be a non-array object, and have a non-empty `flow.name` |
| Load | The document must be structurally valid: `memory` is a record, `currentStep` is a string or null, `steps` and `sequence` are arrays, `context` is a record |
| Load | The requested registered flow name must equal `sessionDoc.flow.name` |
| Save | The same structural assertion runs again before the write |
| Save | Stores reject attempts to change the flow name |
| Nested steps | Children share the same envelope |
| Batch workers | Each receives its own independent session document containing its own instance of the same registered flow |

Two distinct errors come out of this:

```text
SESSION_FLOW_MISMATCH   the session belongs to a different registered flow
SESSION_FLOW_INVARIANT  the document is not a valid one-flow envelope
```

Both carry `statusCode: 409`. Neither marks the stored session aborted — a mismatched request
is the caller's error, and the stored document is left untouched.

<div class="callout callout--warning"><span class="callout__title">The mismatch check runs before the restore hook</span><p>Flow-name validation happens during load, before <code>onRestoreSessionDoc()</code> is called. A migration hook cannot repair a flow-name mismatch, because it never runs.</p></div>

## A session ID is a cursor, not a container

Model it as a pointer into one workflow's progress:

```text
user 42
 ├── CHAT_SESSION_ID a1b2...   -> HotelFlow,   currentStep = PresentStep
 ├── CHAT_SESSION_ID c3d4...   -> InvoiceFlow, completed
 └── CHAT_SESSION_ID e5f6...   -> BasicFlow,   currentStep = AddressStep
```

If one user starts `HotelFlow` and `InvoiceFlow`, your application keeps two session IDs.
Neither PicoFlow nor the demo controller does that bookkeeping for you: the HTTP contract
returns a session ID per turn and expects the client to send back the right one.

Practical consequences for your API design:

- **Store session IDs keyed by user and workflow**, not by user alone.
- **Read the `session` field from every response.** It can change — an expired, completed or
  aborted session is replaced with a new document and a new ID rather than failing.
- **Do not reuse an ID for a different `flowName` "just to be safe".** That is exactly the
  mismatch case.

## Flow naming is part of the schema

The registered flow name is written into the document and compared on every load. That makes
it as much a persisted identifier as a step class name.

By default the registered name is the class name. So renaming `CustomerFlow` to
`ClientFlow` orphans every running session: the load check sees `"CustomerFlow"` in the
document, receives `"ClientFlow"` from the request, and fails.

To decouple a public name from a TypeScript class name, register with a name-to-constructor
map:

```ts
await FlowEngine.create({
  flows: { CustomerFlow: ClientFlow },
  providers: [],
});
```

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>Registration validates that the map key equals the class's static <code>id</code>, which defaults to the class name. To use a key that differs from the class name you must also override the static <code>id</code> on the flow class so the two agree. Registration throws otherwise.</p></div>

```ts
export class ClientFlow extends Flow {
  static override get id(): string {
    return "CustomerFlow";
  }
  // ...
}
```

Decide the public name before you ship. Changing it later is a data migration you cannot
perform from inside the flow.

## Handing off between flows

You will eventually want one workflow to lead into another: intake finishes, fulfilment
begins. The invariant does not prevent that. It prevents doing it by mutating one document.

<div class="callout callout--danger"><span class="callout__title">Do not copy step state between session documents</span><p>Reaching into a source session's <code>steps[]</code> and writing those objects into a destination session bypasses every validation PicoFlow performs, imports the source flow's schema version and framework-internal keys such as <code>_prompt</code> and <code>_saveOn</code>, and produces a document that no <code>defineSteps()</code> can explain.</p></div>

Do an application-level handoff instead. Four steps:

**1. Complete the source workflow.** Let it reach `TerminateSessionStep` or call
`sessionCompleted()`, so the document records that it finished normally.

**2. Read the result through the public contract.** Use the run response, or load the
session and read the owning step's state through the flow API:

```ts
const intake = flow.getStepState<IntakeState>(CollectIntakeStep);
```

**3. Validate it as if it came from outside.** Define an explicit input contract for the
destination flow and parse the source result against it. A Zod schema is the natural fit,
and it is the same discipline you would apply to an HTTP payload:

```ts
const HandoffInput = z.object({
  customerId: z.string().uuid(),
  productCode: z.string(),
});

const input = HandoffInput.parse(intake);
```

**4. Start a new session for the destination flow**, passing only that contract as `config`:

```ts
const result = await engine.run({
  flowName: "FulfilmentFlow",
  userMessage: "",
  config: input,
});
// result.session is a new ID, bound to FulfilmentFlow.
```

The destination flow reads those values as context:

```ts
const customerId = this.getContext<string>("config.customerId");
```

The result is two documents with independent lifetimes, independent expiry, independent
migration histories, and an explicit, reviewable interface between them. If the handoff
contract changes, it changes in one Zod schema rather than across two persisted schemas.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Record the source session ID in the destination flow's context. It costs one field and it makes the two documents traceable to each other for support and analytics without coupling them structurally.</p></div>

## Batch mode is not an exception

`concurrentSteps(...)` looks like one session running many things. It is not. The coordinator
makes HTTP calls back to the application's own run endpoint, and each worker gets a fresh
session document containing its own instance of the same registered flow, configured by
`onConfig`.

So a batch of ten items produces eleven session documents: one coordinator and ten workers.
Every one of them satisfies the invariant.

Nested execution is the genuinely different case: `runStep(...)` and `runSteps(...)` run
inside the current turn, share the outer session document, and return control to their
parent. They are frames, not sessions.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">The session document</span>
		<span class="card__body">The structure the invariant protects.</span>
	</a>
	<a class="card" href="/docs/get-started/first-request/">
		<span class="card__title">Your first request</span>
		<span class="card__body">How SESSION_FLOW_MISMATCH surfaces over HTTP.</span>
	</a>
	<a class="card" href="/docs/guides/concurrent-steps/">
		<span class="card__title">Concurrent batch mode</span>
		<span class="card__body">Coordinators, workers, and why each worker gets its own session.</span>
	</a>
</div>
