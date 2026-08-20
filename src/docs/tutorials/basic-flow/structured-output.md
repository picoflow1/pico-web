---
title: 11. Structured output
eyebrow: BasicFlow tutorial
lede: structOutputSchema() hands a Zod object to the provider so the reply arrives as typed data instead of text you have to parse.
source: pico-demo/src/myflow/basic-flow/incontext-step.ts
---

The previous lesson asked for JSON in prose and parsed whatever came back.
`structOutputSchema()` does the same job with the provider enforcing the shape. One
method, and `onResponse()` receives an object rather than a string.

## The goal

- Return a Zod object from `structOutputSchema()`.
- Understand what the runner does with it.
- Handle an object in `onResponse()` instead of a string.
- Know when structured output is the wrong tool.

## The schema

From `pico-demo/src/myflow/basic-flow/incontext-step.ts`:

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

The prompt is one line:

```ts
public getPrompt(): string {
  return `
    "Generate a sci-fi movie idea suitable for teens.";
  `;
}
```

That asymmetry is the point. The prompt states the task; the schema states the output
contract. There is no sentence saying "return JSON with these five fields" because the
provider is given the field list directly.

`.describe()` matters for the same reason it matters on a tool schema — the
descriptions are serialised into the provider's schema and are what disambiguate
`releaseYear` from "the year I am writing this".

## What the runner does with it

In `LlmRunner.send`, immediately after tools are bound:

```ts
llm = model.useTools(llm, tools);
const structSchema = step.structOutputSchema();
if (structSchema) {
  llm = (llm as any).withStructuredOutput(structSchema) as any;
}
```

The base implementation returns `null`, so steps that do not override it are
unaffected. When a schema is present the model instance is wrapped with LangChain's
`withStructuredOutput`, which uses whatever native mechanism the provider offers —
JSON mode, response schemas, or a synthetic tool call, depending on the adapter.

The consequence is visible on the return path. `llm.invoke(...)` no longer resolves to
an `AIMessageChunk` with a `content` string; it resolves to the parsed object. That is
why `onResponse()` is typed `string | object` and why `InContextStep` casts:

```ts
public async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  this.saveState({ who: llmResult as JsonValue });
  return JSON.stringify(llmResult);
}
```

`saveState` gets the object directly — no parse, no fence-stripping, no null check.
The `JSON.stringify` on the return line is only there because the caller
(`NameStep`, via `runStep`) wants message content, and `LastResponseType`'s text branch
expects a string.

The scripted model used by the contract test makes the shape explicit:

```ts
if (this.structuredOutput && systemPrompt.includes("sci-fi movie idea")) {
  return {
    title: "Orbit Academy",
    genre: "Science fiction",
    releaseYear: 2030,
    rating: 8,
    summary: "Teen cadets protect their orbital school from a rogue satellite.",
  };
}
```

It tracks a `structuredOutput` flag set by its own `withStructuredOutput()` stub and
returns a plain object rather than an `AIMessage`. That is a faithful model of what the
real adapters do.

## Structured output, tools, and the interaction between them

`structOutputSchema()` and `defineTool()` are applied to the same model instance, in
that order. `InContextStep` defines no tools, which is the clean case.

Mixing them is provider-dependent and generally a mistake. Several providers implement
structured output *as* a forced tool call, so binding both leaves the model with two
competing output channels. If a step needs to both call a tool and return typed data,
put the data in the tool's Zod schema and read it from `args` in the handler — that is
what `DOBStep` does with `{ year, month, day }`.

<div class="callout callout--note"><span class="callout__title">Note</span><p><code>structOutputSchema()</code> is declared as returning <code>object | null</code> rather than a Zod type. It is passed through to <code>withStructuredOutput</code> untyped, so the compiler will not stop you returning something that is not a schema. The failure appears at the provider call.</p></div>

## Three ways to get typed data, compared

| Mechanism | Where the shape is enforced | Can reject and re-ask | Used by |
| --- | --- | --- | --- |
| Prose schema + `StringUtil.parseJson` | nowhere | yes, by returning text | `FavoritesStep` |
| `structOutputSchema()` | the provider | no — the reply is the result | `InContextStep` |
| Tool with a Zod schema | the provider, plus your handler | yes, with `stay(reason)` | `NameStep`, `DOBStep`, `AddressStep` |

The middle row's limitation is the one that decides most real cases. Structured output
gives you a well-shaped object, but there is no natural place to say "that rating is
out of range for this catalogue, try again" and loop. `onResponse()` can return
`go(ThisStep)` to force another pass, but you have no tool-result channel to explain
why.

So: use `structOutputSchema()` when the step's entire job is to produce one typed value
and any well-formed value is acceptable. Use a tool when the value must pass a domain
check before it is accepted.

## Why it is written this way

`InContextStep` produces a movie idea that nothing in the flow actually consumes — it
is saved to state and returned to `NameStep`, which stores it under `inContext`. As a
piece of product logic it is filler. As a demonstration it is well chosen, because it
isolates structured output from routing: there is no tool, no transition, and no
validation to confuse the picture. The step's other responsibilities — nested children
from `onEnter()`, transient state, an isolated memory namespace — are each covered in
their own lesson.

Putting the schema behind a method rather than a static field means it can depend on
state. A step could return a narrower enum based on what an earlier stage collected:

```ts
public structOutputSchema(): object {
  const allowed = this.flow.getStepState<string[]>(CatalogStep, "genres");
  return z.object({ genre: z.enum(allowed as [string, ...string[]]) });
}
```

It is called once per model invocation, alongside `getPrompt()`, so it sees current
state.

## Common mistakes

- **Also describing the JSON shape in the prompt.** Redundant at best; when the two
  disagree, the provider follows the schema and you are left debugging prose.
- **Assuming `llmResult` is a string.** With a schema bound it is an object. Handle
  both, as `FavoritesStep` does, or cast deliberately, as `InContextStep` does.
- **Combining a struct schema with tool bindings.** Provider-dependent and usually
  broken. Choose one output channel.
- **Expecting validation to be re-askable.** A schema shapes the reply; it does not
  give you a rejection path. Use a tool when you need to say no.
- **Returning a raw object from `onResponse()` when the caller wants text.**
  `LastResponseType`'s text branch is a string. `InContextStep` stringifies for exactly
  this reason.

## Next

`InContextStep` never becomes `flow.currentStep`. [12. Nested execution: runStep()](/docs/tutorials/basic-flow/nested-runstep/)
explains how `NameStep` calls it.
