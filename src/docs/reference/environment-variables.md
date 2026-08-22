---
title: Environment variables
eyebrow: Reference
lede: "Every variable PicoFlow and the demo application actually read, what each one does, the units that are easy to get wrong, and where the sample env file disagrees with the code."
source: pf/src/picoflow/configs/core-config.ts
---

Configuration is read once, when `FlowEngine` constructs a `ConfigManager` and calls
`CoreConfig.setup(...)`. Values resolve in this precedence:

```text
explicit `values` option  >  process.env  >  the dotenv file (.env by default)
```

A missing dotenv file is not an error. Flow model policy and session-idle policy
are deliberately not read from the environment.

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

Accepted values are `MEMORY`, `SQLITE`, `MONGO`, and `COSMO` or `COSMOS`. Anything else throws
`No valid session store '<value>'. Use MEMORY, MONGO, COSMO, or SQLITE.`

<div class="callout callout--danger"><span class="callout__title">.env-example names the wrong variable</span><p><code>pico-demo/.env-example</code> sets <code>DOCUMENT_DB=COSMO</code>. No code in <code>pf/src</code> or <code>pico-demo/src</code> reads <code>DOCUMENT_DB</code>. The variable <code>CoreConfig</code> actually reads is <code>SESSION_STORE</code>, and it does not appear in the sample file at all — so an application copied from <code>.env-example</code> silently runs on the in-memory store.</p></div>

### Store-specific settings

| Variable | Required for | Default | Purpose |
| --- | --- | --- | --- |
| `SQLITE_PATH` | `SQLITE` | `ignore/session/session.sqlite` | Database file. Relative paths resolve from the working directory; the parent directory is created if missing |
| `MONGODB_URL` | `MONGO` | — | Connection string |
| `MONGODB_NAME` | `MONGO` | — | Database name |
| `MONGODB_COLLECTION` | `MONGO` | — | Collection name |
| `COSMODB_URL` | `COSMO` | — | Account endpoint |
| `COSMODB_KEY` | `COSMO` | — | Account key |
| `COSMODB_ID` | `COSMO` | — | Database ID |
| `COSMODB_SESSION_ID` | `COSMO` | — | Container ID |

The Mongo and Cosmos values are required at the moment the store is constructed or first used,
and a missing one throws `Configuration value '<KEY>' is required.` The Memory store needs no
configuration.

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
it. Like `SESSION_STORE`, it is read by `CoreConfig` but absent from `.env-example`.

## Test determinism

| Variable | Read by | Purpose |
| --- | --- | --- |
| `HOTEL_FLOW_CURRENT_DATE` | demo `ExploreStep` | Pins "today" so date-dependent hotel scenarios replay deterministically |

`ExploreStep` uses `process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format()`. Any flow
whose prompts embed the current date needs an equivalent override before its scenarios can be
asserted. It is not part of `.env-example`.

## Sample file versus the code

| Variable | In `.env-example` | Read by code | Note |
| --- | --- | --- | --- |
| `SESSION_STORE` | no | yes | The real store selector |
| `SELF_URL` | no | yes | Required for batch mode |
| `HOTEL_FLOW_CURRENT_DATE` | no | yes | Demo test determinism |
| `DOCUMENT_DB` | yes | **no** | Superseded by `SESSION_STORE`; has no effect |
| `MOONSHOT_API_KEY` | yes | no | Only referenced by commented-out demo wiring |
| `ZAI_API_KEY` | yes | no | Only referenced by commented-out demo wiring |
| `DEEPSEEK_API_KEY` | yes | no | nly referenced by commented-out demo wiring |
| `OLLAMA_BASE_URL` | yes | no | Only referenced by commented-out demo wiring |
| `OPENROUTER_API_KEY` | yes | partly | Loaded into `CoreConfig` but unused; the demo's OpenRouter adapter is commented out |

Everything else in `.env-example` — the three live provider keys, `NVIDIA_API_KEY`,
`SQLITE_PATH`, the four `COSMODB_*` values, the three `MONGODB_*` values, and
`PICOFLOW_KEY` — matches what the code reads.

## Not configurable by environment

Two things are explicit on purpose and are never read from the environment:

- **Runner retry attempts.** `retryAttempts` is a positive integer on a
  `configModel()` or `useModel(...)` selection. A Step inherits its Flow value
  unless it sets its own; the selection is persisted with the session.
- **Model names and hyperparameters.** These belong in `configModel()` and
  `useModel(...)`, so the model plan persisted in the session document reflects
  what the Flow chose. See [Providers](/docs/reference/providers/).
