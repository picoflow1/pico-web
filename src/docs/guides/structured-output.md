---
title: Structured output and responses
eyebrow: Guides
lede: What happens when a model responds without calling a tool — schema-constrained output, rewriting or routing in onResponse, and the retry predicate whose polarity is the opposite of what you expect.
source: picoflow-demo/docs/step-authoring-contract.md
---

Use this when a step's job is to produce data rather than to converse: an extraction, a
classification, a JSON payload for a caller. It is also the page to read before writing
`checkResponse()`, whose return value means the opposite of what most people assume.

## The three result paths

Every model turn ends on exactly one of these:

| Path | Trigger | Handled by |
| --- | --- | --- |
| Tool call | The response contains `tool_calls` | `@Tool` / `@Tools` handler, then the transition machinery |
| Plain response | No tool calls | `onResponse(result)` |
| Direct message | A handler returned `direct(...)` or `.withMessage(...)` with a direct AI message | Returned to the caller with no further model call |

The first is covered in [Defining and handling tools](/docs/guides/tools/). This page covers the
other two.

## Structured output with structOutputSchema()

Return a schema and PicoFlow binds it to the model with `withStructuredOutput(...)` before
the call:

```ts
public structOutputSchema(): object {
  return z.object({
    title: z.string().describe("Movie title"),
    genre: z.string().describe("Main genre"),
    releaseYear: z.number().describe("Release year"),
    rating: z.number().min(0).max(10).describe("Rating from 0 to 10"),
    summary: z.string().describe("Short plot summary"),
  });
}
```

The default is `null`, meaning free-form text.

Two consequences worth planning for:

- `onResponse()` now receives the **parsed object**, not a string. The runner only converts
  to text when the response has a `content` property, which a structured result does not.
- Providers frequently omit usage metadata for structured-output calls, so those tokens may
  not appear in the session document's `tokens` totals.

<div class="callout callout--note"><span class="callout__title">Structured output and tools do not combine well</span><p>The runner binds tools first and then applies the structured-output wrapper. A step that both exposes tools and constrains output is asking the provider for two mutually exclusive response shapes. Pick one per step: use tools for decisions and side effects, structured output for extraction.</p></div>

The alternative — used by `FavoritesStep` and `NoToolStep` — is to describe the shape in the
prompt, often by interpolating an example JSON file, and parse the text yourself with
`StringUtil.parseJson`. That works with every provider and keeps the response inspectable.

## onResponse() and what you may return

```ts
public async onResponse(llmResult: string | object): Promise<LastResponseType>
```

The base implementation stringifies objects and returns strings unchanged. `LastResponseType`
allows three shapes:

| Return | Effect |
| --- | --- |
| `string` | Pushed into memory as an `AIMessage` and returned to the caller |
| A `Step` class or registered step name | The flow moves the cursor there and continues executing |
| `{ step, message?, prompt?, state?, contentType? }` | Moves the cursor and applies the extras before continuing |

Saving and returning:

```ts
public async onResponse(llmResult: string | object): Promise<LastResponseType> {
  this.saveState({ who: llmResult as JsonValue });
  return llmResult as string;
}
```

Parsing, validating, then routing:

```ts
public async onResponse(llmResult: string | object): Promise<LastResponseType> {
  const json =
    typeof llmResult === "string"
      ? StringUtil.parseJson<JsonValue>(llmResult)
      : (llmResult as JsonValue);

  if (json && typeof json === "object" && !Array.isArray(json)) {
    this.saveState({ favorites: json });
    return go(NameStep);
  }

  return typeof llmResult === "string" ? llmResult : JSON.stringify(llmResult);
}
```

Note the fallback. When the model returns something unusable, returning the raw text lets the
user see it and the conversation continue, rather than throwing mid-turn.

## Routing from onResponse()

Returning a step class from `onResponse()` is a real transition: `Flow.goto()` runs, so the
current step's `onExit()` and the destination's `onEnter()` and `onCrossing()` fire, and the
runner immediately makes another model call on the destination.

`lastResponse(...)` is the purpose-built builder for the object form:

```ts
return lastResponse(ExtractInvoiceStep)
  .withState({ from_previous: parsedResult as JsonValue })
  .withContentType(HttpContentType.Json);
```

`go(...)` is structurally compatible and is what the demo uses — `NoToolStep` returns
`go(ExtractInvoiceStep).withState({ from_previous: parsedResult })`. Prefer `lastResponse()`
in new code, because `go()`'s `withToolFeedback(...)` has no meaning outside a tool handler.

<div class="callout callout--warning"><span class="callout__title">Routing from onResponse() can loop</span><p>Each transition triggers another model call. A step whose <code>onResponse()</code> unconditionally routes to a step that routes back will spin until the process runs out of stack or budget. Route only on a condition that the destination will change.</p></div>

## checkResponse() and inverted retry semantics

```ts
public checkResponse(llmResult: string | object): boolean
```

**`false` accepts the response. `true` asks for a retry.** The default returns `false`.

```ts
public checkResponse(result: string | object): boolean {
  // true means "this is unacceptable, call the model again"
  return !looksLikeCompleteJson(result);
}
```

Two properties are required of the predicate:

- **deterministic** — it runs once per attempt, on different responses;
- **side-effect free** — it must not save state or mutate memory, because the response it
  rejected is discarded.

<div class="callout callout--info"><span class="callout__title">The argument is the raw provider message</span><p>The declared parameter type is <code>string | object</code>, but the runner passes the <code>AIMessageChunk</code> returned by the provider — not the extracted text. Read <code>result.content</code>, or narrow with <code>typeof result === "string"</code> before treating it as text. This differs from <code>onResponse()</code>, which does receive extracted text for non-structured calls.</p></div>

## What the retry loop actually does

`checkResponse()` is only one input to the loop. The full sequence per attempt:

```text
attempt 1..N   (N = adapter retryAttempts, default 3)
  invoke the model
  tally tokens
  if the response has no tool calls and blank content:
       pop the offending message(s) from memory
       push "Follow system prompt and respond properly."
       retry
  else:
       retry if checkResponse(response) === true
  wait 500ms between attempts
exhausted -> throw: LLM call failed. Reason:<finish reason>. Error:<message>
```

Empty-response recovery is automatic and needs no code from you. Set `retryAttempts` on the
provider adapter when a specific provider warrants a different budget:

```ts
ModelProvider.createCustomAdapter({
  provider: "in-house",
  runtimeProvider: "openai",
  retryAttempts: 5,
});
```

Every attempt is a billed model call. `checkResponse()` that rejects too eagerly triples the
cost of a step.

## Direct responses and content types

A direct message ends the HTTP turn without another model call, while leaving the current
step active:

```ts
this.flow.markCompleted();
return direct(args?.json).withContentType(HttpContentType.Json);
```

The response envelope carries `contentType` from the step, and the demo controller sends the
raw `message` with that content type whenever it is not `text/plain`:

```ts
if (result.contentType && result.contentType !== HttpContentType.Plain) {
  return res.type(result.contentType).send(result.message);
}
return res.send(result);
```

So a JSON content type changes the response body shape, not just its header. Callers that
expect the standard `{ success, completed, message, session }` envelope will break unless
they branch on the content type. Set it deliberately.

## Failure modes

| Symptom | Cause |
| --- | --- |
| The retry loop never triggers | `checkResponse()` returns `true` for good responses and `false` for bad ones — the polarity is inverted |
| Every step call costs 3x | `checkResponse()` rejects acceptable responses |
| `checkResponse` sees `[object Object]` | It received an `AIMessageChunk`; read `.content` |
| `onResponse` receives an object unexpectedly | `structOutputSchema()` is set, so no text extraction happens |
| Token totals look low | Structured-output calls often report no usage metadata |
| `LLM call failed. Reason:length.` | The response was truncated; raise `maxTokens` in the model params |
| Infinite model calls | `onResponse()` routes unconditionally between two steps |
| The client cannot parse the response | A non-plain `contentType` changed the body from the envelope to the raw payload |

Related: [Structured output](/docs/tutorials/basic-flow/structured-output/),
[Response-driven steps](/docs/tutorials/basic-flow/response-driven-steps/), and
[Error handling and completion](/docs/guides/error-handling/).
