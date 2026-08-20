---
title: 2. A step with no tools
eyebrow: InvoiceFlow tutorial
lede: >
  NoToolStep has thirty lines, no tool definitions, and no lifecycle overrides. It
  uses a structured response as an application-controlled alternative to
  model-selected tool calling: prompt, receive, validate, and route in
  onResponse().
source: pico-demo/src/myflow/invoice-flow/no-tool-step.ts, pico-demo/src/myflow/invoice-flow/prompt/nt-prompt.md
---

Tools are one way a model asks your application to do something: the model must
first decide to emit a tool call, and only then does PicoFlow dispatch the
handler. That selection is not equally reliable across providers and model
sizes. A smaller model can follow a strong instruction and still answer in
prose instead of emitting the requested tool call, which means the handler
never runs.

`NoToolStep` demonstrates the important alternative. Ask the model for a
small, explicit structure, receive that structure as the normal model reply,
and let `onResponse()` become the response handler: parse or accept the object,
validate it, save it, run application logic if needed, and return the next
transition. There is no tool-selection decision for the model to miss.

This is not merely a way to write a step with fewer lines. It is a different
control channel. Instead of **model chooses a tool → tool handler runs**, the
application owns the path: **model returns data → `onResponse()` decides what
that data is allowed to do**. For stages whose real output is a command,
classification, extraction, or routing decision, this can replace tool calling
entirely.

## The goal

- Write a step with only `getPrompt()` and `onResponse()`.
- Route from `onResponse()` by returning a transition instead of a string.
- Substitute an object into a prompt with `Prompt.replace2()`, and know how it
  differs from `Prompt.replace()`.
- Parse a model reply defensively with `StringUtil.parseJson`.
- Recognise when a structured response handled by `onResponse()` is more
  reliable than waiting for a model-selected tool call.

## The whole step

`pico-demo/src/myflow/invoice-flow/no-tool-step.ts`, complete:

```ts
const PromptTemplate = Prompt.file("prompt/nt-prompt.md");
export class NoToolStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    const randomZip = (): string => {
      return Math.random() < 0.5 ? "97006" : "97005";
    };
    const prompt = Prompt.replace2(PromptTemplate, {
      internal_address: {
        street: "123 Main St",
        city: "Beaverton",
        state: "OR",
        zip: randomZip(),
      },
    });

    return prompt;
  }

  public async onResponse(
    llmResult: string | object,
  ): Promise<LastResponseType> {
    const parsedResult = StringUtil.parseJson<JsonValue>(llmResult as string);
    this.saveState({ current_date: parsedResult });

    return go(ExtractInvoiceStep).withState({
      from_previous: parsedResult as JsonValue,
    });
  }
}
```

No `defineTool()`. No `onEnter()`, no `onCrossing()`, no `useMemory(...)`. The
base class supplies all of them: the default `onCrossing()` injects a `"Start"`
message when the step is entered with nothing to say, and the constructor sets
the memory namespace to the class name.

## The prompt

`prompt/nt-prompt.md`:

````text
#Output Schema:
```json
current_date={
          year: "number",
          month: "number",
          day: "number",
        },
```
## Variables:
`internal_address` = {% raw %}{{internal_address}}{% endraw %};

## Instruction:

- if the 'internal_address.zip' ===97006, set `current_date` to today's date,
    else set `current_date` to 2023-01-01;

- output `current_date` in JSON format
````

The step exists to demonstrate mechanics, and the mechanic it demonstrates is a
branch the *model* has to evaluate: the zip code is randomised in
`getPrompt()`, so roughly half of all runs produce today's date and the other
half produce `2023-01-01`. Run the flow twice and you can see the substitution
actually reaching the model.

## The important technique: response-driven structured work

The prompt is asking for a data structure, not asking the model to call a tool:

```text
if the 'internal_address.zip' ===97006, set 'current_date' to today's date;
else set it to 2023-01-01;
output 'current_date' in JSON format
```

That distinction matters whenever a workflow depends on a model reliably
submitting a value. With a tool-based design, the model has to select the tool,
construct valid arguments, and emit the provider's tool-call message. If it
does not select the tool, `toolHandle`-style application code is never reached.

With a response-driven design, every ordinary model completion reaches
`onResponse()`:

```ts
public async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  const value =
    typeof llmResult === "string"
      ? StringUtil.parseJson<JsonValue>(llmResult)
      : (llmResult as JsonValue);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return go(NoToolStep).withPrompt(
      "Return only the requested JSON object with year, month, and day.",
    );
  }

  // Validate domain fields here before making a side effect or transition.
  this.saveState({ current_date: value });
  return go(ExtractInvoiceStep).withState({ from_previous: value });
}
```

The application, rather than the model, owns the decision after the response
arrives. `onResponse()` can reject malformed data, issue a corrective prompt,
call a service directly, save state, choose a step, or return a final response.
That makes it analogous to a tool handler in responsibility, while avoiding the
unreliable **tool selection** step.

There are two versions of this technique in the examples:

| Response contract | What arrives in `onResponse()` | Trade-off |
| --- | --- | --- |
| Prompted JSON + `StringUtil.parseJson` | Text that the application parses | Works broadly, but syntax and field correctness must be validated by application code. This is the exact `NoToolStep` pattern. |
| `structOutputSchema()` + `onResponse()` | A parsed object | The provider enforces more of the shape, while `onResponse()` still owns domain validation, side effects, and routing. See [BasicFlow's structured-output lesson](/docs/tutorials/basic-flow/structured-output/). |

The pattern is strongest when the model's job is to produce one structured
decision or payload. It does not make external work happen by itself: if the
step must fetch a file, update an order, or charge a card, `onResponse()` must
call the application service and handle its result, or a tool handler remains a
good boundary. The key question is whether you need the model to *choose an
operation* or only to *return the data that your code will interpret*.

For smaller models, this distinction is often decisive. A prompt can tell the
model exactly what structure to return, and the application can make the final
decision even when the model fails to follow the ideal format. A tool-only
design has no equivalent recovery path when the model simply answers without
calling the tool.

## replace2 against replace

The two substitution helpers look interchangeable and are not:

{% raw %}
```ts
public static replace(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/{{(.*?)}}/g, (match, key) => {
    return values[key] || match;
  });
}

public static replace2(
  template: string,
  values: Record<string, any>,
): string {
  return template.replace(/{{(.*?)}}/g, (match, key: string) => {
    const value = values[key.trim()];

    if (value === undefined) {
      return match;
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
```
{% endraw %}

| | `replace` | `replace2` |
| --- | --- | --- |
| Value type | `string` only | `any` |
| Non-strings | not handled — you stringify first | `JSON.stringify`d for you |
| Missing key | falls back on `\|\|`, so `""` and `0` also fall back | falls back only on `undefined` |
| Key whitespace | not trimmed, `{% raw %}{{ key }}{% endraw %}` misses | trimmed, so spacing is tolerated |

`NoToolStep` passes a nested object, so `replace2` is the only one that works
without an explicit `JSON.stringify` at the call site. HotelFlow's steps pass
pre-stringified JSON and use `replace`. Prefer `replace2` for new code; its
`undefined` check and key trimming remove two easy mistakes.

## onResponse and the response type

`onResponse()` is called with the model's text once a turn produces no tool
call. The base implementation just passes it through:

```ts
public async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  if (typeof llmResult === 'object') {
    return JSON.stringify(llmResult);
  }
  return llmResult;
}
```

`LastResponseType` is the union that makes routing from `onResponse()`
possible:

```ts
export type LastResponseType =
  | {
      step: StepTarget;
      message?: MessageTypes;
      prompt?: string;
      state?: JsonObject;
      contentType?: HttpContentType;
    }
  | StepTarget;
```

So an override has three options:

| Return | Effect |
| --- | --- |
| a `string` | That text becomes the reply and is appended to the step's history |
| a `Step` class or step name | The cursor moves and the destination runs immediately |
| a `go(...)` builder | Same, with state, a prompt, a message, or a content type attached |

`NoToolStep` returns the third form. The runner applies it exactly as it would
a tool handler's transition:

```ts
} else if (llmResponse && 'step' in llmResponse) {
  let step: Step;
  if (typeof llmResponse.step === 'string') {
    step = await flow.gotoByName(llmResponse.step);
  } else {
    step = await flow.goto(llmResponse.step);
  }
  ...
  return await LlmRunner.send(flow, priorStep);
}
```

That trailing `send` is why the whole flow completes in one HTTP request:
`ExtractInvoiceStep` starts running immediately, inside the same turn.

<div class="callout callout--warning"><span class="callout__title">stay() does not work here</span><p><code>stay()</code> resolves the current step from the tool-handler execution scope, which <code>onResponse()</code> is not inside. Calling it there throws. To loop, return the current step class or a <code>go(ThisStep)</code> builder explicitly.</p></div>

## Parsing the reply

```ts
const parsedResult = StringUtil.parseJson<JsonValue>(llmResult as string);
```

The prompt asked for "JSON format", which in practice often arrives wrapped in
a Markdown fence. `StringUtil.parseJson` strips the fence before parsing and
returns `null` instead of throwing:

```ts
public static parseJson<T = unknown>(response: string): T | null {
  // Remove markdown code fences if present
  const cleaned = response
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(cleaned) as T;
  } catch (_error) {
    return null;
  }
}
```

`null` is a real possibility, and `NoToolStep` does not check for it — it saves
and forwards whatever came back. In production, a `null` here should either
route back to this step with corrective instructions or fail the request
loudly; silently forwarding `null` as state is the sort of defect that only
shows up much further downstream.

## Two writes, one of them unused

```ts
this.saveState({ current_date: parsedResult });

return go(ExtractInvoiceStep).withState({
  from_previous: parsedResult as JsonValue,
});
```

The first writes to `NoToolStep`'s own state; the second writes to
`ExtractInvoiceStep`'s. It is a compact demonstration of the two directions:
`saveState` is local, `.withState` is for the destination.

<div class="callout callout--note"><span class="callout__title">The demo never reads from_previous</span><p><code>ExtractInvoiceStep</code> does not reference <code>from_previous</code> anywhere. The value is carried across the transition and persisted, but nothing consumes it. It is here to show the mechanism, not because the extraction needs a date.</p></div>

## Why it is written this way

A step earns a tool when the model must choose an application operation and the
operation benefits from the tool-call protocol. A step that only needs the
model's own output — or needs the application to interpret a structured model
decision — does not have to expose a tool at all. Adding a tool in that case
introduces another model decision and gives smaller models another way to fail.

The trade is real, though. Without a provider-enforced schema the model can
return prose, a fenced object, or an apology, and `parseJson` will hand you
`null` for two of the three. Treat parsing and domain validation as part of the
response-handler contract. Use a prompted response when portability and
application control matter most; use `structOutputSchema()` when the provider's
structured-output support is available; use a tool when the model must invoke a
real application operation through the tool protocol.

## Common mistakes

- **Calling `stay()` from `onResponse()`.** There is no tool execution scope;
  it throws.
- **Returning a string when you meant to route.** A string ends the turn as the
  reply, and the cursor does not move.
- **Ignoring a `null` from `parseJson`.** It is the documented failure result,
  not an edge case.
- **Using `Prompt.replace` with a non-string value.** It writes
  `[object Object]` into the prompt. Use `replace2` or stringify first.
- **Assuming a step without `defineTool()` cannot route.** Routing is a return
  value, not a tool feature.

## Next

[3. Example-as-schema prompting](/docs/tutorials/invoice-flow/example-as-schema/)
looks at the extraction prompt, which pins a fifty-field output shape without
declaring a schema at all.
