---
title: 4. Multimodal file uploads
eyebrow: InvoiceFlow tutorial
lede: A tool result is text, so a tool cannot hand a model an image. ExtractInvoiceStep uploads the file to the provider, builds a mixed text-and-file human message by hand, and re-enters itself with that message attached.
source: picoflow-demo/src/myflow/invoice-flow/extract-invoice.ts
---

This is the lesson the whole track exists for. The model asks for a file; the
handler cannot answer with a file; so the handler uploads it, wraps the
provider's content part in a human message, and returns a transition back to
the same step carrying that message. On the next model call, the image is in
the request.

## The goal

- Read server-supplied configuration with `getContext(...)`.
- Upload a document with `LLMFileManager` and get a provider-shaped content
  part back.
- Hand-build a `HumanMessage` with mixed text and file content.
- Re-enter the current step with `go(SelfStep).withMessage(msg)`.
- Understand exactly why the demo's path handling is unsafe.

## The filename comes from the request

```ts
public getPrompt(): string {
  const fileName = this.getContext<string>("config.fileName");
  const prompt = Prompt.replace(InvoicePrompt.ExtractInvoicePrompt, {
    FileName: fileName,
  });

  // './data/evergreen.png',
  return prompt;
}
```

`FlowEngine.run()` places the request's `config` object into the flow's
context, so `config.fileName` is a dotted path into it. Context is
request-scoped and read-only from a step's point of view — the right home for
server-supplied parameters, as against `saveState(...)`, which is durable and
step-owned.

The value goes into the prompt, where `invoice.md` tells the model to pass it
straight back:

```text
- **Fetch File:** immediately call `fetch_file` tool with set property `name` to {% raw %}{{FileName}}{% endraw %}.
```

Note the round trip that just happened. A server-controlled string was rendered
into a prompt, and it will come back as a **model-controlled** string in a tool
argument. That distinction is the whole of the security section below.

## Seeding the first turn

```ts
public onCrossing(
  langMessage: MessageTypes,
  _priorStep?: string,
): MessageTypes {
  if (!langMessage) {
    return new HumanMessageEx(this, "Hi, extract invoice");
  }
  return langMessage;
}
```

`NoToolStep` routes here with `.withState(...)` but no message, so
`langMessage` is `null` and the synthetic request supplies the opening turn.
When a message does arrive it is passed through untouched — unlike HotelFlow's
`PresentStep`, which discards whatever it is given.

## The two tools

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "fetch_file",
      description: "Capture name of file",
      schema: z.object({
        name: z.string().describe("Name of file"),
      }),
    },
    {
      name: "capture_json",
      description: "Capture json structure",
      schema: z.object({
        json: z.object({}).describe("The json structure captured"),
      }),
    },
  ];
}
```

Both live on one step, and the prompt sequences them. There is no state machine
enforcing that `fetch_file` runs before `capture_json` — enforcing it in code
would mean tracking a flag in step state and rejecting the out-of-order call
with `stay(...)`, which is what a production version should do.

## Upload, attach, re-enter

```ts
private uploadedFileCleanup?: () => Promise<void>;

private async cleanupUploadedFile(): Promise<void> {
  const cleanup = this.uploadedFileCleanup;
  this.uploadedFileCleanup = undefined;
  if (cleanup) await cleanup();
}

@Tool
protected async fetch_file(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const fileName = args?.name;
  const localPath = path.join(__dirname, fileName);
  this.saveState({ fileName: localPath });
  try {
    await this.cleanupUploadedFile();
    const fileMgr = new LLMFileManager(this.getLLMType());
    const result = await fileMgr.uploadFile(localPath);
    this.uploadedFileCleanup = result.cleanup;
    const id = fileMgr.getFileId(result);
    const userMsg = new HumanMessage({
      content: [
        {
          type: "text",
          text:
            `The requested invoice file has been uploaded and attached to this message as file id ${id}. ` +
            "Use the attached image content for extraction. Do not try to access the local path or filename again. " +
            "Extract the invoice JSON and call capture_json.",
        },
        result.contentPart as any,
      ],
      id: this.genMessageId(),
    });

    // go(...) re-enters this step so the model can read the attached invoice file.
    return go(ExtractInvoiceStep).withMessage(userMsg);
  } catch (_error) {
    await this.cleanupUploadedFile();
    throw new Error(`read file ${fileName} failed`);
  }
}

@Tool
protected async capture_json(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  try {
    this.saveState({ json: args?.json });
    this.flow.markCompleted();
    return direct(args?.json).withContentType(HttpContentType.Json);
  } finally {
    await this.cleanupUploadedFile();
  }
}
```

Four moving parts.

### LLMFileManager is provider-aware

```ts
const fileMgr = new LLMFileManager(this.getLLMType());
```

`getLLMType()` classifies the step's active model by name prefix — here
`gemini-3.1-pro-preview` maps to `LLMType.GEMINI`. The manager then uses the
matching client and returns a `FileContentPart`:

```ts
type FileContentPart = {
  llm: LLMType;
  contentPart: any;
  cleanup?: () => Promise<void>;
};
```

`contentPart` is already in the shape that provider's chat API expects, which
is why the handler can drop it into a message content array without further
translation. MIME type is inferred from the file extension, so `.png`, `.jpg`,
`.pdf`, `.mp3`, and `.mp4` all work without being declared.

`getFileId(result)` extracts the provider's id from that part — the field name
differs per provider, and this is the abstraction over that.

<div class="callout callout--note"><span class="callout__title">Clean up after extraction</span><p><code>FileContentPart</code> carries an optional <code>cleanup()</code>. Keep that callback across the self-reentry and invoke it in <code>capture_json</code>'s <code>finally</code> block, after the model has consumed the attachment. For OpenAI in particular, the uploaded file persists until deleted.</p></div>

### The message is built by hand

```ts
const userMsg = new HumanMessage({
  content: [ { type: "text", text: "..." }, result.contentPart as any ],
  id: this.genMessageId(),
});
```

This is the one place in the demo that constructs a raw LangChain
`HumanMessage` rather than a `HumanMessageEx`, because the content has to be an
array of parts rather than a string. The `id: this.genMessageId()` is not
optional — the runner uses step-scoped message ids to attribute history, and a
message without one cannot be placed.

The text part is doing real work. It tells the model the file is attached,
gives it the id, tells it explicitly **not** to try the path again, and names
the next tool. Without that last instruction, a model will often call
`fetch_file` a second time and loop.

### Self re-entry

```ts
return go(ExtractInvoiceStep).withMessage(userMsg);
```

The target is the step that is already current. `flow.gotoByName` short-circuits
in that case:

```ts
const currentStep = this.getCurrentStep();
if (currentStep?.getName() === stepName) return nextStep;
```

So no `onExit`, no `onEnter`, and — because the runner's cross-step detection
compares step names — no `onCrossing` either. The attached message is delivered
through a different path: after tool responses are processed, the runner looks
for a human message among them and starts a new model call with it.

```ts
//make another LLM call.............................
//find a human message, rare
for (const msg of toolResponseMessages) {
  if (msg.type === 'human') {
    return await LlmRunner.send(flow, priorStep, msg);
  }
}
```

The comment says "rare". This is that case: a tool that needs to inject content
into the conversation rather than answer with text.

### The error path loses the cause

```ts
} catch (_error) {
  throw new Error(`read file ${fileName} failed`);
}
```

The original error — a missing file, an expired API key, a rejected MIME type —
is discarded. Wrap with `{ cause: _error }` or log it before rethrowing;
debugging a provider upload failure from this message alone is unpleasant.

## The path is exploitable

<div class="callout callout--danger"><span class="callout__title">Security</span><p><code>const localPath = path.join(__dirname, fileName);</code> joins a directory to a string the <em>model</em> supplied in a tool argument. <code>path.join</code> resolves <code>..</code> segments, so a returned name of <code>../../../.env</code> produces a path outside the flow directory, and the file at that path is uploaded to a third-party provider. There is no allowlist, no <code>path.resolve</code> containment check, and no extension check. Treat every tool argument as untrusted input, exactly as you would a query parameter.</p></div>

The fix has two layers. Resolve and contain:

```ts
const dataRoot = path.resolve(__dirname, "data");
const candidate = path.resolve(dataRoot, args?.name ?? "");
if (candidate !== dataRoot && !candidate.startsWith(dataRoot + path.sep)) {
  return stay("That document is not available. Ask for a valid document id.");
}
```

Better still, do not accept paths at all. Have the tool take an opaque document
id and map it to a server-owned path:

```ts
const DOCUMENTS: Record<string, string> = {
  acme: "data/ACME.png",
  evergreen: "data/Evergreen.png",
};

const relative = DOCUMENTS[args?.id];
if (!relative) {
  return stay("Unknown document id.");
}
```

The model then cannot express a path that is not on the list, and the
`config.fileName` round trip through the prompt stops being a hazard.

Two smaller gaps in the same handler are worth closing at the same time:
`getPrompt()` does not check that `config.fileName` is present, so a request
without it renders `undefined` into the prompt; and nothing bounds the number
of times `fetch_file` may be called in one session.

## Why it is written this way

The upload has to happen inside a tool handler because that is the only place
in a turn where your code runs between two model calls with the ability to
change what the next call sees. `getPrompt()` is too early — the model has not
asked for anything yet. `onResponse()` is too late — the turn is over.

Making the file arrive as a *message* rather than as tool feedback is a
provider requirement, not a PicoFlow one: chat APIs accept mixed content on
user messages, not on tool results. The self re-entry is what turns that
requirement into two lines of application code.

## Common mistakes

- **Joining a model-supplied string to a base directory.** This is the demo's
  own defect; do not copy it.
- **Omitting `id: this.genMessageId()`.** The message cannot be attributed to a
  step's history.
- **Returning the file bytes as tool feedback.** Tool results are text; the
  model will get a string, not an image.
- **Expecting `onEnter()` or `onCrossing()` on self re-entry.** The cursor did
  not move, so neither fires.
- **Forgetting to tell the model not to re-fetch.** Without it, `fetch_file`
  loops.
- **Cleaning up before the model reads the attachment.** The upload must survive
  the self-reentry; clean it up in the extraction tool's `finally` block.

## Next

[5. Raw JSON and batch fan-out](/docs/tutorials/invoice-flow/json-and-batch/)
follows the extracted object out through the HTTP controller and then runs the
whole thing over a list of files.
