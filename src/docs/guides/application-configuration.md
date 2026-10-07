---
title: Application configuration
eyebrow: Guides
lede: "Configure app.module.ts: register flows, chat and decision providers, choose models, initialize session database clients, and close the engine on shutdown."
source: pico-demo/src/app.module.ts, pico-demo/src/main.ts, pf/src/picoflow/services/flow-engine.ts
---

Your application creates one `FlowEngine` and supplies the providers and session storage its
flows need. In the NestJS demo, this happens in `src/app.module.ts`. Other applications can
use the same `FlowEngine.create()` options in their own startup code; PicoFlow does not
require NestJS.

## Where each setting belongs

| Setting | Configure it in | Purpose |
| --- | --- | --- |
| Registered flows | `app.module.ts`: `flows` | Makes Flow constructors available to the engine |
| Chat provider credentials and endpoints | `app.module.ts`: `providers` | Connects provider IDs to runtime adapters |
| Default chat model and parameters | Flow `configModel()` | Chooses the model used by ordinary Steps without overrides |
| Step chat model override | Step `.useModel(...)` | Selects another registered provider/model for one Step |
| Decision provider credentials | `app.module.ts`: `decisionProviders` | Registers the adapter used by typed decisions |
| Decision model and call policy | Flow `configDecision()` and Step `.useDecision(...)` | Selects the decision model, timeout, and retry budget |
| Session backend and store identifiers | Environment read through `configManager` | Selects memory, SQLite, MongoDB, or Cosmos storage |
| Database credentials, TLS, and SDK options | `app.module.ts`: `sessionClients` factories | Constructs application-owned database clients |
| Resource cleanup | Application shutdown hook | Calls `engine.close()` |

Provider registration supplies credentials and connection settings. A Flow or Step selects
which model to use. Registering a provider does not select a default model for your flows.

## Configure app.module.ts

This example registers two demo flows, OpenAI chat support, the TypeSafe decision provider,
and MongoDB/Cosmos session-client factories. It shortens Cosmos authentication to an API key;
the [persistence guide](/docs/guides/persistence/#application-owned-database-initialization)
includes service-principal and default Azure credentials. Keep your existing controllers in
the module's `controllers` list.

Install the database SDKs imported by this example in your application:

```sh
npm install mongodb @azure/cosmos
```

```ts
// src/app.module.ts
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DecisionProvider, FlowEngine, ModelProvider } from "@picoflow/core";
import { MongoClient } from "mongodb";
import { CosmosClient } from "@azure/cosmos";
import { BasicFlow } from "./myflow/basic-flow/basic-flow.js";
import { DecisionHotelFlow } from "./myflow/decision-hotel-flow/decision-hotel-flow.js";

@Module({
  imports: [ConfigModule.forRoot()],
  providers: [{
    provide: FlowEngine,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => FlowEngine.create({
      configManager: config,
      flows: [BasicFlow, DecisionHotelFlow],
      providers: ModelProvider.createBuiltinAdapters({
        openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      }),
      decisionProviders: DecisionProvider.create({
        typesafe: { apiKey: config.get<string>("TYPESAFE_API_KEY") },
      }),
      sessionClients: {
        mongodb: () => {
          const url = config.getOrThrow<string>("MONGODB_URL");
          const tlsCAFile = config.get<string>("MONGODB_TLS_CA_FILE");
          return new MongoClient(url, tlsCAFile ? { tlsCAFile } : {});
        },
        cosmos: () => new CosmosClient({
          endpoint: config.getOrThrow<string>("COSMODB_URL"),
          key: config.getOrThrow<string>("COSMODB_KEY"),
        }),
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

Nest waits for the asynchronous factory before injecting the engine. `flows` contains
constructors; the engine creates a fresh Flow instance for each invocation.

To add another chat provider, supply its connection settings to
`ModelProvider.createBuiltinAdapters(...)`, or register a custom adapter. See
[Register providers and models](/docs/guides/providers-and-models/). Decision adapters use
the separate `decisionProviders` option; see
[Decision provider registration](/docs/reference/decision-step/#provider-registration).

## Choose chat and decision models

Declare the Flow's chat selection separately from application credentials:

```ts
protected configModel() {
  return {
    provider: "openai",
    name: "gpt-4o-mini",
    params: { temperature: 0.2 },
    retryAttempts: 3,
  } as const;
}
```

An ordinary Step inherits this selection unless its registered instance uses
`.useModel({ provider: "openai", name: "gpt-4o" })`. Model selections are validated during
Flow bootstrap. See the [model catalog](/docs/reference/model-catalog/) for supported
parameters and the [Flow reference](/docs/reference/#configllmcallpolicy) for shared chat-call
deadlines via `configLlmCallPolicy()`.

For typed decision Steps, set Flow defaults with a separate hook:

```ts
protected override configDecision() {
  return {
    provider: "typesafe",
    model: "jev-latest",
    timeoutMs: 15_000,
    maxRetries: 2,
  };
}
```

A registered DecisionStep can override these defaults with `.useDecision({...})`.
DecisionSteps use decision adapters and reject `.useModel()` and chat tools. Chat
`retryAttempts` counts total attempts; decision `maxRetries` counts additional attempts
after the first. The [DecisionStep reference](/docs/reference/decision-step/#configuration)
describes configuration precedence and defaults.

## Select session storage

`configManager: config` gives PicoFlow the same configuration reader used by the application's
factories. Set `SESSION_STORE=memory` for local sessions that may disappear on restart, or
choose a durable backend. For MongoDB:

```dotenv
SESSION_STORE=MONGO
MONGODB_URL=mongodb://localhost:27017
MONGODB_NAME=picoflow
MONGODB_COLLECTION=sessions
```

For Cosmos key authentication:

```dotenv
SESSION_STORE=COSMO
COSMODB_URL=https://your-account.documents.azure.com:443/
COSMODB_KEY=your-key
COSMODB_ID=picoflow
COSMODB_SESSION_ID=sessions
```

The Cosmos container must be partitioned by `/id`. Only the selected backend's client
factory runs, so read its credentials inside the callback. Memory and SQLite do not need
either database SDK client factory. Factories may return a client or a promise; PicoFlow
prepares the selected store before `FlowEngine.create()` resolves.

See [Persistence and session stores](/docs/guides/persistence/) for SQLite settings, credential
choices, and client ownership, and [Environment variables](/docs/reference/environment-variables/)
for the full configuration list. These clients back PicoFlow session storage; application
business-data repositories are configured separately by your application.

## Close resources on shutdown

The module above calls `engine.close()` in `onApplicationShutdown()`. Enable Nest's process
signal hooks in `main.ts` so that callback runs on shutdown:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(8000, "0.0.0.0");
```

`NestFactory` comes from `@nestjs/core`; import your `AppModule` in the same file. For a
non-Nest application, await `engine.close()` in its shutdown lifecycle. Close other
application resources through their own owners.

## Related

- [FlowEngine creation and options](/docs/reference/flow-engine/#flowenginecreate)
- [Run the demo](/docs/get-started/run-the-demo/)
- [Basic Flow bootstrapping](/docs/tutorials/basic-flow/bootstrapping/)
