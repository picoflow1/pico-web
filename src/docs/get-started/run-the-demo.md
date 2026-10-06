---
title: Run the demo app
eyebrow: Get started
lede: Install and start the NestJS demo application, set only the environment variables you actually need, and run the end-to-end flow scenarios.
source: pico-demo/README.md, pico-demo/src/app.module.ts, pico-demo/package.json
---

The demo is a NestJS + Fastify service that registers the example flows, exposes them over
HTTP, and carries the end-to-end scenarios used to validate them. It is the fastest way to
read real PicoFlow code that runs.

## Get the source

```bash
git clone https://github.com/picoflowio/pico-demo
cd pico-demo
yarn install
```

```bash
npm install
```

The demo installs the published `@picoflow/core` package. If you are also
developing the framework in the sibling `picoflow` checkout, build its local
package first:

```bash
npm --prefix ../picoflow run build:locallib
```

The demo also exposes that as `npm run build:picoflow`. To consume that local
build, change the dependency to `file:../picoflow/npmlib/staging/lib` and
reinstall. A standalone demo clone can keep the published dependency.

## Environment variables

Copy `.env-example` to `.env` and fill in only what your target flow needs.

### Always required

| Variable | Notes |
| --- | --- |
| `PICOFLOW_KEY` | Runtime license token. Every flow fails on its first model response without it. |

### Per flow

| Flow | Default model | Key required |
| --- | --- | --- |
| `BasicFlow` | `openai:gpt-4o-mini`, with `gpt-5` and `gpt-5.1` step overrides | `OPENAI_API_KEY` |
| `HotelFlow` | `openai:gpt-4o`, with `gpt-5.1` step overrides | `OPENAI_API_KEY` |
| `InvoiceFlow` | `google:gemini-2.5-flash`, with a `gemini-3.1-pro-preview` step override | `GEMINI_API_KEY` |
| `SupportFlow` | `openai:gpt-4o` | `OPENAI_API_KEY` |
| `HomeInsuranceQuoteFlow` | `openai:gpt-4o` | `OPENAI_API_KEY` |
| `EmployeeBenefitsFlow` | `openai:gpt-4o`, with `gpt-5.1` overrides for plan selection, elections, and review | `OPENAI_API_KEY` |

`app.module.ts` also constructs Anthropic and NVIDIA adapters. Registering an adapter with
an undefined API key is harmless; the credential is only used when a flow or step actually
selects that provider. The other keys in `.env-example` — `MOONSHOT_API_KEY`, `ZAI_API_KEY`,
`OPENROUTER_API_KEY`, `OLLAMA_BASE_URL` — correspond to
built-in adapters that are commented out in `app.module.ts`.

### Session storage

```bash
SESSION_STORE=SQLITE
SQLITE_PATH=ignore/session/session.sqlite
```

`SESSION_STORE` selects the backend and accepts `MEMORY` (the default), `SQLITE`,
`MONGO`/`MONGODB`, or `COSMO`/`COSMOS`/`COSMOSDB`. Session-idle policy belongs to the Flow's
`onRestoreSessionDoc()` hook; it is not an environment setting.

The current `.env-example` sets `SESSION_STORE=SQLITE`. Its legacy
`DOCUMENT_DB` entry has no runtime effect.

SQLite is the recommended local durable store. Relative `SQLITE_PATH` values resolve from
the project root. For MongoDB or Cosmos DB, fill in the corresponding block:

```bash
SESSION_STORE=MONGO
MONGODB_NAME=picoflow
MONGODB_COLLECTION=sessions
MONGODB_URL=mongodb://localhost:27017/?directConnection=true
```

```bash
SESSION_STORE=COSMO
COSMODB_URL=https://your-account.documents.azure.com:443/
COSMODB_KEY=your-account-key
COSMODB_ID=picoflow
COSMODB_SESSION_ID=sessions
COSMOS_CREATE_IF_NOT_EXISTS=false
```

`app.module.ts` reads database credentials and constructs SDK clients in inline
`sessionClients` factories. Only the selected backend is initialized. The
Cosmos example above uses a key and resources provisioned separately; the demo
also supports service-principal and default Azure credentials. See
[application-owned database initialization](/docs/guides/persistence/#application-owned-database-initialization)
for authentication choices, optional `MONGODB_TLS_CA_FILE`, and provisioning.

### Batch mode only

`SELF_URL` is not in `.env-example`, but `concurrentSteps(...)` needs it: the coordinator
fans work out by making HTTP calls back into this same application.

```bash
SELF_URL=http://localhost:8000/ai/run
```

## Build and start

| Script | What it does |
| --- | --- |
| `npm run build` | Delegates to `build:app`, which runs `nest build`, then copies `json`, `md`, `png` and `pdf` assets into `dist/`. |
| `npm run start:dev` | `nest start --watch`. The normal development loop. |
| `npm run start` | Builds, then runs `start:prod`. |
| `npm run start:prod` | `node --enable-source-maps dist/main.js`. |
| `npm run typecheck` | `tsc --project tsconfig.contract.json`. |

```bash
npm run start:dev
```

The service listens on port 8000 and binds `0.0.0.0`.

<div class="callout callout--note"><span class="callout__title">Note</span><p>The <code>postbuild</code> asset copy matters. <code>HotelFlow</code>, <code>InvoiceFlow</code>, <code>HomeInsuranceQuoteFlow</code>, and <code>EmployeeBenefitsFlow</code> load prompt files, configuration JSON, catalogs, or sample documents from disk at runtime, so running <code>dist/main.js</code> after a bare <code>nest build</code> will fail to find them.</p></div>

## Which flows are registered

`src/app.module.ts` is the application bootstrap contract. It builds the engine in a NestJS
factory. This excerpt shortens the Cosmos factory to key authentication:

```ts
FlowEngine.create({
  configManager: config,
  sessionClients: {
    mongodb: () => new MongoClient(config.getOrThrow<string>("MONGODB_URL")),
    cosmos: () => new CosmosClient({
      endpoint: config.getOrThrow<string>("COSMODB_URL"),
      key: config.getOrThrow<string>("COSMODB_KEY"),
    }),
  },
  flows: [
    BasicFlow,
    HotelFlow,
    InvoiceFlow,
    SupportFlow,
    DecisionHotelFlow,
    HomeInsuranceQuoteFlow,
    EmployeeBenefitsFlow,
  ],
  decisionProviders: DecisionProvider.create({
    typesafe: { apiKey: config.get<string>("TYPESAFE_API_KEY") },
  }),
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      anthropic: { apiKey: config.get<string>("ANTHROPIC_API_KEY") },
    }),
    ModelProvider.createCustomAdapter({
      provider: "nvidia",
      runtimeProvider: "openai",
      config: {
        apiKey: config.get<string>("NVIDIA_API_KEY"),
        configuration: { baseURL: "https://integrate.api.nvidia.com/v1" },
      },
    }),
  ],
});
```

`MongoClient` and `CosmosClient` are SDK imports owned by the application.
The engine uses the same `ConfigService` reader for store identifiers and
runtime settings. `AppModule.onApplicationShutdown()` calls `engine.close()`;
`main.ts` enables Nest shutdown hooks to release owned clients on process signals.

The NVIDIA entry is worth reading twice: it uses an OpenAI-compatible endpoint but stays an
application-owned integration rather than a PicoFlow built-in, which is exactly what
`createCustomAdapter(...)` is for. Its selections are deliberately dynamic:

```ts
new RecommendationStep(this).useModel({
  provider: "nvidia",
  name: "meta/llama-3.1-70b-instruct",
  params: { temperature: 0.2, maxTokens: 800 },
});
```

Unlike `openai:gpt-5`, PicoFlow cannot compile-check NVIDIA's parameter contract because that
contract belongs to NVIDIA, not the PicoFlow catalog. Register `validate(selection)` and/or
`capabilities(selection)` on the custom adapter when your application needs to enforce a
runtime policy. See [Providers](/docs/reference/providers/) for the full custom-adapter contract.

Confirm the registered names once the service is up:

```bash
curl http://localhost:8000/ai/flows
```

```json
["BasicFlow","HotelFlow","InvoiceFlow","SupportFlow","HomeInsuranceQuoteFlow","EmployeeBenefitsFlow"]
```

### What each flow demonstrates

| Flow | Shape | Read it for |
| --- | --- | --- |
| `BasicFlow` | Multi-stage conversation | The broadest lifecycle coverage: context-dependent `initialStep()`, per-step model overrides, shared and separate memory namespaces, logic steps, nested and concurrent execution, batch coordination. |
| `HotelFlow` | Multi-turn search, compare, book | `onEnter()` with `eraseMemory()`, `onCrossing()`, memory compaction configured in the flow constructor, large prompt files, `direct(...)` responses. |
| `InvoiceFlow` | One-shot document extraction | A step with no tools, multimodal file input, structured output, `HttpContentType.Json`, and document fan-out via `spawnSteps()`. |
| `SupportFlow` | Durable support case | Deterministic policy, approval boundaries, isolated specialist memory, and session restoration. |
| `HomeInsuranceQuoteFlow` | Twenty-turn quote journey | Shared intake memory, isolated coverage/contact stages, deterministic rating, exact quote tables, correction, re-rating, and consent. |
| `EmployeeBenefitsFlow` | Twenty-two-turn enrollment journey | Directory-backed eligibility, household validation, exact plan and network tools, HSA and dependent-care limits, ancillary pricing, beneficiary validation, explicit review, and deterministic submission. |

## Run the flow tests

```bash
npm run test:basic-flow
npm run test:hotel-flow
npm run test:invoice-flow
npm run test:support-flow
npm run test:home-insurance-flow
npm run test:employee-benefits-flow
```

`npm test` runs the standard flow suite in sequence via `test:flows`.

Each spec boots the real NestJS application with a Fastify adapter and drives a scripted
multi-turn scenario through the HTTP contract. Every flow test loads PicoDemo's `.env`.
By default it replaces session persistence with a flow-specific SQLite database under
`test/.tmp`, keeping normal test runs isolated.

### Test environment

The default local store is isolated per flow:

- `SESSION_STORE` is forced to `SQLITE`;
- `SQLITE_PATH` points at `test/.tmp/<flow>-session.sqlite`.

Set `USE_ENV=1` to retain the session-store settings already loaded from `.env` instead. This
is useful when intentionally exercising MongoDB, Cosmos DB, or a configured SQLite path:

```bash
USE_ENV=1 npm run test:basic-flow
```

`USE_ENV=1` is a test-harness switch. It does not supply provider credentials or by itself
turn a skipped live scenario into a runnable one.

### Skipping and required keys

A live scenario is skipped, not failed, when its provider keys are absent:

| Spec | Required to run live |
| --- | --- |
| `test:basic-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` |
| `test:hotel-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` |
| `test:invoice-flow` | `GEMINI_API_KEY`, `PICOFLOW_KEY` |
| `test:home-insurance-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` |
| `test:employee-benefits-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` |

Semantic judges use the API-key `openai` provider. Their model is configured by the scenario
or the flow-specific `*_JUDGE_MODEL` environment variable; the checked-in scenarios use
`gpt-4o`. Flow models remain independently selected and still need their listed credentials.

`BasicFlow` additionally supports a deterministic mode that replaces the provider with a
scripted model, so it exercises the same transitions and SQLite assertions without spending
tokens:

```bash
BASIC_FLOW_USE_SCRIPTED_MODEL=1 npm run test:basic-flow
```

In that mode only `PICOFLOW_KEY` is required.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>The demo <code>README.md</code> refers to a <code>test:basic-flow:contract</code> script for the deterministic run. No such script exists in <code>package.json</code>. Set <code>BASIC_FLOW_USE_SCRIPTED_MODEL=1</code> on the normal script instead.</p></div>

`HotelFlow`'s scenario is graded by its API-key semantic judge. Pair live scenarios with
deterministic contract assertions so a fluent answer cannot disguise missing state or a wrong
transition.

`HomeInsuranceQuoteFlow` applies the same principle over twenty live turns. Its spec also
tests rating and referral decisions without a model, and the final session assertions prove
that the roof correction, deductible re-rate, selected option, and contact consent persisted.

`EmployeeBenefitsFlow` extends that pattern to twenty-two live turns. Its
deterministic tests own eligibility, plan prices, provider-network status, HSA and
dependent-care limits, ancillary pricing, pending evidence of insurability, and the final
enrollment record. The live scenario adds semantic grading and persisted-state assertions.

## Next

With the service running, work through the real HTTP contract in
[Your first request](/docs/get-started/first-request/), or start reading the flows themselves in
the [tutorials](/docs/tutorials/).
