---
title: Models and providers
eyebrow: Concepts
lede: PicoFlow ships no default model catalog. Every model resolves through a provider adapter your application registers, and the model catalog gives selections exact parameter types at compile time.
source: pf/docs/model-catalog.md
---

There is no hidden default model, no implicit API key lookup, and no built-in fallback
provider. If a flow names a model, your bootstrap code registered the adapter that knows how
to build it. This is more setup than a framework that ships a default, and it buys two
things: credentials never leak into flow source, and a typo in a model name fails at flow
startup instead of on a user's third turn.

## Two layers

| Layer | Owns | Where it lives |
| --- | --- | --- |
| **Provider adapter** | Connection setup: API key, base URL, endpoint, deployment, retry attempts | Application bootstrap, in `FlowEngine.create({ providers })` |
| **Model selection** | Which model, and its hyperparameters: temperature, reasoning effort, token limits | Flow and step source, in `configModel()` and `.useModel(...)` |

The separation is the point. An adapter answers "how do I reach this provider". A selection
answers "what should this stage of the conversation use". Changing the model a step uses is a
one-line source edit that needs no redeploy of credentials and no framework release.

<div class="callout callout--note"><span class="callout__title">Note</span><p>Because resolution passes the model name through dynamically, adding a new OpenAI or Google model ID to a flow does not require a PicoFlow release — provided the ID is in the catalog. See <a href="#the-model-catalog">the model catalog</a> below.</p></div>

## Registering providers

### Built-in adapters

`ModelProvider.createBuiltinAdapters(...)` returns adapters for PicoFlow's bundled
integrations. Pass connection options only for the ones you use:

```ts
FlowEngine.create({
  flows: [BasicFlow, HotelFlow, InvoiceFlow],
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      anthropic: { apiKey: config.get<string>("ANTHROPIC_API_KEY") },
    }),
  ],
});
```

| Option key | Provider name | Connection options |
| --- | --- | --- |
| `openai` | `openai` | `apiKey` |
| `azureOpenai` | `azure-openai` | `apiKey`, `endpoint`, `deploymentName`, `apiVersion` |
| `google` | `google` | `apiKey` |
| `anthropic` | `anthropic` | `apiKey` |
| `deepseek` | `deepseek` | `apiKey` |
| `moonshot` | `moonshot` | `apiKey`, `baseUrl` (defaults to Moonshot's OpenAI-compatible endpoint) |
| `zai` | `zai` | `apiKey`, `baseUrl` (defaults to Z.AI's OpenAI-compatible endpoint) |
| `ollama` | `ollama` | `baseUrl` |
| `openrouter` | `openrouter` | `apiKey` |

The factory returns all nine adapters every time, whether or not you supplied options for
them. That is harmless: an adapter is only asked to build a model when a flow or step
actually selects its provider, so an unused adapter with an undefined API key costs nothing.

### Custom adapters

`ModelProvider.createCustomAdapter(...)` builds an application-owned adapter on top of one of
PicoFlow's bundled runtimes. Use it for a provider with an OpenAI-compatible endpoint, an
internal gateway, or anything without a dedicated helper:

```ts
ModelProvider.createCustomAdapter({
  provider: "nvidia",
  runtimeProvider: "openai",
  config: {
    apiKey: config.get<string>("NVIDIA_API_KEY"),
    configuration: {
      baseURL: "https://integrate.api.nvidia.com/v1",
    },
  },
});
```

| Option | Meaning |
| --- | --- |
| `provider` | The public name your flows will select. Must be non-empty. |
| `runtimeProvider` | Which bundled LangChain runtime builds the model: `openai`, `azure-openai`, `google`, `anthropic`, `deepseek`, `ollama`, `openrouter` |
| `config` | Connection values passed to that runtime |
| `capabilities` | Optional per-selection capability report, currently `temperature: boolean` |
| `retryAttempts` | Optional positive integer. The runner's maximum attempts for this provider's models |

`provider` and `runtimeProvider` are deliberately independent. NVIDIA speaks the OpenAI wire
protocol but remains an application-owned integration with its own name, its own credential,
and its own catalog rules.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p><code>retryAttempts</code> is explicit by design and is never read from an environment variable. If a provider needs different retry behaviour, say so in code where a reviewer can see it.</p></div>

### Adapters do not set hyperparameters

A built-in adapter supplies connection setup and model construction. It does not inject a
default temperature, a default token limit, or a default retry count. Those belong in
`configModel()` or `.useModel(...)`, next to the step whose behaviour they affect.

Keep secrets in environment configuration and pass them to adapters at bootstrap. Never put
an API key in flow, step, or prompt source.

## Selecting a model

### Flow default

`configModel()` is abstract on `Flow`. Every flow must implement it, and its result becomes
the default for every step that does not override it.

```ts
protected configModel() {
  return {
    provider: "openai",
    name: "gpt-4o",
    params: { temperature: 0.2 },
  } as const;
}
```

The `as const` matters — it preserves the literal types so the catalog can select the exact
parameter shape.

### Per-step override

`.useModel(...)` is chained in `defineSteps()`:

```ts
protected defineSteps(): Step[] {
  return [
    new ExploreStep(this).useModel({
      provider: "openai",
      name: "gpt-5.1",
      params: { reasoning: { effort: "low" } },
    }),
    new PresentStep(this).useModel({
      provider: "openai",
      name: "gpt-4o",
      params: { temperature: 0.5 },
    }),
    new TerminateSessionStep(this),
  ];
}
```

This is a real design tool, not micro-optimisation. A step that extracts structured criteria
from messy user text benefits from a reasoning model; the step that renders a friendly
summary does not, and paying reasoning-token prices for it is waste. `HotelFlow` mixes
`gpt-4o` and `gpt-5.1` across four steps for exactly this reason.

An override is persisted on the step's document, so a restored session keeps the model it
started with. A step that inherits the flow default stores no model key at all.

### Resolution order

```text
step .useModel(...)      if present
  else flow configModel()
```

Both are validated at the start of every invocation, before any session I/O, and before the
first model call.

## The model catalog

Object-form selections are not untyped records at the `useModel()` boundary. PicoFlow derives
a discriminated union from a checked-in `PicoModelCatalog`, so for a known provider/model
pair TypeScript selects that entry's exact parameter type.

### Cataloged models

| Model ID | Parameter family |
| --- | --- |
| `openai:gpt-4o` | Chat: `temperature`, `topP`, `maxTokens`, `maxRetries`, `timeout` |
| `openai:gpt-4o-mini` | Chat |
| `openai:gpt-5` | Reasoning: `reasoning.effort`, `maxTokens`, `maxRetries`, `timeout` |
| `openai:gpt-5.1` | Reasoning |
| `google:gemini-2.0-flash` | Google chat: `temperature`, `maxOutputTokens`, `maxRetries` |
| `google:gemini-2.5-flash` | Google chat |
| `google:gemini-2.5-pro` | Google chat |
| `google:gemini-3.1-pro-preview` | Google chat |
| `anthropic:claude-sonnet-4-5` | Anthropic chat: `temperature`, `maxTokens`, `maxRetries` |
| `deepseek:deepseek-v3` | DeepSeek chat: `temperature`, `maxTokens`, `maxRetries` |
| `deepseek:deepseek-r1` | DeepSeek chat |

`reasoning.effort` accepts `minimal`, `low`, `medium` or `high`.

### Why temperature is a compile error on a reasoning model

```ts
new WeatherStep(this).useModel({
  provider: "openai",
  name: "gpt-5",
  params: {
    temperature: 0.2, // TypeScript error: not valid for this reasoning model.
  },
});
```

The catalog maps `openai:gpt-5` to the reasoning parameter type, which has no `temperature`
member. `useModel()` is generic over the literal provider and model, so TypeScript resolves
that exact type and rejects the property before you run anything.

The correct form:

```ts
new WeatherStep(this).useModel({
  provider: "openai",
  name: "gpt-5",
  params: { reasoning: { effort: "low" } },
});
```

This is not a stylistic preference. OpenAI's reasoning models reject a temperature override
at the API level; the catalog moves that failure from a production request to your editor.

### Three layers of enforcement

The same rule is checked three times, deliberately:

1. **Compile time** — `useModel()` selects the exact parameter type for a cataloged ID.
2. **Runtime, at the catalog boundary** — the selection is parsed against a `strict` Zod
   schema, so an unknown key fails even if it arrived from untyped JavaScript.
3. **Runtime, at the adapter** — the adapter reports capabilities per selection, and a
   `temperature` on a model whose adapter says `temperature: false` throws during flow
   startup validation.

Layer 3 covers models the catalog does not know about. PicoFlow's OpenAI adapter, for
example, reports `temperature: false` for any model matching `gpt-5*` or the `o`-series,
so a future reasoning model is rejected before it reaches the provider.

### Unknown models on a built-in provider are rejected

```ts
new WeatherStep(this).useModel({
  provider: "openai",
  name: "gpt-9-turbo",
});
```

```text
Unknown built-in model 'openai:gpt-9-turbo'. Add it to PicoModelCatalog before selecting it.
```

The built-in providers own their exact IDs. Selecting an uncataloged model for one of them
fails at compile time through `useModel()` and again at runtime during flow startup.

Application-owned providers stay open. A selection for `nvidia`, or any other custom
adapter, is accepted with a general parameter type and validated by your adapter at runtime.
PicoFlow does not pretend that a catalog loaded from JSON is compile-time knowledge.

### Provider-prefixed IDs

For integrations that prefer a single string, the catalog offers an equivalent form:

```ts
PicoModelCatalog.model("openai:gpt-5", { reasoning: { effort: "low" } });
```

Both forms use the same catalog definition and the same validation.

### configModel() cannot be checked the same way

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>TypeScript cannot infer and validate the return object of an overridden <code>configModel()</code>, because the method's declared return type is the broad selection shape. A flow default is only validated at runtime, when the flow starts. If you want a compile-time check on the default, use <code>PicoModelCatalog.model()</code> there.</p></div>

```ts
protected configModel() {
  return PicoModelCatalog.model("openai:gpt-4o", { temperature: 0.2 });
}
```

## Failure modes

| Symptom | Cause |
| --- | --- |
| `Model 'x:y' is not registered and provider 'x' has no adapter.` | The provider name in a selection has no registered adapter. Check spelling and the bootstrap list. |
| `Unknown built-in model 'openai:gpt-9'.` | A model ID not in the catalog, on a built-in provider. |
| `Model 'openai:gpt-5' does not support temperature.` | A hyperparameter the adapter reports as unsupported. |
| A provider call fails with an auth error | The adapter was registered with an undefined or empty API key. |

The first three all fail during flow startup, before any session work. That is intentional:
a model misconfiguration should never be discovered mid-conversation.

## Summary models

Memory compaction uses its own model selection, configured on the flow's memory container:

```ts
this.getMemory()
  .setSummaryModel({ provider: "openai", name: "gpt-4o" })
  .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
  .enableSummary("hotel-explore");
```

It goes through the same catalog validation and the same adapter registry as any other
selection. A cheap chat model is usually the right choice here — summarisation is not the
part of your system that needs reasoning tokens.

## Related

<div class="cards">
	<a class="card" href="/docs/guides/providers-and-models/">
		<span class="card__title">Register providers and models</span>
		<span class="card__body">Bootstrap patterns, including custom adapters.</span>
	</a>
	<a class="card" href="/docs/reference/model-catalog/">
		<span class="card__title">Model catalog</span>
		<span class="card__body">The full list of cataloged IDs and parameter types.</span>
	</a>
	<a class="card" href="/docs/concepts/state-memory-context/">
		<span class="card__title">State, memory, context, transient</span>
		<span class="card__body">Where the summary model fits into memory compaction.</span>
	</a>
</div>
