---
title: Providers
eyebrow: Reference
lede: "The bundled provider adapter factories, the connection options each one accepts, and how to build an application-owned adapter for a provider PicoFlow does not ship."
source: pf/src/picoflow/models/builtin-provider-adapters.ts
---

PicoFlow has no default model catalog and no ambient credentials. Every model a flow, a step,
or a memory summary selects must resolve through a provider adapter the application
registered. An adapter owns connection setup and runtime construction — nothing else.

```ts
import { ModelProvider } from "@picoflow/core";
```

## ModelProvider.createBuiltinAdapters()

```ts
static createBuiltinAdapters(
  options: BuiltinProviderAdaptersOptions = {},
): readonly ModelProviderAdapter[];
```

```ts
export type BuiltinProviderAdaptersOptions = Readonly<{
  openai?: ApiKeyProviderOptions;
  openaiAuth?: OpenAIAuthProviderOptions;
  azureOpenai?: AzureOpenAIProviderOptions;
  google?: ApiKeyProviderOptions;
  anthropic?: ApiKeyProviderOptions;
  deepseek?: ApiKeyProviderOptions;
  moonshot?: MoonshotProviderOptions;
  zai?: ZaiProviderOptions;
  ollama?: OllamaProviderOptions;
  openrouter?: ApiKeyProviderOptions;
}>;
```

```ts
providers: [
  ...ModelProvider.createBuiltinAdapters({
    openai: { apiKey: config.get("OPENAI_API_KEY") },
    google: { apiKey: config.get("GEMINI_API_KEY") },
    anthropic: { apiKey: config.get("ANTHROPIC_API_KEY") },
  }),
],
```

### The bundled adapters

| Option key | Registered provider name | LangChain runtime | Connection options |
| --- | --- | --- | --- |
| `openai` | `openai` | `openai` | `apiKey` |
| `openaiAuth` | `openai-auth` | `openai` Responses API | `authFile?`, `baseUrl?`; local Codex session by default |
| `azureOpenai` | `azure-openai` | `azure-openai` | `apiKey`, `endpoint`, `deploymentName`, `apiVersion` |
| `google` | `google` | `google` | `apiKey` |
| `anthropic` | `anthropic` | `anthropic` | `apiKey` |
| `deepseek` | `deepseek` | `deepseek` | `apiKey` |
| `moonshot` | `moonshot` | `openai` | `apiKey`, `baseUrl` — defaults to the Moonshot v1 endpoint |
| `zai` | `zai` | `openai` | `apiKey`, `baseUrl` — defaults to the Z.AI PaaS v4 endpoint |
| `ollama` | `ollama` | `ollama` | `baseUrl` |
| `openrouter` | `openrouter` | `openrouter` | `apiKey` |

Moonshot and Z.AI are OpenAI-compatible Chat Completions endpoints, so they reuse the OpenAI
runtime with a `baseURL` override while keeping their own provider name.

`openai-auth` is experimental. It reads the local Codex OAuth credential from
`~/.codex/auth.json` (or `PICOFLOW_OPENAI_AUTH_FILE`) on every request and targets an
undocumented ChatGPT/Codex endpoint. It is not a substitute for public OpenAI API-key
authentication; use `openai` for that supported path.

<div class="callout callout--note"><span class="callout__title">Available does not mean used by the demo</span><p><code>createBuiltinAdapters()</code> makes all ten bundled adapters available. The demo configures only OpenAI, Google, and Anthropic, because those are the providers its sample flows select. Add an option when your application selects another provider; an omitted credential surfaces only when that provider is used.</p></div>

Each adapter is also available on its own: `createOpenAIAdapter`, `createOpenAIAuthAdapter`,
`createAzureOpenAIAdapter`, `createGoogleAdapter`, `createAnthropicAdapter`, `createDeepSeekAdapter`,
`createMoonshotAdapter`, `createZaiAdapter`, `createOllamaAdapter`, `createOpenRouterAdapter`.

### Declared capabilities

The OpenAI and OpenAI-auth adapters declare a capability: they report `temperature: false` for model
names matching the `gpt-5` family and the `o`-series. `ModelRegistry` then rejects a
temperature override with `Model '<provider>:<name>' does not support temperature.`

For the cataloged `openai:gpt-5` and `openai:gpt-5.1` selections, `temperature` is rejected
by TypeScript before the application runs. The complete provider/model list and its parameter shapes live in the
[Model catalog](/docs/reference/model-catalog/).

## ModelProvider.createCustomAdapter()

```ts
static createCustomAdapter(
  options: ModelBackedProviderAdapterOptions,
): ModelProviderAdapter;
```

```ts
export type ModelBackedProviderAdapterOptions = Readonly<{
  provider: string;
  runtimeProvider: ModelRuntimeProvider;
  config?: Readonly<Record<string, unknown>>;
  capabilities?: (selection: ResolvedModelSelection) => ModelCapabilities;
  retryAttempts?: number;
}>;

export type ModelRuntimeProvider =
  | "openai"
  | "azure-openai"
  | "google"
  | "anthropic"
  | "deepseek"
  | "ollama"
  | "openrouter";
```

Use it for a provider that has no dedicated helper. The demo registers NVIDIA this way,
because NVIDIA speaks the OpenAI wire protocol but remains application-owned:

```ts
ModelProvider.createCustomAdapter({
  provider: "nvidia",
  runtimeProvider: "openai",
  config: {
    apiKey: config.get("NVIDIA_API_KEY"),
    configuration: { baseURL: "https://integrate.api.nvidia.com/v1" },
  },
}),
```

| Field | Notes |
| --- | --- |
| `provider` | The name a selection's `provider` must match. A blank value throws `A provider adapter requires a non-empty provider name.` |
| `runtimeProvider` | Which bundled LangChain model class constructs the instance |
| `config` | Connection values only — merged into the model constructor and stripped of the `provider` key |
| `capabilities` | Optional per-selection capability report, currently just `temperature` |
| `retryAttempts` | Fallback maximum runner attempts when the Flow or Step selection omits one. Must be a positive integer, and is deliberately never read from an environment variable |

When both the selected model and its adapter omit `retryAttempts`, the runner uses its own
default of three attempts.

### What a custom provider can type-check

An application-owned selection still preserves literal provider and model names, but its
`params` type is `Readonly<Record<string, unknown>>`. In other words, PicoFlow can type-check
the built-in catalog because it owns that contract; it intentionally treats an external
provider's parameters as dynamic. Use `validate(selection)` to reject unsupported model names
or parameter combinations, and `capabilities(selection)` for capability policy such as whether
`temperature` is allowed.

## Built-in versus application-owned

Two different notions of "built-in" are worth keeping apart.

| | Model catalog | Provider adapters |
| --- | --- | --- |
| Covers | `openai`, `openai-auth`, `google`, `anthropic`, `deepseek` | The ten names in the table above, plus anything you register |
| Enforces | Exact model IDs and their parameter types, at compile time and runtime | Connection setup and optional capability checks |
| Rejects an unknown model | Yes, for a built-in provider | No |

So `moonshot`, `zai`, `ollama`, `openrouter`, and `azure-openai` have bundled adapters but are
**not** catalog providers: their selections pass through `PicoModelCatalog.fromSelection()`
untouched, and the adapter is the only validator. See
[Model catalog](/docs/reference/model-catalog/).

## The adapter contract

```ts
export type ModelProviderAdapter = Readonly<{
  provider: string;
  validate?(selection: ResolvedModelSelection): void;
  capabilities?(selection: ResolvedModelSelection): ModelCapabilities;
  resolve(selection: ResolvedModelSelection): RuntimeModel;
}>;

export type RuntimeModel = Readonly<{
  provider: string;
  name: string;
  retryAttempts?: number;
  createInstance(): RuntimeChatModel;
  useTools(llm: RuntimeChatModel, tools?: DynamicStructuredTool[]): RuntimeChatModel;
}>;
```

`RuntimeChatModel` is deliberately structural — it requires only `invoke(input)`. An
application adapter can therefore bring its own provider package without PicoFlow compiling
that provider's model class.

`ModelRegistry.resolve()` prefers an adapter registered for the selection's provider. Only when
no adapter exists does it fall back to a legacy `Model` registered by name, and that fallback
also verifies the model's provider matches the selection.

## Adapters own connection setup only

An adapter must not set model defaults. Model name selection and hyperparameters belong in
`configModel()` and `useModel(...)`, so that:

- adding a new model ID for an existing provider needs no PicoFlow release;
- one adapter serves every model that provider offers; and
- the model plan persisted in the session document reflects what the flow chose, not what an
  adapter injected.

Sensitive parameter keys — `apiKey`, `api_key`, `authorization`, `credential`, `credentials`,
`password`, `secret`, `token` — are stripped recursively before a model selection is written to
a session document. Keep credentials in environment configuration, never in flow, step, or
prompt source. See [Register providers and models](/docs/guides/providers-and-models/).
