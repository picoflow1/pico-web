---
title: HTTP API
eyebrow: Reference
lede: "The demo controller's three routes, the exact request and response shapes, the session header round-trip, how a non-plain content type replaces the response body, and how errors are reported."
source: pico-demo/src/controllers/ai-controller.ts
---

`@picoflow/core` ships no HTTP layer. The contract below is `AiController` in the demo
application — a thin adapter over `FlowEngine` that the tutorials and end-to-end tests assume.
Copying it is cheaper than inventing a different one.

Everything here is derived from the controller's parameter bindings, not from its Swagger
decorators, which disagree in one place.

## POST /ai/run

Returns HTTP 200 on success and HTTP 400 on failure.

### Request

| Location | Name | Type | Required | Meaning |
| --- | --- | --- | --- | --- |
| Body | `flowName` | string | yes | The registered flow name |
| Body | `message` | string | no | The user turn |
| Body | `config` | object | no | Session-wide configuration, stored as flow context on the first turn |
| Header | `CHAT_SESSION_ID` | string | no | Omit to start a new session |

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{
    "flowName": "HotelFlow",
    "message": "Hi",
    "config": { "tenantId": "demo" }
  }'
```

The header name is `K.ChatSessionID`, the literal string `CHAT_SESSION_ID`.

### Response

```json
{
  "success": true,
  "completed": false,
  "message": "Which dates should I search?",
  "session": "6870216993a135e7deb762c7",
  "contentType": "text/plain"
}
```

| Field | Meaning |
| --- | --- |
| `success` | The turn ran without an unhandled error |
| `completed` | The current step's `isEnd()`. Stop sending the session ID once this is `true` |
| `message` | The text to show the user |
| `session` | The session ID, also returned in the `CHAT_SESSION_ID` response header |
| `contentType` | The current step's `HttpContentType` |

The controller sets the `CHAT_SESSION_ID` response header whenever `result.session` is
non-empty, including on failures that already have a session.

### The session round-trip

The first call omits the header. PicoFlow creates a document, binds it permanently to the
requested flow, and returns the new ID in both the header and `session`. Send that value back
as the `CHAT_SESSION_ID` header on every subsequent turn of the same conversation.

A session ID is a cursor for one workflow, not a container for a user's activity. Reusing it
with a different `flowName` fails rather than switching flows.

## Direct responses and content types

When the current step's `contentType` is anything other than `HttpContentType.Plain`, the
controller **replaces** the JSON envelope with the raw message:

```ts
if (result.contentType && result.contentType !== HttpContentType.Plain) {
  return res.type(result.contentType).send(result.message);
}
return res.send(result);
```

So a step that sets `HttpContentType.Json` returns the model's JSON directly, with no
`success`, `completed`, or `session` fields in the body — the session ID is still available in
the response header. Client code must branch on the response `Content-Type`.

`HttpContentType` is an enum of standard MIME strings covering data formats
(`Json`, `Xml`, `Yaml`, `JsonLd`, `JsonApi`, …), documents (`Plain`, `Html`, `Markdown`, `Pdf`,
`Docx`, …), spreadsheets (`Csv`, `Xlsx`, …), images (`Png`, `Jpeg`, `Svg`, …), audio and video,
and binary types (`OctetStream`, `Zip`, `Gzip`, `Tar`).

Set it at transition time with `.withContentType(...)` — see
[go() / stay() / direct()](/docs/reference/response-builders/).

<div class="callout callout--note"><span class="callout__title">Failures are always plain</span><p>The engine's failure envelope hard-codes <code>contentType: HttpContentType.Plain</code>, so an error response always arrives as the JSON envelope, never through the raw path — even for a flow whose steps normally return JSON.</p></div>

## GET /ai/flows

Returns `FlowEngine.getFlowNames()`: a JSON array of every registered flow name.

```bash
curl http://localhost:8000/ai/flows
```

```json
["BasicFlow", "HotelFlow", "InvoiceFlow", "SupportFlow", "HomeInsuranceQuoteFlow", "EmployeeBenefitsFlow"]
```

This is the fastest check that registration succeeded after adding a flow.

## POST /ai/end

Permanently deletes one session document by calling `FlowEngine.deleteSession(sessionId)`. It
takes no body; the session travels in the `CHAT_SESSION_ID` header.

```bash
curl -i -X POST http://localhost:8000/ai/end \
  -H 'CHAT_SESSION_ID: 6870216993a135e7deb762c7'
```

```json
{ "success": true, "session": "6870216993a135e7deb762c7" }
```

A failure returns HTTP 400 with `{ "success": false, "message": "…", "session": "…" }`.

Two behaviours are worth knowing. Deleting a session that does not exist succeeds — the
delete is a no-op. And calling the route with **no** `CHAT_SESSION_ID` header also reports
success, because `deleteSession()` skips an empty ID entirely.

Deletion is not completion. `TerminateSessionStep` finishes a workflow while keeping its
document for diagnostics; this route destroys the record.

## Error reporting

Every engine error is converted into the failure envelope rather than thrown, so the transport
sees a resolved value:

```json
{
  "success": false,
  "completed": true,
  "message": "FlowClass  'DemoFlow' not registered.",
  "session": "",
  "contentType": "text/plain"
}
```

The demo controller maps **every** unsuccessful result to HTTP 400. The underlying
`PicoFlowError` codes and status codes are not carried in the response body — only
`error.message` survives.

| Condition | `PicoFlowError` code | Intended status | Demo status |
| --- | --- | --- | --- |
| Stale compare-and-swap on save or delete | `SESSION_CONFLICT` | 409 | 400 |
| Session ID reused with a different flow | `SESSION_FLOW_MISMATCH` | 409 | 400 |
| Malformed one-flow envelope | `SESSION_FLOW_INVARIANT` | 409 | 400 |
| Session backend failure | `SESSION_STORE_ERROR` | 500 | 400 |
| Unregistered flow name, model or tool error, handler exception | — | 400 | 400 |

An application that wants precise conflict semantics should catch the error classes from
`FlowEngine` rather than relying on the envelope, and map the three 409-class codes to HTTP
409 with a `Retry` affordance. The engine already avoids marking the session aborted for those
three, so the winning document stays intact.

For the whole failure model see [Error handling and completion](/docs/guides/error-handling/), and
for the concurrency rules see [Session stores](/docs/reference/session-stores/).
