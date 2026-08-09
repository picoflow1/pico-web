---
title: Run the demo app
eyebrow: Get started
lede: Install and start the NestJS demo application, set only the environment variables you actually need, and run the end-to-end flow scenarios.
source: picoflow-demo/README.md
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

The demo depends on `@picoflow/core`. In this repository the dependency is wired to a local
staging build of the library rather than to the published package:

```json
"@picoflow/core": "file:../picoflow/npmlib/staging/lib"
```

If you are working from the monorepo layout, build the library before installing the demo:

```bash
npm --prefix ../picoflow run build:locallib
```

The demo also exposes that as a script, `npm run build:picoflow`. If you are working from a
standalone clone, replace the `file:` dependency with the published version.

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

`app.module.ts` also constructs Anthropic and NVIDIA adapters. Registering an adapter with
an undefined API key is harmless; the credential is only used when a flow or step actually
selects that provider. The other keys in `.env-example` — `MOONSHOT_API_KEY`, `ZAI_API_KEY`,
`OPENROUTER_API_KEY`, `OLLAMA_BASE_URL` — correspond to
built-in adapters that are commented out in `app.module.ts`.

### Session storage

```bash
SESSION_STORE=SQLITE
SQLITE_PATH=ignore/session/session.sqlite
SESSION_EXPIRATION=50000
```

`SESSION_STORE` selects the backend and accepts `MEMORY` (the default), `SQLITE`, `MONGO`,
`COSMO` or `COSMOS`. `SESSION_EXPIRATION` is in seconds and defaults to `600`.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>The shipped <code>.env-example</code> sets <code>DOCUMENT_DB=COSMO</code>. The library reads <code>SESSION_STORE</code>, not <code>DOCUMENT_DB</code>. If you only set <code>DOCUMENT_DB</code> you will silently get the in-process <code>MEMORY</code> store, and every session will disappear on restart. Set <code>SESSION_STORE</code>.</p></div>

SQLite is the recommended local durable store. Relative `SQLITE_PATH` values resolve from
the project root. For MongoDB or Cosmos DB, fill in the corresponding block:

```bash
MONGODB_NAME=picoflow
MONGODB_COLLECTION=sessions
MONGODB_URL=mongodb://localhost:27017/?directConnection=true
```

```bash
COSMODB_URL=http://localhost:8081/
COSMODB_KEY=...
COSMODB_ID=picoflow
COSMODB_SESSION_ID=sessions
```

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

<div class="callout callout--note"><span class="callout__title">Note</span><p>The <code>postbuild</code> asset copy matters. <code>HotelFlow</code> and <code>InvoiceFlow</code> load prompt files, catalog JSON and sample documents from disk at runtime, so running <code>dist/main.js</code> after a bare <code>nest build</code> will fail to find them.</p></div>

## Which flows are registered

`src/app.module.ts` is the application bootstrap contract. It builds the engine in a NestJS
factory:

```ts
FlowEngine.create({
  flows: [BasicFlow, HotelFlow, InvoiceFlow],
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
["BasicFlow","HotelFlow","InvoiceFlow"]
```

### What each flow demonstrates

| Flow | Shape | Read it for |
| --- | --- | --- |
| `BasicFlow` | Multi-stage conversation | The broadest lifecycle coverage: context-dependent `initialStep()`, per-step model overrides, shared and separate memory namespaces, logic steps, nested and concurrent execution, batch coordination. |
| `HotelFlow` | Multi-turn search, compare, book | `onEnter()` with `eraseMemory()`, `onCrossing()`, memory compaction configured in the flow constructor, large prompt files, `direct(...)` responses. |
| `InvoiceFlow` | One-shot document extraction | A step with no tools, multimodal file input, structured output, `HttpContentType.Json`, and document fan-out via `spawnSteps()`. |

## Run the flow tests

```bash
npm run test:basic-flow
npm run test:hotel-flow
npm run test:invoice-flow
```

`npm test` runs all three in sequence via `test:flows`.

Each spec boots the real NestJS application with a Fastify adapter and drives a scripted
multi-turn scenario through the HTTP contract, then asserts on the persisted SQLite session
document.

### Test environment

The specs override session storage so they never touch your configured store:

- `SESSION_STORE` is forced to `SQLITE`;
- `SQLITE_PATH` points at `test/.tmp/<flow>-session.sqlite`.

Pass `BASIC_FLOW_TEST_USE_ENV=1` (exposed as `npm run test2:basic-flow`) or
`INVOICE_FLOW_TEST_USE_ENV=1` to use your `.env` settings instead.

### Skipping and required keys

A live scenario is skipped, not failed, when its provider keys are absent:

| Spec | Required to run live | Force skip with |
| --- | --- | --- |
| `test:basic-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` | — |
| `test:hotel-flow` | `OPENAI_API_KEY`, `PICOFLOW_KEY` | `RUN_LIVE_HOTEL_FLOW_TEST=0` |
| `test:invoice-flow` | `GEMINI_API_KEY`, `PICOFLOW_KEY` | `RUN_LIVE_INVOICE_FLOW_TEST=0` |

`BasicFlow` additionally supports a deterministic mode that replaces the provider with a
scripted model, so it exercises the same transitions and SQLite assertions without spending
tokens:

```bash
BASIC_FLOW_USE_SCRIPTED_MODEL=1 npm run test:basic-flow
```

In that mode only `PICOFLOW_KEY` is required.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>The demo <code>README.md</code> refers to a <code>test:basic-flow:contract</code> script for the deterministic run. No such script exists in <code>package.json</code>. Set <code>BASIC_FLOW_USE_SCRIPTED_MODEL=1</code> on the normal script instead.</p></div>

`HotelFlow`'s scenario is graded by an LLM judge (`gpt-4o` by default, overridable with
`HOTEL_FLOW_JUDGE_MODEL`). Pair live scenarios with deterministic contract assertions so a
fluent answer cannot disguise missing state or a wrong transition.

## Next

With the service running, work through the real HTTP contract in
[Your first request](/docs/get-started/first-request/), or start reading the flows themselves in
the [tutorials](/docs/tutorials/).
