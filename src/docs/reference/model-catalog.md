---
title: Model catalog
eyebrow: Reference
lede: "The checked-in catalog of provider and model IDs, the exact parameter type each one accepts, and where TypeScript can and cannot check a selection for you."
source: pf/docs/model-catalog.md
---

PicoFlow keeps a small checked-in catalog that couples an exact public provider and model ID
to the parameters PicoFlow permits at that boundary. Both the compile-time types and the
runtime validator are generated from the same table.

```ts
import { PicoModelCatalog } from "@picoflow/core";
```

## Built-in model IDs

| ID | Parameter shape |
| --- | --- |
| `openai:gpt-4o` | OpenAI chat |
| `openai:gpt-4o-mini` | OpenAI chat |
| `openai:gpt-5` | OpenAI reasoning |
| `openai:gpt-5.1` | OpenAI reasoning |
| `google:gemini-2.0-flash` | Google chat |
| `google:gemini-2.5-flash` | Google chat |
| `google:gemini-2.5-pro` | Google chat |
| `google:gemini-3.1-pro-preview` | Google chat |
| `anthropic:claude-sonnet-4-5` | Anthropic chat |
| `deepseek:deepseek-v3` | DeepSeek chat |
| `deepseek:deepseek-r1` | DeepSeek chat |

| Shape | Members |
| --- | --- |
| OpenAI chat | `temperature?`, `topP?`, `maxTokens?`, `maxRetries?`, `timeout?` |
| OpenAI reasoning | `reasoning?.effort?` — one of `minimal`, `low`, `medium`, `high` — plus `maxTokens?`, `maxRetries?`, `timeout?` |
| Google chat | `temperature?`, `maxOutputTokens?`, `maxRetries?` |
| Anthropic chat | `temperature?`, `maxTokens?`, `maxRetries?` |
| DeepSeek chat | `temperature?`, `maxTokens?`, `maxRetries?` |

Every schema is `strict`, so an unknown key is a runtime error. `maxTokens` and
`maxOutputTokens` must be positive integers, `maxRetries` a non-negative integer, and
`timeout` a positive number.

The catalog's built-in providers are exactly `openai`, `google`, `anthropic`, and `deepseek` —
the prefixes appearing in the table above.

<div class="callout callout--note"><span class="callout__title">Cataloged is more specific than bundled</span><p>PicoFlow also ships adapters for Azure OpenAI, Moonshot, Z.AI, Ollama, and OpenRouter. Those integrations are bundled, but their model names and parameter contracts are not part of this checked-in catalog. See <a href="/docs/reference/providers/">Providers</a> for the complete adapter list.</p></div>

## PicoModelCatalog.fromSelection()

```ts
static fromSelection(selection: ModelSelection): CatalogModelSelection;
```

The runtime validator. It is called on the flow default from `configModel()`, on every
`Step.useModel(...)`, on `Memory.setSummaryModel(...)`, and again from
`FlowEngine.validateModel()`.

| Selection | Result |
| --- | --- |
| A cataloged ID | Params parsed by the matching strict Zod schema; a bad param throws |
| An unknown model under a built-in provider | Throws `Unknown built-in model '<id>'. Add it to PicoModelCatalog before selecting it.` |
| Any model under a non-built-in provider | Passed through with its params shallow-copied |

That third row is why an application-owned provider stays extensible: PicoFlow does not
pretend to know the parameter contract of an adapter it did not write.

## PicoModelCatalog.model()

```ts
static model<Model extends BuiltInModelId>(
  model: Model,
  params?: BuiltInModelParameters[Model],
): CatalogModelSelection;
```

The provider-prefixed form. It splits the ID and calls `fromSelection()`, so both forms share
one definition.

```ts
PicoModelCatalog.model("openai:gpt-5", { reasoning: { effort: "low" } });
```

`Model` is constrained to `BuiltInModelId`, so a typo in the ID and a parameter that does not
belong to that model are both compile errors.

## Object-form selection

The object form is the one flows and steps normally use, and it is not an untyped record at
the `useModel()` boundary:

```ts
new ExploreStep(this).useModel({
  provider: "openai",
  name: "gpt-5.1",
  params: { reasoning: { effort: "low" } },
});
```

```ts
public useModel<const Provider extends string, const Name extends string>(
  selection: ModelSelectionFor<Provider, Name>,
): this;
```

## The discriminated union

```ts
export type ModelSelectionFor<
  Provider extends string,
  Name extends string,
> = `${Provider}:${Name}` extends BuiltInModelId
  ? Extract<BuiltInModelSelection, { provider: Provider; name: Name }>
  : Provider extends BuiltInProvider
    ? never
    : CustomModelSelection<Provider, Name>;
```

Three branches, in order:

1. **The pair is cataloged.** TypeScript selects that entry's exact parameter type.
2. **The provider is built in but the model is not.** The type resolves to `never`, so the
   call does not compile. This is what reserves `openai`, `google`, `anthropic`, and
   `deepseek` for cataloged IDs.
3. **Anything else** is a `CustomModelSelection`, whose `params` is
   `Readonly<Record<string, unknown>>`.

That third branch is deliberate. PicoFlow can retain the literal provider and model names, but
it cannot honestly promise a static parameter contract for a provider defined in an application.
Define runtime validation on that adapter for the parameters your service accepts.

### Why temperature is a compile error on a reasoning model

`openai:gpt-5` maps to the reasoning parameter type, which has no `temperature` member:

```ts
new WeatherStep(this).useModel({
  provider: "openai",
  name: "gpt-5",
  params: {
    temperature: 0.2, // TypeScript error: not valid for this reasoning model.
  },
});
```

The runtime agrees for a second reason: `openAIReasoningSchema` is strict, so an unexpected
`temperature` key fails `fromSelection()` even if the type check is bypassed. A third check
exists at the adapter layer — the built-in OpenAI adapter reports
`temperature: false` for `gpt-5`-family and `o`-series names, and `ModelRegistry` rejects a
temperature override against it with
`Model '<provider>:<name>' does not support temperature.`

## Compile-time inference limits

<div class="callout callout--warning"><span class="callout__title">configModel() is not type-checked against the catalog</span><p><code>configModel()</code> is declared as returning the broad <code>ModelSelection</code> storage shape. TypeScript cannot infer the literal provider and model of an overridden method's return object against the union, so a bad parameter there is caught only at runtime, when the flow first resolves its model.</p></div>

Use `PicoModelCatalog.model()` inside `configModel()` when a compile-time check of the default
matters:

```ts
protected configModel() {
  return PicoModelCatalog.model("openai:gpt-4o", { temperature: 0.2 });
}
```

Two further limits are deliberate:

- **A catalog loaded from JSON at runtime cannot be statically checked.** Generating
  TypeScript declarations is the only honest way to get that, and PicoFlow does not
  misrepresent runtime JSON as compile-time knowledge.
- **Adding a model still requires a catalog entry.** A new OpenAI or Google model ID is
  rejected by both the type and `fromSelection()` until it is added. Application-owned
  providers have no such constraint, which is the escape hatch for a model PicoFlow has not
  cataloged yet — see [Providers](/docs/reference/providers/).

## Selection inheritance

A step without `useModel(...)` inherits the flow selection outright. A step with an override
merges params with the flow's **only** when the provider and name are both identical;
otherwise the override's params replace the flow's completely, so a cross-provider override
never inherits stray settings. An override that resolves equal to the flow selection is not
written to the step document.

See [Models and providers](/docs/concepts/models-and-providers/) for the conceptual view and
[Memory namespaces and model overrides](/docs/tutorials/basic-flow/memory-and-models/) for a
worked example.
