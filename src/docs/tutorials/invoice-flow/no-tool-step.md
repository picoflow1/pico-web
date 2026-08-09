---
title: 2. A step with no tools
eyebrow: InvoiceFlow tutorial
lede: NoToolStep has thirty lines, no tool definitions, and no lifecycle overrides. It builds a prompt, reads the model's reply, and routes. That is the whole minimum contract.
source: picoflow-demo/src/myflow/invoice-flow/no-tool-step.ts, picoflow-demo/src/myflow/invoice-flow/prompt/nt-prompt.md
---

Tools are how a model asks your application to do something. When there is
nothing to do — when the model's text *is* the result — a step needs neither
`defineTool()` nor a `@Tool` handler. `NoToolStep` is that case, and it is the
smallest useful step in the demo.

## The goal

- Write a step with only `getPrompt()` and `onResponse()`.
- Route from `onResponse()` by returning a transition instead of a string.
- Substitute an object into a prompt with `Prompt.replace2()`, and know how it
  differs from `Prompt.replace()`.
- Parse a model reply defensively with `StringUtil.parseJson`.

## The whole step

`picoflow-demo/src/myflow/invoice-flow/no-tool-step.ts`, complete:

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

A step earns a tool when the application has to *do* something — validate, look
something up, write to a database, decide a branch on data the model cannot
see. A step that only needs the model's own output does not, and adding a tool
in that case buys a schema round trip and an extra model turn for nothing.

The trade is real, though. Without a tool schema you have no structural
guarantee at all: the model can return prose, a fenced object, or an apology,
and `parseJson` will hand you `null` for two of the three. Use a tools-free
step when a `null` is cheap to handle, and reach for a tool schema — or
`structOutputSchema()`, covered in the BasicFlow track — when it is not.

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
