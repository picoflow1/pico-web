---
title: Environment variables
eyebrow: Reference
lede: "Runtime configuration and application-owned database credentials, including store selection, Cosmos authentication, and flow-test persistence."
source: pf/src/picoflow/configs/core-config.ts, pf/src/picoflow/session/flow-session.ts, pico-demo/src/app.module.ts
---

Pass a configuration reader to `FlowEngine.create({ configManager })`.
The demo supplies Nest's `ConfigService` and reads SDK credentials in its inline
`sessionClients` factories. Standalone applications can use `ConfigManager`;
its values resolve in this precedence:

```text
explicit `values` option  >  process.env  >  the dotenv file (.env by default)
```

A missing dotenv file is not an error. Flow model policy and session-idle policy
are deliberately not read from the environment.
The selected store and its SDK client are initialized when the engine is
created; changing settings later does not switch an existing engine's backend.

## License

| Variable | Default | Read by | Purpose |
| --- | --- | --- | --- |
| `PICOFLOW_KEY` | — | `CoreConfig` | The signed license token. Verified on every model run |

`verifyLicense()` runs at the start of each model invocation and again when the response is
processed. A missing token throws `License token missing`; a malformed or unsigned one throws
an invalid-license error. The result is cached after the first successful verification.

## Provider credentials

| Variable | Read by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | `CoreConfig`, demo `AppModule` | OpenAI adapter credentials, and OpenAI file uploads |
| `GEMINI_API_KEY` | `CoreConfig`, demo `AppModule` | Google adapter credentials, and Gemini file uploads |
| `ANTHROPIC_API_KEY` | `CoreConfig`, demo `AppModule` | Anthropic adapter credentials, and Claude file uploads |
| `OPENROUTER_API_KEY` | `CoreConfig` | Loaded into `CoreConfig.OpenRouterApiKey`; nothing in `pf/src` consumes it today |
| `NVIDIA_API_KEY` | demo `AppModule` | The demo's application-owned NVIDIA adapter |

<div class="callout callout--note"><span class="callout__title">Adapters do not read the environment</span><p>Provider adapters take credentials as explicit constructor options. The application passes them in — for example <code>openai: { apiKey: config.get("OPENAI_API_KEY") }</code>. The three keys <code>CoreConfig</code> reads for itself are used by <code>LLMFileManager</code> for provider-side file uploads, which has no adapter of its own.</p></div>

`MOONSHOT_API_KEY`, `ZAI_API_KEY`, and `OLLAMA_BASE_URL` appear in `.env-example` and in
commented-out lines of the demo's provider wiring. Nothing in `pf/src` or the active demo code
reads them. They become live only when you uncomment or add the corresponding
`createBuiltinAdapters` option.

## Session store selection

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_STORE` | `MEMORY` | Selects the store. Uppercased before comparison |

Accepted values are `MEMORY`, `SQLITE`, `MONGO`/`MONGODB`, and
`COSMO`/`COSMOS`/`COSMOSDB`. Anything else throws
`No valid session store '<value>'. Use MEMORY, MONGO, COSMO, or SQLITE.`

The current `pico-demo/.env-example` sets `SESSION_STORE=SQLITE`. Its legacy
`DOCUMENT_DB` entry has no runtime effect; use `SESSION_STORE` to select storage.

### Store-specific settings

| Variable | Required for | Default | Purpose |
| --- | --- | --- | --- |
| `SQLITE_PATH` | `SQLITE` | `ignore/session/session.sqlite` | Database file. Relative paths resolve from the working directory; the parent directory is created if missing |
| `MONGODB_URL` | Demo Mongo factory or built-in Mongo creation | — | Connection string, read explicitly in the demo's `app.module.ts` |
| `MONGODB_TLS_CA_FILE` | Optional demo Mongo SDK option | — | Custom CA certificate file passed as `tlsCAFile` |
| `MONGODB_NAME` | `MONGO`/`MONGODB` | — | Database name, including when a client factory is supplied |
| `MONGODB_COLLECTION` | `MONGO`/`MONGODB` | — | Collection name, including when a client factory is supplied |
| `COSMODB_URL` | Demo Cosmos factory or built-in Cosmos creation | — | Account endpoint; aliases `COSMO_ENDPOINT`, `COSMOS_ENDPOINT` |
| `COSMODB_KEY` | Cosmos key authentication | — | Account key; alias `COSMOS_KEY`. Omit for the demo factory's Azure credential path |
| `AZURE_TENANT_ID` | Demo Cosmos service-principal path | — | Tenant ID |
| `COSMO_DB_CLIENT_ID` | Demo Cosmos service-principal path | — | Application client ID |
| `COSMO_DB_CLIENT_SECRET` | Demo Cosmos service-principal path | — | Client secret |
| `COSMODB_ID` | `COSMO`/`COSMOS`/`COSMOSDB` | — | Database ID; aliases `COSMO_DB_ID`, `COSMOS_DATABASE` |
| `COSMODB_SESSION_ID` | `COSMO`/`COSMOS`/`COSMOSDB` | — | Container ID; aliases `COSMO_DB_SESSION_CONTAINER_ID`, `COSMOS_CONTAINER` |
| `COSMOS_CREATE_IF_NOT_EXISTS` | Cosmos provisioning policy | `true` | Set to `false` for a database/container provisioned separately. The container must use partition key `/id` |

Endpoint, credentials, and TLS options belong to the application factory when
one is supplied. Only the selected backend's factory runs, so Cosmos does not
require MongoDB credentials. The demo's Cosmos factory tries a key, then an
explicit service principal, then `DefaultAzureCredential`; incomplete explicit
client credentials fail at startup. Without a Cosmos factory, PicoFlow's
built-in client creation uses URL/key authentication.

Database/collection or database/container identifiers remain required by the
store. Memory needs no database configuration. See
[application-owned database initialization](/docs/guides/persistence/#application-owned-database-initialization)
for the inline AppModule example and cleanup rules.

## Flow-owned policies

Session stores load raw documents; a Flow decides whether a restored document is
acceptable. Use `onRestoreSessionDoc()` and `sessionIdleMs(doc)` with a code
constant when a Flow has an idle-time rule. The framework does not define a
global expiry environment variable or persist an `expireAfter` field.

## Batch mode

| Variable | Default | Purpose |
| --- | --- | --- |
| `SELF_URL` | — | Base URL used by `SelfClient` for concurrent worker requests |

`Flow.concurrentSteps(...)` posts one request per work item back to this application. Point it
at the run endpoint, for example `http://localhost:8000/ai/run`. Only batch coordinators need
it. It is read by `CoreConfig` but absent from `.env-example`.

## Test determinism

| Variable | Read by | Purpose |
| --- | --- | --- |
| `HOTEL_FLOW_CURRENT_DATE` | demo `ExploreStep` | Pins "today" so date-dependent hotel scenarios replay deterministically |

`ExploreStep` uses `process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format()`. Any flow
whose prompts embed the current date needs an equivalent override before its scenarios can be
asserted. It is not part of `.env-example`.

## Flow-test persistence

| Variable | Read by | Purpose |
| --- | --- | --- |
| `USE_ENV=1` | PicoDemo flow-test harness | Retains the session-store settings loaded from `.env` instead of forcing that test's isolated SQLite store |

Flow tests load `.env` in either mode. Without `USE_ENV=1`, they intentionally use an isolated
SQLite database under `test/.tmp`; with it, they use the configured `SESSION_STORE` and related
settings. This is a test-harness control, not a PicoFlow runtime setting, and it does not
provide model credentials.

## Sample file versus the code

| Variable | In `.env-example` | Read by code | Note |
| --- | --- | --- | --- |
| `SESSION_STORE` | yes | yes | The real store selector; sample defaults to SQLite |
| `SELF_URL` | no | yes | Required for batch mode |
| `HOTEL_FLOW_CURRENT_DATE` | no | yes | Demo test determinism |
| `DOCUMENT_DB` | yes | **no** | Superseded by `SESSION_STORE`; has no effect |
| `MOONSHOT_API_KEY` | yes | no | Only referenced by commented-out demo wiring |
| `ZAI_API_KEY` | yes | no | Only referenced by commented-out demo wiring |
| `DEEPSEEK_API_KEY` | yes | partly | Loaded into `CoreConfig`; the demo adapter is commented out |
| `OLLAMA_BASE_URL` | yes | no | Only referenced by commented-out demo wiring |
| `OPENROUTER_API_KEY` | yes | partly | Loaded into `CoreConfig` but unused; the demo's OpenRouter adapter is commented out |

The sample also includes the database settings listed above, optional TLS and
Cosmos service-principal fields, provider keys, and `PICOFLOW_KEY`.

## Not configurable by environment

Three things are explicit on purpose and are never read from the environment:

- **Runner retry attempts.** `retryAttempts` is a positive integer on a
  `configModel()` or `useModel(...)` selection. A Step inherits its Flow value
  unless it sets its own; the selection is persisted with the session.
- **Model names and hyperparameters.** These belong in `configModel()` and
  `useModel(...)`, so the model plan persisted in the session document reflects
  what the Flow chose. See [Providers](/docs/reference/providers/).
- **Model-call deadlines.** `timeoutMs` belongs in Flow or Step
  `configLlmCallPolicy()`. It is code-owned, provider-neutral, and is not persisted
  in the session document.
