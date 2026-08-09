---
title: 5. Raw JSON and batch fan-out
eyebrow: InvoiceFlow tutorial
lede: The extracted invoice leaves the flow as an application/json body rather than a chat envelope, and the same extraction can be fanned out over a list of files without writing a second flow.
source: picoflow-demo/src/myflow/invoice-flow/extract-invoice.ts, picoflow-demo/src/myflow/invoice-flow/invoice-flow.ts, picoflow-demo/src/controllers/ai-controller.ts
---

Two features close out this track, and they are unrelated except that both make
InvoiceFlow usable as infrastructure rather than as a chat. The first returns
the extraction as a real JSON response. The second runs the whole flow once per
file, concurrently, from a single request.

## The goal

- Return an object with a non-plain HTTP content type from a tool handler.
- Follow that content type through the flow response into the controller.
- Complete a session without routing to a terminal step.
- Fan one flow out over a list of items with `spawnSteps()` and
  `concurrentSteps()`.

## The final handler

```ts
@Tool
protected async capture_json(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  this.saveState({ json: args?.json });
  // this.sessionCompleted();

  // direct(...) returns JSON immediately, without another model call, and keeps this step active.
  this.flow.markCompleted();
  return direct(args?.json).withContentType(HttpContentType.Json);
}
```

Three statements, each doing one thing.

**`saveState({ json })`** writes the extraction to durable step state. This is
the record; the HTTP body is a convenience. The end-to-end spec asserts they
are deep-equal.

**`markCompleted()`** sets `runStatus = 'completed'` on the session document.
`Step.isEnd()` reads that field, so the flow's run response reports
`completed: true` with no terminal step involved. The commented-out
`sessionCompleted()` above it is the `Step`-level equivalent.

**`direct(args?.json).withContentType(...)`** ends the turn with the object
itself.

## How an object becomes a JSON body

`direct()` accepts `string | object`, and `DirectMessage` serialises objects:

```ts
export class DirectMessage extends AiMessageEx {
  constructor(step: Step, content: string | object) {
    if (typeof content === 'object') {
      super(step, JSON.stringify(content), { direct: true });
    } else {
      super(step, content, { direct: true });
    }
  }
}
```

`.withContentType(...)` attaches the enum value to the builder, and the runner
applies it to the destination step — which, for a `direct()` response, is the
current step:

```ts
if (result.contentType) {
  step.contentType = result.contentType;
}
```

`Flow.run()` then reports it alongside the message:

```ts
return {
  success: true,
  completed: step.isEnd(),
  message: MessageUtil.contentToText(resp),
  session: this.requireSessionDoc().id,
  contentType: step.contentType,
};
```

`HttpContentType` is a plain string enum, so `HttpContentType.Json` is
`'application/json'`. The enum also carries XML, YAML, CSV, Markdown, PDF and
about forty others — anything you can render in a handler, you can return with
the matching type.

## The controller decides the envelope

`picoflow-demo/src/controllers/ai-controller.ts`:

```ts
const result = await this.flowEngine.run({
  flowName,
  userMessage,
  sessionId,
  config,
});
if (result.session) {
  res.header(K.ChatSessionID, result.session);
}
if (!result.success) {
  res.status(HttpStatus.BAD_REQUEST);
}
if (result.contentType && result.contentType !== HttpContentType.Plain) {
  return res.type(result.contentType).send(result.message);
}
return res.send(result);
```

The default path sends the whole result object — `{ success, completed,
message, session, contentType }` — as the response body. A non-plain content
type takes the other branch: the type is set on the response and **only**
`result.message` is sent.

So an InvoiceFlow caller receives:

```text
HTTP/1.1 200 OK
content-type: application/json
CHAT_SESSION_ID: 01J...

{"vendor_name":"ACME Inc","bill_number":"INV-2025-019", ... }
```

The session header is still set on both paths, so a caller can inspect or
delete the session afterwards. What is lost on the non-plain path is
`completed` and `success`, which are no longer visible to the client — HTTP
status carries success, and a caller that needs the completion flag has to read
the session document.

This is a controller-level choice, not a framework rule. The demo's controller
is thirty lines; if your API needs the envelope *and* a typed body, change the
branch to `res.type(...).send({ ...result, data: JSON.parse(result.message) })`
or add a second route.

<div class="callout callout--tip"><span class="callout__title">Content type survives a handoff to the terminal step</span><p><code>TerminateSessionStep.onCrossing()</code> copies the prior step&rsquo;s <code>contentType</code> onto itself. If you do register a terminal step after a JSON-producing one, the response stays <code>application/json</code> rather than silently reverting to plain text.</p></div>

## Batch mode

The same flow class also coordinates a batch:

```ts
protected async spawnSteps(): Promise<string> {
  const fileNames = ["data/Evergreen.png", "data/ACME.png"];

  await this.concurrentSteps<string>({
    items: fileNames,
    batchSize: 10,
    onConfig: (item) => {
      return {
        fileName: item,
      };
    },
    onBotResponse(_item, response) {
      console.log(response);
    },
  });

  const msg = `Finished concurrent flow: ${this.id}`;
  new SessionLogger(this.getSessionDoc()).log(msg);
  return msg;
}
```

`spawnSteps()` runs instead of the normal step loop when the request's config
says so:

```ts
public async run(message: string): Promise<RunResponseType> {
  //test if this flow is a concurrent coordinator
  const isConcurrent = this.getContext<boolean>('config._concurrent');
  let resp: MessageContent | null;
  if (isConcurrent) {
    resp = await this.spawnSteps();
  } else {
    const step = this.requireCurrentStep();
    resp = await step.run(message);
  }
  ...
}
```

So one request starts the coordinator:

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{"flowName":"InvoiceFlow","message":"batch","config":{"_concurrent":true}}'
```

### What concurrentSteps actually does

```ts
public async concurrentSteps<T>({
  items,
  batchSize,
  onConfig,
  onBotResponse,
}: {
  items: T[];
  batchSize: number;
  onConfig: (item: T) => object;
  onBotResponse: (item: T, response: any) => void;
}) {
  const selfCaller = new SelfClient();
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    ...
    const promises = batch.map(async (item) => {
      const body = {
        flowName: this.id,
        config: {
          ...onConfig(item),
        },
      };
      try {
        const result = await selfCaller.post('', body);
        onBotResponse(item, result);
      } catch (error) {
        const msg2 = `Error batch process flow: ${this.id}, error:${errorMessage(error)}`;
        new SessionLogger(this.getSessionDoc()).error(msg2);
        console.error(msg2);
      }
    });
    await Promise.all(promises);
    ...
  }
}
```

The important detail: each item becomes a **separate HTTP request back to the
application**, over `SelfClient`, which posts to the `SELF_URL` configured on
the engine. Every worker therefore gets its own session document, its own
cursor, and its own memory. This is orchestration across sessions, not
concurrency inside one.

| Parameter | Meaning |
| --- | --- |
| `items` | The work list. Here, two filenames. |
| `batchSize` | How many run in parallel. Batches are sequential; items within a batch are `Promise.all`ed. |
| `onConfig(item)` | Builds each worker's `config`. Here `{ fileName: item }` — which is exactly what `ExtractInvoiceStep.getPrompt()` reads. |
| `onBotResponse(item, response)` | Called with each worker's response. Note the demo omits `_concurrent`, so workers run the normal path. |

Failures are logged per item and do not abort the batch, so a bad document does
not lose the other nineteen. The coordinator's own return value is a plain
status string, and progress is written to the session log:

```text
Processing batch 1/1 (batch size:2)
Batch 1 completed.
Finished concurrent flow: InvoiceFlow
```

<div class="callout callout--warning"><span class="callout__title">SELF_URL must be reachable</span><p><code>SelfClient</code> issues real HTTP requests to the value of <code>SELF_URL</code>. Behind a load balancer the workers may land on other instances, which is usually fine and occasionally surprising. In a test harness that boots the app in-process without a listening port, batch mode will not work.</p></div>

### Why fan out over HTTP

Calling the extraction in a loop inside one session would share a cursor, a
memory namespace, and one step-state bag across twenty documents — the second
extraction would overwrite the first. Posting to yourself buys full isolation
for free, and it means the batch scales the same way the endpoint does.

The cost is one HTTP hop per item and no shared transaction. If you need the
twenty results assembled into one document, collect them in `onBotResponse` and
return the assembly from `spawnSteps()`.

## Why it is written this way

The content-type mechanism is deliberately thin: a field on the step, set from
a builder, reported in the run response, and interpreted by your controller.
PicoFlow does not serialise, negotiate, or validate — it carries a value from
the tool handler that knows what it produced to the HTTP layer that knows how
to send it.

Batch mode is thin for the same reason. `concurrentSteps` is roughly thirty
lines of batching around a self-post. Everything that makes an item's run
correct — the config, the prompt, the tools, the completion — is the ordinary
one-shot path from lesson 1, unchanged.

## Common mistakes

- **Expecting the envelope on a non-plain response.** The controller sends
  `result.message` alone; `completed` and `success` are not in the body.
- **Returning a string you already stringified to `direct()`.** It will be
  sent as a JSON string, not an object. Pass the object.
- **Setting a content type without `markCompleted()` or a terminal step.** The
  body is right, but the session stays open and `completed` is `false`.
- **Assuming `concurrentSteps` shares state with the coordinator.** Each item
  is an independent session; use `onConfig` to pass everything it needs.
- **Setting `batchSize` to the size of the list without checking provider rate
  limits.** Every item in a batch is in flight at once.
- **Forgetting `config._concurrent`.** Without it the request runs the normal
  step loop and `spawnSteps()` is never called.

## Next

You have finished the InvoiceFlow track. For the complete `Step` contract —
tool batching, structured output, logic steps, and nested execution — work
through the [BasicFlow track](/docs/tutorials/basic-flow/). For multi-turn conversations
with memory compaction and cross-step state, see the
[HotelFlow track](/docs/tutorials/hotel-flow/).
