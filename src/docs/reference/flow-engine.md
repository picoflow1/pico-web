---
title: FlowEngine
eyebrow: Reference
lede: "Creation and options, flow and provider registration, the run input and response contract, per-session locking, and permanent session deletion."
source: pf/src/picoflow/services/flow-engine.ts
---

`FlowEngine` is the single runtime object an application holds. It owns the flow registry, the
model registry, and the session façade. It is framework-neutral — the demo wires one instance
into NestJS, but nothing in the class depends on it.

## FlowEngine.create()

```ts
public static async create(
  options: FlowEngineCreateOptions = {},
): Promise<FlowEngine>;
```

```ts
export type FlowEngineOptions = Readonly<{
  configManager?: ConfigReader;
  flows?: FlowRegistration;
  models?: readonly Model[];
  providers?: readonly ModelProviderAdapter[];
  decisionProviders?: readonly DecisionProviderAdapter[];
  /** Override the configured session backend, primarily for tests and DI. */
  sessionStore?: SessionStore;
}>;

export type FlowEngineCreateOptions = FlowEngineOptions & Readonly<{
  sessionClients?: SessionDatabaseClientFactories;
}>;
```

`create()` asynchronously prepares the session store selected by `SESSION_STORE`,
then constructs and registers the engine. `configManager` accepts PicoFlow's
`ConfigManager` or an application reader such as Nest's `ConfigService`.
`sessionStore` takes precedence when supplied, so database factories are not
called. Use `create()` when passing SDK factories; the synchronous constructor
accepts `FlowEngineOptions` without `sessionClients`.

```ts
import { ConfigManager, FlowEngine, ModelProvider } from "@picoflow/core";
import { MongoClient } from "mongodb";
import { CosmosClient } from "@azure/cosmos";

const config = new ConfigManager();
const engine = await FlowEngine.create({
  configManager: config,
  flows: [BasicFlow, HotelFlow, InvoiceFlow],
  sessionClients: {
    mongodb: () => new MongoClient(config.require("MONGODB_URL")),
    cosmos: () => new CosmosClient({
      endpoint: config.require("COSMODB_URL"),
      key: config.require("COSMODB_KEY"),
    }),
  },
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get("OPENAI_API_KEY") },
      google: { apiKey: config.get("GEMINI_API_KEY") },
    }),
  ],
});
```

This example imports `MongoClient` from `mongodb` and `CosmosClient` from
`@azure/cosmos` in the application. Only the selected store's zero-argument
factory runs. Factories may return promises. See
[application-owned database initialization](/docs/guides/persistence/#application-owned-database-initialization)
for the full Nest example and Cosmos credential choices, and
[SessionDatabaseClientFactories](/docs/reference/session-stores/#application-created-clients)
for ownership rules. Call `await engine.close()` during application shutdown.

Passing `models` or `providers` here registers them with `replace = true`, so a later
`registerProvider(adapter)` without `replace` will not override them.

## registerFlow() and registerFlows()

```ts
public registerFlows(flowSpecs: FlowRegistration): this;
public registerFlow(FlowClass: FlowConstructor): this;
```

```ts
export type FlowConstructor = {
  new (): Flow;
  readonly id: string;
};
export type FlowConstructorMap = Readonly<Record<string, FlowConstructor>>;
export type FlowRegistration = readonly FlowConstructor[] | FlowConstructorMap;
```

The array form derives each name from `FlowClass.id`, which defaults to the class name. The
map form takes an explicit key. `registerFlows()` validates the entire batch before writing
any of it, so a bad set leaves the registry untouched. `registerFlow()` is a single-entry
wrapper around the same validation.

| Condition | Error |
| --- | --- |
| Missing name, non-function, or blank `FlowClass.id` | `A registered flow must have a name and constructor.` |
| The map key differs from `FlowClass.id` | `Flow registration '<name>' must match Flow ID '<id>'.` |
| The name is already registered, or repeated in this batch | `Flow '<name>' is already registered.` |

<div class="callout callout--warning"><span class="callout__title">The map key must equal FlowClass.id</span><p>The developer guide suggests <code>registerFlows({ StableName: FlowClass })</code> decouples the public flow name from a TypeScript class rename. On its own it does not — the key is compared against <code>FlowClass.id</code> and a mismatch throws. To keep a stable public name across a class rename, override the static accessor on the flow itself:</p></div>

```ts
export class CustomerFlow extends Flow {
  static get id() {
    return "CustomerFlow";
  }
}
```

The registered name is part of the persisted schema: `flow.name` in every session document is
compared against it on restore, and a mismatch fails before `onRestoreSessionDoc()` can run.

### Lookup

```ts
public getFlow(flowName: string): FlowConstructor | undefined;
public getFlowNames(): string[];
```

`getFlowNames()` is what `GET /ai/flows` returns.

## run()

```ts
public async run(input: FlowRunInput): Promise<RunResponseType>;

export type FlowRunInput = Readonly<{
  flowName: string;
  userMessage: string;
  sessionId?: string;
  config?: object;
}>;
```

A supplied `config` is wrapped as `{ config }` and added to flow context before `init()`. When
`config` is `undefined`, no context is added at all — which matters for a restored session,
whose stored context must not be disturbed.

`run()` delegates to `runFlow(flowName, userMessage, sessionId?, context?)`, which acquires the
per-session lock and then, inside it:

```text
FlowCreator.create(...)   -> new instance, context, init(), collectSteps(), bootstrap()
isBatch()                 -> an extra saveSession() checkpoint
flow.run(userMessage)
saveSession()
```

Both methods resolve rather than reject. Every error is converted into a failure envelope:

```ts
{ success: false, message, completed: true, session, contentType: HttpContentType.Plain }
```

| Error class | Session document |
| --- | --- |
| `SessionConflictError`, `SessionFlowMismatchError`, `SessionFlowInvariantError` | Left untouched — the winning document must not be overwritten |
| Anything else | `runStatus` set to `aborted`, the message appended to `error[]`, and the document saved |

If persisting the aborted document also fails, that secondary failure is appended to the
returned message rather than thrown.

## Session locking

```ts
public getFlowSession(): FlowSession;

// on FlowSession:
async withSessionLock<T>(
  sessionId: string | undefined,
  work: () => Promise<T>,
): Promise<T>;
```

`FlowEngine` has no `withSessionLock` method of its own; it reaches the façade through
`getFlowSession()`. `runFlow()` and `deleteSession()` both wrap their whole body in it, so a
local delete cannot race a local run.

`SessionMutex` maintains a FIFO promise chain keyed by session ID. Two requests for the same ID
in one engine instance run one after another; different IDs stay concurrent. A call with an
undefined session ID skips the lock entirely, because it is creating a new random ID.

<div class="callout callout--note"><span class="callout__title">This lock is process-local</span><p>It coordinates one <code>FlowEngine</code> instance only. Across processes, correctness comes from revision-based compare-and-swap in the session store. See <a href="/docs/reference/session-stores/">Session stores</a> and <a href="/docs/guides/concurrency/">Concurrency and session conflicts</a>.</p></div>

## deleteSession()

```ts
public async deleteSession(
  sessionId: string,
): Promise<{ success: boolean; session: string; message?: string }>;
```

Permanently removes one persisted session document, under the same session lock and using the
document's current `revision` as the compare-and-swap token. A missing document is a
successful no-op. Failures resolve as `{ success: false, message, session }` rather than
throwing. An empty `sessionId` does nothing and reports success.

Deletion is not completion. `TerminateSessionStep` marks a workflow finished while keeping its
document for diagnostics; `deleteSession()` destroys the record.

### endChat() — deprecated

```ts
/** @deprecated Use deleteSession(); ending a flow does not imply deletion. */
public async endChat(sessionId: string);
```

A straight delegate to `deleteSession()`, kept only for compatibility. The demo's
`POST /ai/end` route already calls `deleteSession()` directly.

## Models and providers

```ts
public registerProviders(providers: readonly ModelProviderAdapter[], replace?: boolean): this;
public registerProvider(provider: ModelProviderAdapter, replace?: boolean): this;
public registerModels(models: readonly Model[], replace?: boolean): this;
public registerModel<Name extends string>(model: Model<Name>, replace?: boolean): this;
public resolveModel(selection: ResolvedModelSelection): RuntimeModel;
public validateModel(selection: ResolvedModelSelection): void;
```

`validateModel()` runs the selection through `PicoModelCatalog.fromSelection()` and then the
registry. `Flow.bootstrap()` calls it for the flow model and for every non-logic step, so an
unregistered provider or an unsupported parameter fails at session start rather than mid-turn.
See [Providers](/docs/reference/providers/).

## close()

```ts
public async close(): Promise<void>;
```

Closes the session store. Call it during application shutdown, and in tests that open a SQLite,
MongoDB, or Cosmos DB store.
