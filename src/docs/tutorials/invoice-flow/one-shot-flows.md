---
title: 1. The one-shot flow shape
eyebrow: InvoiceFlow tutorial
lede: Some workloads have no second turn. The caller posts once, the model and tool loop runs to completion inside that request, and the response is the result rather than an invitation to reply.
source: pico-demo/src/myflow/invoice-flow/invoice-flow.ts
---

HotelFlow and BasicFlow are shaped by the user: each HTTP request carries one
human sentence, and the flow's job is to decide what to say back. InvoiceFlow
is shaped by a document. The caller supplies a filename in `config`, and every
subsequent turn is internal — the model calls a tool, the tool answers, the
model calls another tool, and then the request returns. Nothing waits for a
person.

## The goal

- Recognise when a workload is one-shot rather than conversational.
- Register a flow whose default provider is not OpenAI.
- Understand what a session still gives you when there is only one request.
- Complete a flow without registering a terminal step.

## The whole flow class

`pico-demo/src/myflow/invoice-flow/invoice-flow.ts`:

```ts
export class InvoiceFlow extends Flow {
  protected configModel() {
    return {
      provider: "google",
      name: "gemini-2.5-flash",
      retryAttempts: 3,
    } as const;
  }

  protected defineSteps(): Step[] {
    return [
      new NoToolStep(this),
      new ExtractInvoiceStep(this).useMemory("invoice3").useModel({
        provider: "google",
        name: "gemini-3.1-pro-preview",
        params: { temperature: 0 },
      }),
      // new TerminateSessionStep(this)
      //   .useModel({ provider: "google", name: "gemini-2.5-pro" })
      //   .useMemory("temp"),
    ];
  }

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
}
```

`spawnSteps()` is batch mode and is covered in
[lesson 5](/docs/tutorials/invoice-flow/json-and-batch/). Everything else on the
class fits in fifteen lines.

## What makes it one-shot

Nothing in the framework marks a flow as one-shot. The shape emerges from three
choices.

**The prompt drives itself.** `invoice.md` tells the model exactly which tools
to call and in which order. There is no branch that depends on what a user says
next, so the model/tool loop runs until `capture_json` fires.

**The step never yields to a human.** Every tool handler returns either a
transition or a direct response. `stay(...)` — which returns control to the
model with corrective feedback and, eventually, to the user — does not appear
in this flow.

**The response is a payload.** `capture_json` returns
`direct(args?.json).withContentType(HttpContentType.Json)`, so the caller
receives the invoice object itself, not a chat envelope wrapping a sentence.

Compare the two request patterns:

```text
conversational        one-shot
--------------        --------
POST -> reply         POST
POST -> reply           model: call fetch_file
POST -> reply           tool:  upload, attach, re-enter
POST -> reply           model: call capture_json
   ...                  tool:  direct(json)
POST -> completed     <- 200 application/json
```

The one-shot request takes several internal model turns. The caller sees one
round trip.

## Choosing the provider

```ts
protected configModel() {
  return { provider: "google", name: "gemini-2.5-flash" } as const;
}
```

`configModel()` returns a provider-aware selection. The `as const` matters: the
model selection types are generic over the literal provider and name, so
widening them to `string` loses the compile-time check against the registered
catalogue.

The provider has to be registered on the engine. In the demo that happens once,
in `pico-demo/src/app.module.ts`:

```ts
FlowEngine.create({
  flows: [BasicFlow, HotelFlow, InvoiceFlow],
  //register pre-build providers, only specify what you use.
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      anthropic: { apiKey: config.get<string>("ANTHROPIC_API_KEY") },
    }),
  ],
})
```

One engine serves every flow, so a single application can run OpenAI-backed and
Google-backed flows side by side. The per-step override on `ExtractInvoiceStep`
is resolved the same way as the flow default.

<div class="callout callout--info"><span class="callout__title">Provider family is derived from the model name</span><p><code>Step.getLLMType()</code> classifies by prefix — names starting <code>gemini</code> or <code>gemma</code> map to <code>LLMType.GEMINI</code>, <code>gpt</code> to <code>OPENAI</code>, <code>claude</code> to <code>ANTHROPIC</code>, anything else to <code>UNSUPPORTED</code>. Lesson 4 uses that value to pick the right file-upload client, so an unusually named model will fail there even if the chat calls work fine.</p></div>

## Sessions still exist

A one-shot flow is not stateless. `FlowEngine.run()` creates a session
document, the response carries a `CHAT_SESSION_ID` header, and everything each
step saved with `saveState(...)` is persisted before the request returns. The
end-to-end spec relies on that:

```ts
const sessionDoc = await app
  .get(FlowEngine)
  .getFlowSession()
  .fetchAll(sessionId);

const extractionStep = invoiceFlow.steps?.find(
  (step) => step.name === "ExtractInvoiceStep",
);
assert.deepEqual(extractionStep.state?.json, invoice);
```

The extracted object is asserted twice — once as the HTTP body and once as
persisted step state. That is a good pattern for document workloads: the
response is convenience, and the durable record is the session document.

## Completing without a terminal step

The commented-out `TerminateSessionStep` in `defineSteps()` is not an
oversight. Completion here is a single call inside the tool handler:

```ts
this.flow.markCompleted();
return direct(args?.json).withContentType(HttpContentType.Json);
```

`markCompleted()` sets `runStatus = 'completed'` on the session document.
`Step.isEnd()` reads that same field, so the run response reports
`completed: true` even though the flow never routed to a step whose
`isEnd()` is hardcoded to `true`.

```ts
public isEnd(): boolean {
  return this.flow.getSessionDoc().runStatus === 'completed';
}
```

Registering `TerminateSessionStep` would add a final model call whose only
purpose is to say goodbye — reasonable in a chat, pure cost in a batch job that
processes ten thousand invoices.

<div class="callout callout--note"><span class="callout__title">Uncomment it if you want the closing turn</span><p>If a one-shot flow ever needs to hand a human-readable summary back, register the terminal step and route to it with <code>go(TerminateSessionStep).withPrompt(...)</code>. Its <code>onCrossing()</code> copies the prior step&rsquo;s content type, so a JSON-producing step&rsquo;s content type survives the handoff.</p></div>

## Why it is written this way

The one-shot shape is what lets the same `Flow` and `Step` abstractions cover a
chatbot and a batch document pipeline. Nothing is special-cased: there is one
cursor, one tool loop, one session document, and one response envelope. The
differences are all choices you make inside those primitives — which tools
exist, what the handlers return, and whether the response carries a content
type.

That uniformity is what makes batch mode possible at all. `spawnSteps()` fans
out by posting the *same* flow to itself with a different `config`, and each
worker session is an ordinary one-shot run.

## Common mistakes

- **Leaving `as const` off `configModel()`.** The literal types widen and the
  compile-time model check is lost.
- **Assuming a one-shot flow needs no session store.** State is persisted, and
  the spec asserts against it.
- **Registering a terminal step out of habit.** It costs a model call per run
  for no output the caller reads.
- **Using a model name the registered provider does not carry.** The provider
  is registered on the engine; the name has to exist in its catalogue.
- **Expecting `completed` to come from routing.** Here it comes from
  `markCompleted()` inside a tool handler.

## Next

[2. A step with no tools](/docs/tutorials/invoice-flow/no-tool-step/) takes apart
`NoToolStep`, the smallest step in the demo that still routes.
