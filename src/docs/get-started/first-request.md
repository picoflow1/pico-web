---
title: Your first request
eyebrow: Get started
lede: "The HTTP contract in detail: the run body, the session header round-trip, resuming a conversation, listing flows, the two 409-class errors, and how a direct response changes the response body."
source: pico-demo/src/controllers/ai-controller.ts
---

`@picoflow/core` has no HTTP layer of its own. The contract below is the demo application's
`AiController`, which is a thin adapter over `FlowEngine`. It is worth learning as-is,
because it is the shape the flow tutorials and the tests assume, and because copying it is
cheaper than inventing a different one.

All examples assume the demo is running on port 8000. See
[Run the demo app](/docs/get-started/run-the-demo/).

## POST /ai/run

### Request body

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `flowName` | string | yes | The registered flow name. Defaults to the flow's class name. |
| `message` | string | no | The user turn. Omit or leave empty on the first call to let the flow open the conversation. |
| `config` | object | no | Session-wide configuration. Stored as flow context on the first turn of a session. |

The session ID travels in the `CHAT_SESSION_ID` **header**, not the body.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>The demo's Swagger DTO documents the message field as <code>userMessage</code>. The controller actually binds <code>@Body(K.message)</code>, and <code>K.message</code> is <code>"message"</code>. Send <code>message</code>. The OpenAPI document is wrong on this point.</p></div>

### Response body

```json
{
  "success": true,
  "completed": false,
  "message": "Hello. Which two cities should I compare?",
  "session": "6870216993a135e7deb762c7",
  "contentType": "text/plain"
}
```

| Field | Meaning |
| --- | --- |
| `success` | The turn ran without an unhandled error. `false` is returned with HTTP 400. |
| `completed` | The active step reports the session as finished. Stop sending the session ID once this is `true`. |
| `message` | The text to show the user. |
| `session` | The session ID. Also returned as the `CHAT_SESSION_ID` response header. |
| `contentType` | The active step's HTTP content type. `text/plain` unless a step changed it. |

## The CHAT_SESSION_ID round-trip

The first call omits the header. PicoFlow creates a session document, binds it permanently
to the requested flow, and returns the new ID both in the header and in `session`.

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{
    "flowName": "BasicFlow",
    "message": "Hi",
    "config": { "isPresident": false }
  }'
```

```text
HTTP/1.1 200 OK
CHAT_SESSION_ID: 6870216993a135e7deb762c7
content-type: application/json

{"success":true,"completed":false,"message":"Which two cities would you like to compare?","session":"6870216993a135e7deb762c7","contentType":"text/plain"}
```

Every subsequent turn sends that ID back:

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -H 'CHAT_SESSION_ID: 6870216993a135e7deb762c7' \
  -d '{
    "flowName": "BasicFlow",
    "message": "Paris and Berlin"
  }'
```

PicoFlow loads the session document, restores memory, step state, model selection and
context, calls `onRestore()` on the current step, and runs the turn from wherever the
conversation left off. Nothing about the conversation lives in your client.

### Resuming rules

- **The flow name must match on every turn.** A session ID is permanently bound to the flow
  that created it.
- **`config` is only read on the first turn of a session.** Restored sessions keep their
  stored context. Sending a different `config` object does not reconfigure a running
  session.
- **Completed and aborted sessions do not resume.** If the stored `runStatus` is `completed`
  or `aborted`, PicoFlow does not fail — it creates a fresh session document and returns a
  new ID. Watch the `session` field; it can change.
- **A Flow may reset a restored session.** Its `onRestoreSessionDoc()` hook can
  return `null` for an idle, invalid, or otherwise unacceptable document.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Always read the <code>session</code> value from the response rather than assuming your stored ID is still current. A Flow-owned reset can change it.</p></div>

## GET /ai/flows

```bash
curl http://localhost:8000/ai/flows
```

```json
["BasicFlow","HotelFlow","InvoiceFlow"]
```

This is `FlowEngine.getFlowNames()`. It is the cheapest possible boot check: if a flow name
is missing here, registration failed or the class was never added to
`FlowEngine.create({ flows })`. Assert on it in an integration test.

Requesting an unregistered name returns HTTP 400 with:

```json
{"success":false,"completed":true,"message":"FlowClass  'DemoFlow' not registered.","session":"","contentType":"text/plain"}
```

## Session errors

Two error classes deserve specific client handling. Both are `PicoFlowError` subclasses
carrying `statusCode: 409`.

### SESSION_FLOW_MISMATCH

Raised when a session ID is reused with a different `flowName`.

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -H 'CHAT_SESSION_ID: 6870216993a135e7deb762c7' \
  -d '{"flowName":"HotelFlow","message":"Find me a hotel"}'
```

```json
{
  "success": false,
  "completed": true,
  "message": "Session '6870216993a135e7deb762c7' belongs to flow 'BasicFlow', not 'HotelFlow'. Start a new session for that flow.",
  "session": "6870216993a135e7deb762c7",
  "contentType": "text/plain"
}
```

This is the one-flow-per-session invariant being enforced. PicoFlow will not append a second
flow to the document and will not silently replace the first. To run another flow, start a
new session by omitting the header. See
[One flow per session](/docs/concepts/one-flow-per-session/).

Note that this check runs before the flow's restore and migration hook, so a flow rename
cannot be repaired by `onRestoreSessionDoc()`.

### SESSION_CONFLICT

Raised when a save loses an optimistic compare-and-swap: another request wrote the same
session document first.

```json
{
  "success": false,
  "completed": true,
  "message": "Session '6870216993a135e7deb762c7' was changed or removed by another request.",
  "session": "6870216993a135e7deb762c7",
  "contentType": "text/plain"
}
```

Within one `FlowEngine` instance a per-session mutex serialises turns, so this normally
appears only across processes, across engine instances, or when something writes to the
store directly.

The winning document is deliberately left untouched: PicoFlow does not mark the session
aborted and does not overwrite it with the losing request's error. There is also no
automatic replay, because the losing attempt may already have called a model, sent a
message, or charged a card.

<div class="callout callout--danger"><span class="callout__title">Both errors carry statusCode 409, and the demo controller returns 400</span><p>The demo's <code>AiController</code> maps every unsuccessful run to <code>HttpStatus.BAD_REQUEST</code>. A production controller should inspect the error code and return HTTP 409 for <code>SESSION_CONFLICT</code> and <code>SESSION_FLOW_MISMATCH</code>, so clients can distinguish &quot;retryable conflict&quot; from &quot;malformed request&quot;.</p></div>

Handle a conflict by returning a retryable status to the caller, reloading the latest
session state, deciding whether the original user command is still valid, and retrying only
through an idempotent path.

## Content types and direct responses

By default the response body is the JSON envelope shown above, with `contentType` reported
as a field. The controller changes shape when the active step's content type is anything
other than `text/plain`:

```ts
if (result.contentType && result.contentType !== HttpContentType.Plain) {
  return res.type(result.contentType).send(result.message);
}
return res.send(result);
```

So a non-plain content type means the client receives `result.message` **as the entire
body**, with that `Content-Type` header. There is no envelope, no `success` flag, and no
`session` field in the body — the session ID is still in the `CHAT_SESSION_ID` header.

A step sets that content type at transition time. `InvoiceFlow`'s extraction handler does
exactly this:

```ts
return direct(args?.json).withContentType(HttpContentType.Json);
```

`direct(content)` returns content to the caller without another model call, keeping the
current step active. `.withContentType(HttpContentType.Json)` sets the destination step's
content type.

The visible difference:

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{
    "flowName": "InvoiceFlow",
    "config": { "fileName": "data/ACME.png" }
  }'
```

```text
HTTP/1.1 200 OK
CHAT_SESSION_ID: 3f2b9e1c-...
content-type: application/json

{"vendor_name":"ACME Inc","invoice_number":"...","line_items":[ ... ]}
```

The body is the extracted document itself, not a chat envelope. That is the point: a
one-shot document flow can be consumed by a machine client with no unwrapping step.

<div class="callout callout--note"><span class="callout__title">Note</span><p>Because <code>application/json</code> is both a common step content type and the envelope's own content type, the two cases look similar in a header dump. Distinguish them by the body: an envelope always has <code>success</code>, <code>completed</code>, <code>message</code> and <code>session</code> keys.</p></div>

Content type is set on the destination step, so it persists for that step until changed.
The full enumeration lives in `HttpContentType` and covers JSON, XML, YAML, HTML, Markdown,
CSV, PDF, Office formats, images, audio, video and binary streams.

## POST /ai/end

```bash
curl -i -X POST http://localhost:8000/ai/end \
  -H 'CHAT_SESSION_ID: 6870216993a135e7deb762c7'
```

```json
{"success":true,"session":"6870216993a135e7deb762c7"}
```

This calls `FlowEngine.deleteSession(...)`, which **permanently deletes** the session
document under the same per-session lock and revision check used for updates.

Deleting is not the same as completing. A normal conversation finishes by transitioning to
`TerminateSessionStep`, which marks the document `completed` and keeps it for audit,
analytics and debugging. Use `/ai/end` only when the record itself should be destroyed.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">The session document</span>
		<span class="card__body">What is actually persisted behind that session ID.</span>
	</a>
	<a class="card" href="/docs/concepts/one-flow-per-session/">
		<span class="card__title">One flow per session</span>
		<span class="card__body">Why SESSION_FLOW_MISMATCH exists and how to hand off between flows.</span>
	</a>
	<a class="card" href="/docs/concepts/routing/">
		<span class="card__title">Routing</span>
		<span class="card__body">go(), stay(), direct() and the builder methods that shape the response.</span>
	</a>
</div>
