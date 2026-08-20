---
title: 10. Response-driven steps
eyebrow: BasicFlow tutorial
lede: A step with no tools can still route. onResponse() inspects the model's reply, parses it, and returns the next step — or returns text and waits for another turn.
source: pico-demo/src/myflow/basic-flow/favorites-step.ts
---

`FavoritesStep` collects three values and defines no tools. It asks the model for a
JSON object in prose, parses whatever comes back, and decides from the parse result
whether to advance or ask again. It is the older of PicoFlow's two structured-data
patterns, and it is still the right shape when you want the step to loop until the
reply is well formed.

## What you will build

- A step that seeds its own first turn with `onCrossing()`.
- An `onResponse()` that parses the model's text with `StringUtil.parseJson`.
- A transition returned from `onResponse()` instead of from a tool handler.
- A fall-through that keeps the step active when parsing fails.

## The whole step

`pico-demo/src/myflow/basic-flow/favorites-step.ts`:

```ts
const PROMPT = Prompt.file("prompt/favorites.md");
const SCHEMA = Prompt.file("prompt/favorites.json");

export class FavoritesStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public onCrossing(
    _langMessage: MessageTypes,
    _priorStep?: string,
  ): MessageTypes {
    return new HumanMessageEx(this, "Hi");
  }

  public getPrompt(): string {
    const prompt = Prompt.replace(PROMPT, {
      QUESTION_SCHEMA: SCHEMA,
    });

    return prompt;
  }

  public async onResponse(
    llmResult: string | object,
  ): Promise<LastResponseType> {
    const json =
      typeof llmResult === "string"
        ? StringUtil.parseJson<JsonValue>(llmResult)
        : (llmResult as JsonValue);

    if (json && typeof json === "object" && !Array.isArray(json)) {
      this.saveState({ favorites: json });
      return go(NameStep);
    }

    return typeof llmResult === "string"
      ? llmResult
      : JSON.stringify(llmResult);
  }
}
```

## onCrossing seeds the first turn

`FavoritesStep` is entered from `GooLogicStep`, which is entered from `WeatherStep`'s
tool handler. By the time the cursor lands here, the user's original message
(`"LA,NYC"`) has already been consumed by `WeatherStep`. There is no fresh user input
to hand the model.

`onCrossing(message, priorStep)` runs on every top-level entry from a different step
and returns the message that will be pushed into this step's memory. The default
implementation forwards whatever it was given, synthesising a `"Start"` message when
there is nothing. `FavoritesStep` replaces it unconditionally:

```ts
return new HumanMessageEx(this, "Hi");
```

The model then sees the favourites system prompt plus a trivial user turn, and produces
the opening question — "what are your favourite colour, movie, and season?" — without
the user having asked for it. That is why the scenario's third turn sends `"LA,NYC"`
and gets the favourites question back.

Note the memory namespace matters here. `FavoritesStep` is registered with
`.useMemory("favorite")`, so this `"Hi"` lands in an isolated history and does not
pollute the shared `default` namespace that `NameStep`, `DOBStep`, and `AddressStep`
share. See [lesson 15](/docs/tutorials/basic-flow/memory-and-models/).

## Parsing the reply

`StringUtil.parseJson` is deliberately forgiving about the one thing models get wrong
most often — wrapping JSON in a markdown fence:

```ts
public static parseJson<T = unknown>(response: string): T | null {
  const cleaned = response
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned) as T;
  } catch (_error) {
    return null;
  }
}
```

It returns `null` rather than throwing. That is what makes the caller's shape work: one
guard covers both a parse failure and a reply that was prose all along.

The guard is specific:

```ts
if (json && typeof json === "object" && !Array.isArray(json)) {
```

`null` fails the first clause, a JSON array fails the third. Only a plain object
advances. `JSON.parse("[1,2]")` succeeds, so without the array check a malformed reply
would be saved as `favorites` and the flow would move on with garbage.

## Routing from onResponse()

```ts
this.saveState({ favorites: json });
return go(NameStep);
```

`onResponse()` returns `LastResponseType`, and `go(NameStep)` produces a
`{ step: "NameStep" }` object which the runner recognises:

```ts
} else if (llmResponse && "step" in llmResponse) {
  let step: Step;
  if (typeof llmResponse.step === "string") {
    step = await flow.gotoByName(llmResponse.step);
  } else {
    step = await flow.goto(llmResponse.step);
  }
  // ... apply prompt / state / contentType / message
  return await LlmRunner.send(flow, priorStep);
}
```

So the transition happens inside the same request, and `NameStep`'s model call runs
immediately after. The user's reply to `"blue, Star Wars, summer"` is the name
question, produced by `NameStep` — which is exactly what the scenario asserts.

You could also `return NameStep;` (the bare constructor) for the same effect without
attaching state or a prompt. The builder form is preferred because it extends.

## The implicit stay

The final lines are the loop:

```ts
return typeof llmResult === "string"
  ? llmResult
  : JSON.stringify(llmResult);
```

Returning a string takes the runner's text branch: the reply is appended to memory as
an AI message and returned to the caller. `flow.currentStep` is untouched, so
`FavoritesStep` handles the next user turn too. That is the no-tool equivalent of
`stay()`.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p><code>stay()</code> is <strong>not</strong> available in <code>onResponse()</code>. It resolves the executing step from a scope that only <code>invokeToolHandler</code> establishes, and throws outside one. To remain on the step, return the text; to remain on the step and re-prompt, return <code>go(ThisStep)</code>.</p></div>

The prompt is what makes this loop productive. `favorites.md` instructs:

```text
- If a required value is missing or outside the allowed choices, ask only for the
  missing or invalid value and preserve the valid values already supplied.
```

So a reply that is prose rather than JSON is usually the model asking a follow-up
question, which is exactly what should be shown to the user.

## Why it is written this way

Routing from `onResponse()` suits a stage whose output is *the reply itself* rather
than a discrete action. There is nothing to "call" here — no booking, no record
update — so a tool would be ceremony around a data transfer.

The cost is real, though. The contract between prompt and parser is prose. Nothing
prevents the model from returning `{"color": "blue"}` instead of
`{"favoriteColor": "blue"}`; `parseJson` succeeds, the object guard passes, and the
wrong shape is persisted. The schema in `favorites.json` is advisory text, not an
enforced constraint.

There are two stronger options, and BasicFlow demonstrates both elsewhere:

| Pattern | Enforcement | Used by |
| --- | --- | --- |
| Prose schema + `parseJson` | none — hope and a guard | `FavoritesStep` |
| `structOutputSchema()` | provider-side, from a Zod schema | `InContextStep`, [lesson 11](/docs/tutorials/basic-flow/structured-output/) |
| Tool with a Zod schema | provider-side, plus a handler that can reject | `NameStep`, `DOBStep`, `AddressStep` |

For new code that needs deterministic submission and validation, prefer the third. Use
this pattern when you are integrating with a prompt you do not control, or when the
step genuinely may return either data or conversation.

## Common mistakes

- **Calling `stay()` from `onResponse()`.** It throws. Return text instead.
- **Skipping the array check.** `JSON.parse` accepts arrays and scalars.
  `typeof [] === "object"` is `true`, so `!Array.isArray(json)` is doing real work.
- **Trusting the parsed keys.** A successful parse says nothing about the shape. If the
  keys matter — and here they do, the test asserts `favoriteColor` — validate them, or
  move to a tool schema.
- **Forgetting `onCrossing()` when the step is entered without user input.** Without
  it, the step is activated with whatever message the previous stage left behind, and
  the opening question may never be asked.
- **Overriding `onCrossing()` without considering the memory namespace.** The
  synthesised message is written to this step's history, which may be shared.

## Next

[11. Structured output](/docs/tutorials/basic-flow/structured-output/) replaces the prose
schema with one the provider enforces.
