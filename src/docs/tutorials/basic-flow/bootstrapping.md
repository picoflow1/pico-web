---
title: 1. Bootstrapping PicoFlow in NestJS
eyebrow: BasicFlow tutorial
lede: PicoFlow has no server of its own. It is a library you register as one Nest provider, wire to a controller, and hand a session id round-trip.
source: pico-demo/src/app.module.ts, pico-demo/src/main.ts, pico-demo/src/controllers/ai-controller.ts
---

Before any of the flow code makes sense you need to know what is holding it. PicoFlow
ships a `FlowEngine` class, not a framework runtime. You construct one, give it the
flow classes it is allowed to instantiate and the model providers it is allowed to
call, and then you call `engine.run(...)` from wherever your HTTP layer lives. In the
demo that layer is NestJS with a Fastify adapter, but nothing in the engine depends on
Nest.

## What you will build

- One `FlowEngine` registered as a Nest provider, constructed from configuration.
- Built-in model provider adapters for the providers you actually use.
- Inline MongoDB and Cosmos client factories with application-owned credentials.
- A custom adapter for a provider PicoFlow does not bundle.
- A `POST /ai/run` controller that passes the session id both ways.

## Registering the engine

For chat and decision providers, model choices, database clients, and shutdown in one place,
see [Application configuration](/docs/guides/application-configuration/).

From `pico-demo/src/app.module.ts`, trimmed to three flows and Cosmos key
authentication. Install `mongodb` and `@azure/cosmos` as application dependencies
for these SDK imports. The
[persistence guide](/docs/guides/persistence/#application-owned-database-initialization)
shows the demo's full Cosmos credential selection.

```ts
import { ModelProvider, FlowEngine } from "@picoflow/core";
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import { CosmosClient } from "@azure/cosmos";
import { BasicFlow } from "./myflow/basic-flow/basic-flow.js";
import { HotelFlow } from "./myflow/hotel-flow/hotel-flow.js";
import { InvoiceFlow } from "./myflow/invoice-flow/invoice-flow.js";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [TutorialController, AiController, HealthController],
  providers: [
    {
      provide: FlowEngine,
      useFactory: (config: ConfigService) =>
        FlowEngine.create({
          configManager: config,
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
                configuration: {
                  baseURL: "https://integrate.api.nvidia.com/v1",
                },
              },
            }),
          ],
        }),
      inject: [ConfigService],
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(FlowEngine) private readonly engine: FlowEngine) {}

  async onApplicationShutdown(): Promise<void> {
    await this.engine.close();
  }
}
```

The application owns registration, configuration, and SDK client construction.

`configManager: config` gives the engine the same reader used for credentials.
`SESSION_STORE` selects storage; only the selected `sessionClients` factory
runs. With `COSMO`, no Mongo client is constructed and `MONGODB_URL` is not
required. Mongo still needs `MONGODB_NAME` and `MONGODB_COLLECTION`; Cosmos
needs `COSMODB_ID` and `COSMODB_SESSION_ID` and a container partitioned by `/id`.

Keep connection settings inside these zero-argument callbacks. The full demo
Cosmos factory supports key authentication, an explicit service principal, and
`DefaultAzureCredential`. All seven tutorial flows use the same engine and
store setup; their flow classes own business state and restore policy.

`flows` is a registration list of constructors, not instances. `FlowEngine` stores the
classes and builds a fresh `Flow` object per request through `FlowCreator.create(...)`.
That is why a `Flow` subclass must have a no-argument constructor, and why flow
instances are never shared between sessions.

`FlowEngine.create(...)` is declared `async` and returns a `Promise<FlowEngine>`. Nest
awaits a promise returned from `useFactory`, so this works without an explicit
`await`. The factory prepares the selected session store before returning.
If you construct the engine outside Nest, remember to await it.

`engine.close()` releases owned SDK clients during shutdown. Enable Nest's
shutdown hooks with `app.enableShutdownHooks()` in `main.ts`, as the demo does.
Use `sessionClients.ownsClients: false` only for clients shared and closed by
your application. See [client ownership](/docs/guides/persistence/#client-ownership-and-shutdown).

`ModelProvider.createBuiltinAdapters(...)` returns an array of adapters for every
bundled provider — openai, azure-openai, google, anthropic, deepseek, moonshot, zai,
ollama, openrouter. Passing configuration only for the ones you use is fine; the rest
are still registered but will fail if a flow ever selects them. The demo comments out
the unused entries rather than deleting them, which is a reasonable habit.

`ModelProvider.createCustomAdapter(...)` is the escape hatch. NVIDIA exposes an
OpenAI-compatible endpoint, so `runtimeProvider: "openai"` reuses PicoFlow's bundled
OpenAI runtime while `provider: "nvidia"` gives it a distinct name that a step can
select with `.useModel({ provider: "nvidia", ... })`. The integration stays owned by
the application; PicoFlow does not have to ship an NVIDIA adapter for you to use one.

<div class="callout callout--note"><span class="callout__title">Note</span><p>The OpenAI adapter declares a capability: <code>temperature</code> is unsupported for models matching <code>gpt-5</code> and the <code>o</code>-series. A temperature override on those models is dropped with a session warning rather than failing the request.</p></div>

## The controller

From `pico-demo/src/controllers/ai-controller.ts`, trimmed of Swagger decorators:

```ts
@Controller("ai")
export class AiController {
  constructor(@Inject(FlowEngine) private flowEngine: FlowEngine) {}

  @HttpCode(HttpStatus.OK)
  @Post("run")
  async run(
    @Res() res: FastifyReply,
    @Body(K.message) userMessage: string,
    @Body(K.flowName) flowName: string,
    @Body("config") config: object,
    @Headers(K.ChatSessionID) sessionId?: string,
  ) {
    const result = await this.flowEngine.run({
      flowName,
      userMessage,
      sessionId,
      config,
    });
    if (result.session) {
      res.header(K.ChatSessionID, result.session);
    }
    if (!result.success) {
      res.status(HttpStatus.BAD_REQUEST);
    }
    if (result.contentType && result.contentType !== HttpContentType.Plain) {
      return res.type(result.contentType).send(result.message);
    }
    return res.send(result);
  }
}
```

`K` is the framework's constant table, so the wire format is not restated as string
literals in your code. `K.message` is `"message"`, `K.flowName` is `"flowName"`, and
`K.ChatSessionID` is `"CHAT_SESSION_ID"`.

`flowEngine.run(...)` takes `{ flowName, userMessage, sessionId, config }` and returns
`{ success, completed, message, session, contentType }`. Note that `success: false` is
returned as a value, not thrown: the engine catches flow errors, marks the session
document `aborted`, persists it, and returns the message. The controller turns that
into a 400.

## The CHAT_SESSION_ID round-trip

There is exactly one piece of client state, and it is the session id.

```text
turn 1  ->  POST /ai/run   (no CHAT_SESSION_ID header)
        <-  200, header CHAT_SESSION_ID: 9f3c...  body.session: 9f3c...

turn 2  ->  POST /ai/run   header CHAT_SESSION_ID: 9f3c...
        <-  200, same id
```

When `sessionId` is absent the engine creates a new session document, generates a
UUID, and returns it in both the response header and the body. The client echoes it
back on every subsequent turn. Everything else — the current step, the conversation
memory, every step's state, the token tally — lives in the persisted document, keyed
by that id.

`main.ts` has to make that header usable from a browser:

```ts
app.enableCors({
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Accept, Authorization, CHAT_SESSION_ID",
  exposedHeaders: "CHAT_SESSION_ID",
});
```

`exposedHeaders` is the one people forget. Without it the browser receives the header
but JavaScript cannot read it, and every turn starts a new session.

## How it works

The request path is short and worth memorising:

```text
AiController.run
  -> FlowEngine.run
       -> flowSession.withSessionLock(sessionId)
            -> FlowCreator.create(flowName, sessionId, engine, { config })
                 -> new BasicFlow()
                 -> flow.init()
                 -> flow.collectSteps()      // calls defineSteps()
                 -> flow.bootstrap(...)      // fetch or create the session doc
            -> flow.run(userMessage)
            -> flow.saveSession()
```

The session lock is taken before the flow is constructed and released after the
document is written, so two concurrent requests for the same session id serialize
rather than racing. The session store itself also uses a revision-based
compare-and-swap.

`config` is passed into flow context on **creation only**. `FlowEngine.run` wraps it
as `{ config: input.config }` and `FlowCreator` calls `flow.addContext(context)`
before bootstrap. When an existing session is restored, `readDoc()` overwrites the
in-memory context with the persisted one. A new `config` object on turn 5 does not
reconfigure a session that started on turn 1.

## Why it is written this way

The engine is a provider rather than a Nest module because it has no Nest
dependencies at all. It reads configuration through a `ConfigManager` abstraction and
resolves models through adapters you supply. That keeps the demo honest: if you drop
Fastify for Express, or Nest for a plain HTTP handler, only `ai-controller.ts` changes.

Registering providers explicitly, rather than reading environment variables inside the
framework, means model access is auditable in one file. You can see at a glance which
providers this deployment can reach.

## Common mistakes

- **Constructing a `FlowEngine` per request.** It owns the session store and the model
  registry. Register it once as a singleton provider.
- **Forgetting `exposedHeaders: "CHAT_SESSION_ID"`.** The server behaves correctly,
  the tests pass, and every browser turn silently starts a fresh session.
- **Expecting `config` to apply on later turns.** It initialises flow context for a
  new session only. Domain values belong in the state of the step that collects them.
- **Assuming a failed flow throws.** `FlowEngine.run` returns
  `{ success: false, message }` for most errors. If your controller only checks for
  exceptions it will return 200 on a broken session.

## Next

With the engine wired up, [2. Your first flow](/docs/tutorials/basic-flow/first-flow/)
writes the `Flow` subclass it is allowed to instantiate.
