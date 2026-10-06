---
title: Persistence and session stores
eyebrow: Guides
lede: Initialize database clients in your application, choose a session store, and manage its lifecycle. Memory is the default and it does not survive a restart.
source: pico-demo/src/app.module.ts, pf/src/picoflow/session/flow-session.ts
---

Every PicoFlow conversation is one JSON document. Choosing where that document lives is a
deployment decision you should make before the first real user, because the default is
process-local memory and loses everything on restart.

<div class="callout callout--note"><span class="callout__title">Persistence is also your operational baseline</span><p>A durable store retains the active cursor, state, memories, tokens, status, and structured diagnostics together. The store does not create dashboards or alerts for you, but its common document shape makes internal inspection and document-database aggregation straightforward. See <a href="/docs/guides/session-operations/">Operate and debug session documents</a> for the safe incident workflow.</p></div>

## Choosing a store

| Store | `SESSION_STORE` | Durable | Safe across processes | Use for |
| --- | --- | --- | --- | --- |
| Memory | `MEMORY` (default) | No | No | Examples, unit tests, throwaway local runs |
| SQLite | `SQLITE` | Yes | Yes, over a shared file | Local development, single-node deployments |
| MongoDB | `MONGO` or `MONGODB` | Yes | Yes | Horizontally scaled deployments |
| Cosmos DB | `COSMO`, `COSMOS`, or `COSMOSDB` | Yes | Yes | Azure deployments |

All four implement the same contract, including revision-based compare-and-swap. The
difference is where the atomic check happens — see
[Concurrency and session conflicts](/docs/guides/concurrency/).

An unrecognised value fails fast at startup:

```text
No valid session store 'POSTGRES'. Use MEMORY, MONGO, COSMO, or SQLITE.
```

## Application-owned database initialization

Initialize MongoDB and Cosmos SDK clients in your application's startup code,
alongside flows and model providers. In
[pico-demo's AppModule](https://github.com/picoflowio/pico-demo/blob/main/src/app.module.ts),
`FlowEngine.create()` receives `configManager: config` and inline `sessionClients`
factories. The application reads the URL, credentials, and SDK options;
PicoFlow supplies the session-store adapter and persistence contract.

Install the SDKs your application imports:

```sh
npm install mongodb @azure/cosmos @azure/identity
```

This Nest example follows the demo's convention, with three tutorial flows and
their model providers. Add the other flow registrations your application uses.

```ts
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import { CosmosClient } from "@azure/cosmos";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { FlowEngine, ModelProvider } from "@picoflow/core";
import { BasicFlow } from "./myflow/basic-flow/basic-flow.js";
import { HotelFlow } from "./myflow/hotel-flow/hotel-flow.js";
import { InvoiceFlow } from "./myflow/invoice-flow/invoice-flow.js";

@Module({
  imports: [ConfigModule.forRoot()],
  providers: [{
    provide: FlowEngine,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => FlowEngine.create({
      configManager: config,
      flows: [BasicFlow, HotelFlow, InvoiceFlow],
      providers: ModelProvider.createBuiltinAdapters({
        openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
        google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      }),
      sessionClients: {
        mongodb: () => {
          const url = config.getOrThrow<string>("MONGODB_URL");
          const tlsCAFile = config.get<string>("MONGODB_TLS_CA_FILE");
          return new MongoClient(url, tlsCAFile ? { tlsCAFile } : {});
        },
        cosmos: () => {
          const endpoint = config.get<string>("COSMODB_URL")
            || config.get<string>("COSMO_ENDPOINT")
            || config.get<string>("COSMOS_ENDPOINT");
          if (!endpoint) throw new Error("Cosmos endpoint is required.");
          const key = config.get<string>("COSMODB_KEY")
            || config.get<string>("COSMOS_KEY");
          if (key) return new CosmosClient({ endpoint, key });

          const tenantId = config.get<string>("AZURE_TENANT_ID");
          const clientId = config.get<string>("COSMO_DB_CLIENT_ID");
          const clientSecret = config.get<string>("COSMO_DB_CLIENT_SECRET");
          if (clientId || clientSecret) {
            if (!tenantId || !clientId || !clientSecret) {
              throw new Error("Cosmos service principal requires tenant, client ID, and secret.");
            }
            return new CosmosClient({
              endpoint,
              aadCredentials: new ClientSecretCredential(tenantId, clientId, clientSecret),
            });
          }
          return new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
        },
      },
    }),
  }],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(FlowEngine) private readonly engine: FlowEngine) {}

  async onApplicationShutdown(): Promise<void> {
    await this.engine.close();
  }
}
```

`SESSION_STORE` selects the backend; only that backend's factory runs. With
`SESSION_STORE=COSMO`, the engine does not construct a MongoDB client or require
`MONGODB_URL`. Factories take no arguments and can return a client or a promise.
Read backend-specific settings inside each factory so unused credentials are
not required during startup.

The Cosmos factory uses a key first. To use an explicit service principal, omit
the key and set `AZURE_TENANT_ID`, `COSMO_DB_CLIENT_ID`, and
`COSMO_DB_CLIENT_SECRET`. With neither a key nor explicit client credentials,
this application uses `DefaultAzureCredential`. Choose other SDK authentication
and connection options here when your deployment needs them.

`MONGODB_TLS_CA_FILE` is optional: it supplies the MongoDB SDK's `tlsCAFile`
option when the connection needs a custom CA certificate file. Keep TLS and
DocumentDB-specific options in the application factory.

PicoFlow connects the MongoDB client before returning the engine. For Cosmos,
it initializes the configured database/container and checks that the partition
key is `/id`. Factories are optional; without one for the selected backend,
the framework retains its built-in configuration-based client creation. That
Cosmos fallback uses key authentication; the factory above owns the additional
Azure credential choices.

## Configuration

```bash
SESSION_STORE=SQLITE
SQLITE_PATH=ignore/session/session.sqlite   # default when unset

# SESSION_STORE=MONGO
MONGODB_URL=mongodb://localhost:27017/?directConnection=true   # required
MONGODB_NAME=picoflow
MONGODB_COLLECTION=sessions

# SESSION_STORE=COSMO
COSMODB_URL=https://your-account.documents.azure.com:443/
COSMODB_KEY=your-account-key
COSMODB_ID=picoflow
COSMODB_SESSION_ID=sessions
COSMOS_CREATE_IF_NOT_EXISTS=false  # for resources provisioned separately
```

`MONGODB_NAME` and `MONGODB_COLLECTION` are required even when your factory
supplies a MongoDB client. Cosmos requires a database ID and container ID; their
aliases are listed in [Environment variables](/docs/reference/environment-variables/#store-specific-settings).
`COSMOS_CREATE_IF_NOT_EXISTS` defaults to `true`, which permits PicoFlow to
create the Cosmos database and container if needed. Set it to `false` for
pre-provisioned resources and grant the identity the permissions required for
session operations.

`SESSION_STORE` is the selector; the legacy `DOCUMENT_DB` entry in the demo's
sample file has no runtime effect. The current sample sets `SESSION_STORE=SQLITE`.

Pass the same configuration reader to the engine and your SDK factories. Nest's
`ConfigService` is supported directly. Standalone applications can use
`ConfigManager`, whose precedence is explicit values, then the environment,
then a dotenv file. The selected store and existing SDK clients are established
when `FlowEngine.create()` runs; changing settings later does not switch them.

## Client ownership and shutdown

Clients returned by `sessionClients` are owned by the engine by default.
`await engine.close()` closes MongoDB or disposes Cosmos, and owned resources
are released if engine initialization fails. The demo calls it from
`AppModule.onApplicationShutdown()` and enables Nest shutdown hooks in `main.ts`
with `app.enableShutdownHooks()`.

For an application-managed shared client, set `sessionClients.ownsClients: false`.
The engine then leaves that SDK client open; your application closes it when
all its consumers are done. A standalone service should call `engine.close()`
through its own shutdown lifecycle.

## What the document contains

```text
Session document
├── id                    uuid, returned as CHAT_SESSION_ID
├── revision              integer compare-and-swap token, incremented on every write
├── version               session schema version (K.sessionDocVersion)
├── runStatus             "running" | "completed" | "aborted"
├── createdOn, saveOn     Date
├── tokens                input/output/total plus reasoning, visible, cached breakdowns
├── log, error, warn, debug, verbose    structured SessionLogger entries
└── flow                  exactly one envelope — never an array
    ├── name              the registered flow name, permanently bound to this ID
    ├── model             { provider, name, params, retryAttempts? } with credential keys stripped
    ├── context           the first request's config
    ├── memory            namespace -> { messages, summary?, summarizedThroughId? }
    ├── steps             [{ name, state, model? }]
    ├── currentStep       the one durable cursor, or null
    └── sequence          [{ level, stepName }] execution trace
```

`revision` and `version` are unrelated. `revision` guards writes; `version` describes the
schema and drives [migration](/docs/guides/migration/).

<div class="callout callout--note"><span class="callout__title">Only metadata dates are revived</span><p>Stores hydrate <code>createdOn</code> and <code>saveOn</code> back into <code>Date</code> objects. Anything date-shaped inside step state, memory or context is deliberately left as the string you stored. Do not assume <code>getState("dueDate")</code> returns a <code>Date</code> after a restore.</p></div>

## The store contract

```ts
export interface SessionStore {
  load(sessionId: string): Promise<SessionType | null>;
  create(flow: FlowType): Promise<SessionType>;
  save(sessionDoc: SessionType, expectedRevision: number): Promise<SessionType>;
  delete(sessionId: string, expectedRevision?: number): Promise<void>;
  close(): Promise<void>;
}
```

`load()` applies no policy. It does not check a Flow's idle rule, run status or schema version — those
decisions belong to `Flow.onRestoreSessionDoc()`. `save()` must reject a stale revision with
`SessionConflictError`.

Inject an alternative implementation through the engine, which is also how tests substitute a
store:

```ts
FlowEngine.create({
  flows: [CustomerFlow],
  providers: [...],
  sessionStore: new MyStore(),
});
```

Then verify it against the shared behavioural suite:

```ts
await SessionStoreConformanceUtil.run(() => new MyStore());
```

The suite covers revision numbering, conflict on a stale save, conflict on a stale delete,
preservation of ISO-looking strings in user data, and the requirement that two concurrent
saves from one revision produce exactly one winner.

## Flow-owned session idle policy

The store does not evaluate session age. A Flow that needs an idle rule calls
`sessionIdleMs(doc)` from `onRestoreSessionDoc()` and returns `null` to start a
new session. Retention and cleanup remain separate application responsibilities.

## Completion versus deletion

These are different operations with different consequences.

| Operation | What it does | Document | Session ID |
| --- | --- | --- | --- |
| `TerminateSessionStep` | Sets `runStatus = "completed"` in `onEnter()`, reports `isEnd()` | Retained | Cannot be resumed; a new request with it creates a new session |
| `sessionCompleted()` / `markCompleted()` | Sets `runStatus = "completed"` directly | Retained | Same |
| Unhandled error | Engine sets `runStatus = "aborted"` and persists the message | Retained | Same |
| `deleteSession(id)` | Removes the row or document, under the same lock and revision check as a write | Gone | Gone |

```ts
// Completing a conversation
return go(TerminateSessionStep).withPrompt("Confirm the saved customer.");

// Deleting the record
await flowEngine.deleteSession(sessionId);
```

A completed session is a record you can audit: transcript, state, token totals, log entries.
Delete only when the record itself must not exist — a retention policy, a privacy request.

`deleteSession()` returns `{ success, session }` and, on failure, a `message`. Note that it
is not a `RunResponseType`; it has no `completed` or `contentType`.

<div class="callout callout--warning"><span class="callout__title">endChat() is deprecated</span><p><code>FlowEngine.endChat(sessionId)</code> now simply delegates to <code>deleteSession()</code>. The name is misleading: ending a conversation does not imply destroying its record. Call <code>deleteSession()</code> directly, and migrate any <code>POST /ai/end</code> style endpoint to an HTTP <code>DELETE</code> route so the API stops conflating completion with deletion.</p></div>

## Failure modes

| Symptom | Cause |
| --- | --- |
| Sessions vanish after a restart | `SESSION_STORE` unset or set to `MEMORY` |
| Sessions vanish after a deploy, with a durable store | `DOCUMENT_DB` was set instead of `SESSION_STORE` |
| Conversations restart mid-way | A Flow-owned restore policy returned `null`; inspect its idle or validation rule |
| Conversations restart after a release | `onRestoreSessionDoc()` reset them on a schema version bump |
| `Configuration value 'MONGODB_URL' is required.` | Mongo selected without a connection string |
| `SessionConflictError` on save | Another writer advanced the revision first |
| `Session 'x' belongs to flow 'A', not 'B'.` | A session ID was reused with a different `flowName` |
| `Session 'x' violates the one-flow invariant` | The document was hand-edited or written by something other than PicoFlow |
| Dates come back as strings | Only session metadata dates are revived |

Related: [The session document](/docs/concepts/session-document/),
[Concurrency and session conflicts](/docs/guides/concurrency/), and
[Session stores](/docs/reference/session-stores/).
