---
title: Register providers and models
eyebrow: Guides
lede: PicoFlow resolves every model through an adapter your application registers. This is how to wire the bundled adapters, add your own, and decide where connection settings end and hyperparameters begin.
source: pf/docs/model-catalog.md
---

You need this the first time a flow fails with `provider '...' has no adapter`, and again
whenever you add a provider, an OpenAI-compatible endpoint, or a per-step model override.
PicoFlow deliberately ships no default model, reads no API key on its own, and has no
fallback provider.

## The resolution rule

Three separate things have to line up:

```text
configModel() / useModel()   ->  { provider, name, params, retryAttempts? }
PicoModelCatalog             ->  validates params for cataloged provider:name IDs
registered ModelProviderAdapter for `provider`  ->  builds the runtime model
```

Validation happens at flow bootstrap for the flow model and for every step model, so a
mistyped model name fails on the first request rather than mid-conversation.

## Registering the bundled adapters

`ModelProvider.createBuiltinAdapters(options)` returns adapters for OpenAI, Azure OpenAI,
Google, Anthropic, DeepSeek, Moonshot, Z.AI, Ollama and OpenRouter. Pass connection settings
for the ones you actually use:

```ts
FlowEngine.create({
  flows: [BasicFlow, HotelFlow, InvoiceFlow],
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      anthropic: { apiKey: config.get<string>("ANTHROPIC_API_KEY") },
      // moonshot:   { apiKey: config.get<string>("MOONSHOT_API_KEY") },
      // zai:        { apiKey: config.get<string>("ZAI_API_KEY") },
      // deepseek:   { apiKey: config.get<string>("DEEPSEEK_API_KEY") },
      // openrouter: { apiKey: config.get<string>("OPENROUTER_API_KEY") },
      // ollama:     { baseUrl: config.get<string>("OLLAMA_BASE_URL") },
    }),
  ],
});
```

<div class="callout callout--note"><span class="callout__title">Available does not mean used by the demo</span><p><code>createBuiltinAdapters()</code> always returns the full set of nine adapters. The demo configures only OpenAI, Google, and Anthropic because those are the providers its sample flows use. Add an option when your own flow selects another provider.</p></div>

Individual factories exist when you want finer control: `createOpenAIAdapter`,
`createAzureOpenAIAdapter`, `createGoogleAdapter`, `createAnthropicAdapter`,
`createDeepSeekAdapter`, `createMoonshotAdapter`, `createZaiAdapter`,
`createOllamaAdapter`, `createOpenRouterAdapter`.

Azure OpenAI takes deployment values rather than a plain key:

```ts
ModelProvider.createAzureOpenAIAdapter({
  apiKey: config.get<string>("AZURE_OPENAI_API_KEY"),
  endpoint: config.get<string>("AZURE_OPENAI_ENDPOINT"),
  deploymentName: config.get<string>("AZURE_OPENAI_DEPLOYMENT"),
  apiVersion: "2024-10-21",
});
```

## Adding your own adapter

`createCustomAdapter()` builds an application-owned adapter on top of one of PicoFlow's
bundled LangChain runtimes. Use it for any OpenAI-compatible endpoint that has no dedicated
helper. The demo registers NVIDIA this way:

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

| Option | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | The string flows write in `configModel()` / `useModel()`. Must be non-empty |
| `runtimeProvider` | yes | Which bundled runtime builds the client: `openai`, `azure-openai`, `google`, `anthropic`, `deepseek`, `ollama`, `openrouter` |
| `config` | no | Connection settings merged into every constructed model |
| `capabilities` | no | `(selection) => ({ temperature?: boolean })`, used to reject unsupported params |
| `retryAttempts` | no | Positive integer fallback when a Flow or Step selection does not provide one |

`retryAttempts` is intentionally explicit and is never read from an environment variable. A
Flow or Step selection takes precedence over this provider-wide fallback. A non-integer or a
value below 1 throws at adapter creation.

The NVIDIA adapter makes the trade-off concrete. This compiles, but its `params` are dynamic —
PicoFlow does not know NVIDIA's model-specific contract:

```ts
new RecommendationStep(this).useModel({
  provider: "nvidia",
  name: "meta/llama-3.1-70b-instruct",
  params: { temperature: 0.2, maxTokens: 800 },
});
```

That is different from a cataloged selection such as `openai:gpt-5`: TypeScript rejects an
unsupported key such as `temperature` before the program runs. A custom adapter can enforce
its own runtime contract with `validate(selection)` and `capabilities(selection)`.

A fully custom adapter is also allowed — anything satisfying `ModelProviderAdapter`:

```ts
const adapter: ModelProviderAdapter = {
  provider: "in-house",
  validate(selection) { /* throw on anything you will not serve */ },
  capabilities: () => ({ temperature: false }),
  resolve(selection) {
    return {
      provider: selection.provider,
      name: selection.name,
      createInstance: () => new MyChatModel(selection),
      useTools: (llm, tools) => llm.bindTools(tools),
    };
  },
};
```

## Object-form model selection

Flows and steps select models with the same object shape:

```ts
protected configModel() {
  return {
    provider: "openai",
    name: "gpt-4o",
    params: { temperature: 0.2 },
    retryAttempts: 3,
  } as const;
}

new ExploreStep(this).useModel({
  provider: "openai",
  name: "gpt-5.1",
  params: { reasoning: { effort: "low" } },
});
```

For IDs that appear in `PicoModelCatalog`, TypeScript narrows `params` to that model's exact
parameter contract, and `PicoModelCatalog.fromSelection()` re-validates at runtime with a
strict Zod schema. A `temperature` on a reasoning model is a compile error; an unknown
parameter key is a runtime error.

The catalog currently covers:

```text
openai:gpt-4o          openai:gpt-4o-mini      openai:gpt-5        openai:gpt-5.1
google:gemini-2.0-flash                        google:gemini-2.5-flash
google:gemini-2.5-pro  google:gemini-3.1-pro-preview
anthropic:claude-sonnet-4-5
deepseek:deepseek-v3   deepseek:deepseek-r1
```

<div class="callout callout--warning"><span class="callout__title">Cataloged providers are closed</span><p>Once a provider appears anywhere in the catalog — currently <code>openai</code>, <code>google</code>, <code>anthropic</code> and <code>deepseek</code> — selecting an <em>uncataloged</em> model under it throws <code>Unknown built-in model 'openai:gpt-4.1'. Add it to PicoModelCatalog before selecting it.</code> Adding a new OpenAI or Google model ID therefore does require a PicoFlow catalog change, contrary to what the workflow developer guide states. Providers with no catalog entries, such as <code>nvidia</code>, <code>moonshot</code>, <code>ollama</code> and <code>openrouter</code>, remain open and are validated only by their adapter.</p></div>

`PicoModelCatalog.model("openai:gpt-5", { reasoning: { effort: "low" } })` is the
provider-prefixed alternative. It is worth using inside `configModel()`, where TypeScript
cannot infer the return object's contextual type and so cannot check the object form.

## Where hyperparameters belong

This is the division that causes the most confusion:

| Setting | Belongs in | Why |
| --- | --- | --- |
| API key, base URL, endpoint, deployment, API version | The adapter's `config` | Connection identity, one per process, secret |
| `temperature`, `topP`, `maxTokens`, `reasoning.effort`, `maxOutputTokens` | `configModel()` or `useModel()` `params` | Per-flow or per-step behaviour, persisted in the session document |
| `retryAttempts` | The Flow or Step model selection | A runner policy persisted with the selection; an adapter can supply only the fallback |
| `timeoutMs` | Flow or Step `configLlmCallPolicy()` | A provider-neutral, per-invocation-attempt deadline; code-owned and not persisted |

The bundled helpers deliberately set no model defaults. An adapter that quietly injected
`temperature: 0.7` would silently override every flow that did not restate it. Set retry
policy just as explicitly on the Flow or Step where it is reviewed with the workflow.

### How step params merge

`resolveStepModelSelection` merges only when the step names the *same* provider and model as
the flow:

```ts
// Flow:  { provider: "openai", name: "gpt-4o", params: { temperature: 0.2 } }

new StepA(this).useModel({ provider: "openai", name: "gpt-4o",
  params: { maxTokens: 800 } });
// -> { temperature: 0.2, maxTokens: 800 }   merged

new StepB(this).useModel({ provider: "openai", name: "gpt-5.1",
  params: { reasoning: { effort: "low" } } });
// -> { reasoning: { effort: "low" } }       flow params dropped
```

A step with no `useModel(...)` inherits the flow selection with empty params at bootstrap and
persists no `model` field of its own. A step override *is* persisted, so changing
`useModel(...)` in code does not retroactively change a running session.

### Temperature capability checks

The OpenAI adapter reports `temperature: false` for `gpt-5*` and `o`-series models. Supplying
one is rejected during validation:

```text
Model 'openai:gpt-5' does not support temperature.
```

<div class="callout callout--note"><span class="callout__title">Unsupported parameters are configuration errors</span><p>The current source rejects an unsupported temperature override during model validation at flow bootstrap. Choose a compatible model or remove the parameter.</p></div>

## Keeping secrets out of flow and step source

Model selections are written into the session document on every save. Before persisting,
`toPersistedModelSelection()` strips any parameter key that looks like a credential —
`apikey`, `api_key`, `authorization`, `credential`, `credentials`, `password`, `secret`,
`token` — recursively, including inside nested objects and arrays.

That is a backstop, not a design. Do not rely on it:

- put credentials in the adapter's `config`, sourced from environment configuration;
- never put an `apiKey` in `configModel()`, `useModel()`, step state, or prompt text;
- remember prompt files are shipped as plain assets and are not a security boundary;
- remember flow context is persisted verbatim, so `config` sent by a caller is stored.

## Failure modes

| Message | Cause |
| --- | --- |
| `Model 'p:n' is not registered and provider 'p' has no adapter.` | No adapter registered for that provider string |
| `Unknown built-in model 'openai:x'.` | A cataloged provider was used with an uncataloged model name |
| `Model 'p:n' does not support temperature.` | `params.temperature` on a reasoning model, or an adapter reporting the capability as false |
| Zod `Unrecognized key(s)` | A parameter name that is not in that model's strict catalog schema |
| `Cannot infer provider for model 'x'. Set config.provider explicitly.` | The legacy `Model` path could not derive a provider from the model name |
| `Provider 'p' retryAttempts must be a positive integer.` | Bad `retryAttempts` in `createCustomAdapter` |
| `Flow 'X' configModel() did not provide a model name.` | `configModel()` returned an object with an empty `name` |

Related: [Models and providers](/docs/concepts/models-and-providers/) for the concepts,
[Memory namespaces and model overrides](/docs/tutorials/basic-flow/memory-and-models/) for a
worked lesson, and [Model catalog](/docs/reference/model-catalog/) for the normative tables.
