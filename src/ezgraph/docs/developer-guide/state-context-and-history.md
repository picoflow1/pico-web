---
layout: layouts/ezgraph.njk
title: State, context, and history | EZGraph
description: Configure application-owned database clients, choose the initial node, and manage durable state, context, and history.
permalink: /ezgraph/docs/developer-guide/state-context-and-history/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# State, context, and history

Configure session persistence, choose the initial node, route history, and manage
durable node state and graph context.

## Application-owned database initialization

Create database SDK clients in your application's startup code, alongside graph
and model registration. In a Nest application, this is `app.module.ts`.
[ezgraph-demo's AppModule](https://github.com/picoflowio/ezgraph-demo/blob/main/src/app.module.ts)
passes inline `sessionClients` factories to `GraphEngine.create()`. The application
reads its connection settings and chooses authentication; EZGraph adapts the
selected client to its session document store.

Install the SDKs your application imports:

```sh
npm install mongodb @azure/cosmos @azure/identity
```

The following Nest example keeps the demo's database initialization convention,
with only QuoteGraph and its OpenAI model registered:

```ts
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CosmosClient } from "@azure/cosmos";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
import { MongoClient } from "mongodb";
import { GraphEngine, ModelProvider } from "@picoflow/ezgraph";
import { QuoteGraph } from "./graphs/quote-graph/quote-graph.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [{
    provide: GraphEngine,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => GraphEngine.create({
      configManager: config,
      graphs: [QuoteGraph],
      providers: ModelProvider.createBuiltinAdapters({
        openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      }),
      sessionClients: {
        mongodb: () => {
          const url = config.getOrThrow<string>("MONGODB_URL");
          const tlsCAFile = config.get<string>("MONGODB_TLS_CA_FILE");
          return new MongoClient(url, tlsCAFile ? { tlsCAFile } : {});
        },
        cosmos: () => {
          const endpoint = config.get<string>("COSMO_ENDPOINT")
            || config.get<string>("COSMOS_ENDPOINT")
            || config.get<string>("COSMODB_URL");
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
  constructor(@Inject(GraphEngine) private readonly engine: GraphEngine) {}

  async onApplicationShutdown(): Promise<void> {
    await this.engine.close();
  }
}
```

Nest's `ConfigModule` loads `.env`. Enable shutdown hooks with
`app.enableShutdownHooks()` in `main.ts` so process signals run the cleanup hook.
For a standalone application, pass a `ConfigManager` as `configManager` and put
the same factories in the `GraphEngine.create()` call in your entry point.

`SESSION_STORE` selects the backend. Only its factory runs: selecting `cosmos`
does not construct a MongoDB client or require `MONGODB_URL`. Each factory takes
no arguments and may return a client directly or asynchronously. Read secrets
and SDK options inside that factory so configuration for an unused backend is
not required at startup.

| Backend | Session configuration read by EZGraph |
| --- | --- |
| `memory` (default) | No database client; sessions last for the process lifetime. |
| `sqlite` | `SQLITE_DB_PATH`, default `./data/sessions.sqlite`. |
| `mongodb` (alias `mongo`) | Required `MONGODB_NAME` and `MONGODB_COLLECTION`. The application factory above reads `MONGODB_URL` and optional `MONGODB_TLS_CA_FILE`. |
| `cosmos` (alias `cosmosdb`) | `COSMO_DB_ID`, default `langgraph`; `COSMO_DB_SESSION_CONTAINER_ID`, default `sessions`. The application factory above reads the endpoint and credentials. |

For MongoDB, a minimal local configuration is:

```dotenv
SESSION_STORE=mongodb
MONGODB_URL=mongodb://localhost:27017
MONGODB_NAME=ezgraph
MONGODB_COLLECTION=sessions
```

`MONGODB_TLS_CA_FILE` is an optional path to a trusted CA certificate file, passed
as the MongoDB SDK's `tlsCAFile` option. Set it when your deployment requires a
custom CA, such as a DocumentDB connection configured that way. Keep connection,
TLS, and authentication options in the application factory.

For a pre-provisioned Cosmos database and container using key authentication:

```dotenv
SESSION_STORE=cosmos
COSMO_ENDPOINT=https://your-account.documents.azure.com:443/
COSMODB_KEY=your-account-key
COSMO_DB_ID=ezgraph
COSMO_DB_SESSION_CONTAINER_ID=sessions
COSMOS_CREATE_IF_NOT_EXISTS=false
```

The example factory uses a key first. For an explicit service principal, omit
the key and set `AZURE_TENANT_ID`, `COSMO_DB_CLIENT_ID`, and
`COSMO_DB_CLIENT_SECRET`. With neither a key nor explicit client credentials,
it uses `DefaultAzureCredential`. This authentication choice belongs to your
application, so you can adapt it to your company's credential conventions.

EZGraph connects the MongoDB client and ensures a unique session `id` index.
For Cosmos, it validates that the container's partition key is `/id`.
`COSMOS_CREATE_IF_NOT_EXISTS` defaults to `true`; the framework then creates the
database and container if needed, using `COSMOS_THROUGHPUT` (default `400`).
Set it to `false` when resources are provisioned separately, and grant the
chosen identity the permissions needed for the session operations.

Factory-created clients are owned by the engine by default. `engine.close()`
closes the MongoDB client or disposes the Cosmos client; initialization failures
also release owned clients. If a factory returns a client shared elsewhere in
your application, set `sessionClients.ownsClients: false` and close that client
through your application's own lifecycle.

Factories are optional: without one for the selected backend, EZGraph retains
its built-in configuration-based client creation. Use application-owned
factories when you need explicit authentication or SDK connection options.

## Initial node and history routing

The first argument to `createGraphStateAnnotation()` declares the initial
`currentNode`. In the [node contract example](/ezgraph/docs/developer-guide/nodes-and-execution/#the-node-contract), a new session starts at `DriverNode`.
Map that node to a named history in the graph definition:

```ts
static getGraphDefinition(): GraphDefinition {
  return {
    llmConfig: ModelCatalog.model("openai:gpt-5.4", { retries: 2 }),
    endNode: GRAPH_END_NODE,
    historySpaces: [
      [DriverNode, "quote-intake"],
      [VehicleNode, "quote-intake"],
    ],
  };
}
```

Before invoking a node, `BaseGraph.prepareInput()` resolves the cursor, chooses
its history space, and appends the customer's message there. The START branch
created by `registerTurnNodes()` then enters that same node.

| Session | Cursor used for input | History space |
| --- | --- | --- |
| New session | The state schema's initial `currentNode`, here `DriverNode.id()` | The initial node's mapping, here `"quote-intake"` |
| Restored session | The saved `currentNode` | The saved node's mapping |
| Session reset by `onRestoreSessionDoc()` returning `null` | The state schema's initial `currentNode` | The initial node's mapping |
| Any selected node without a mapping | The cursor resolved above | `"default"` |

Node registration order does not choose the initial cursor. Keep the initial
node registered as a turn node, and supply a non-empty cursor default; preparing
a first message without that default fails before model work begins.

For complete examples, see [QuoteGraph's history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/#four-history-spaces)
and [DecisionHotelGraph's history spaces](/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/#history-spaces).

## Graph-wide runtime context

Use `context` for runtime information shared across stages. New graph states
start with `{}`, and the session document saves it under `graph.context`.
For example, a QuoteGraph session can contain this fragment:

```json
{
  "graph": {
    "id": "QuoteGraph",
    "context": {
      "rating": {
        "calculatedAt": "2027-06-01T10:00:00.000Z",
        "businessDate": "2027-06-01"
      }
    }
  }
}
```

During an active node invocation:

```ts
this.graph.saveContext({
  rating: { calculatedAt: now.toISOString() },
});
const context = this.graph.getContext();
```

`BaseGraph` exposes the same methods for graph-owned policies. `saveContext()`
replaces the supplied top-level branches while preserving unrelated branches.
Writing `rating` again replaces that entire subtree; nested objects and arrays
are not deep-merged. `null` remains an ordinary JSON value.

The root is a JSON object; values may be nested objects, arrays, strings, finite
numbers, booleans, or null. The framework rejects undefined, functions, dates,
circular references, and other non-JSON values. Convert dates to ISO strings.
Writes are cloned; reads are detached, deeply frozen snapshots.

A successful node outcome publishes staged context to the next node and the
normal session checkpoint. If the node throws, its staged changes are discarded;
previously completed checkpoints retain theirs. Concurrent sessions are isolated.
A parallel superstep permits one context writer. Internal `LlmNode` workers
may read graph context but cannot write it, even when they execute sequentially
or in a nested call. Consolidate their local output in a conversation-owning or
deterministic join node before updating shared context.

`createGraphStateAnnotation()` declares the context channel. Custom
`Annotation.Root()` schemas can import `GraphContextChannel` from
`@picoflow/ezgraph` and declare `context: new GraphContextChannel()`.
Outside execution, inspect saved context in the session returned by
`GraphEngine.getSession()`.

In QuoteGraph, coverage calculation and quote adjustment write rating timestamps.
Acceptance reads that shared metadata and saves an acceptance timestamp. Business
facts remain in node state, request options remain in `config`, and context is
included in prompts only when application code explicitly adds it. See the
[QuoteGraph context example](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/#shared-runtime-context).

## State belongs to the node that owns it

Inside an active node invocation, `saveState()` stages a patch to the current
node channel. EZGraph materializes that channel and LangGraph's node reducer
replaces it atomically. A conversational or deterministic owner can use
`graph.saveNodeState()` for another node's channel. An internal `LlmNode` may
write only its own channel and token usage.

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput): Promise<ToolResponse> {
  const driver = validateDriver(input);
  if ("error" in driver) return stay(JSON.stringify({ accepted: false, error: driver.error }));

  this.saveState({ driver: driver.value });
  return go(VehicleNode);
}
```

The node publishes the tool's name, description, and zod schema from
`defineTool()`; `@Tool(name)` binds the handler. Arguments are schema-validated
before the handler runs, and invalid arguments return `{ accepted: false, error }`
to the model instead of throwing.

```ts
this.saveState({ criteria });
this.graph.saveNodeState(PresentNode, { hotelFound: results });
return go(PresentNode).withMessage(
  new HumanMessage("Present the current hotel choices and booking options."),
);
```

`graph.graphState()` exposes the invocation's materialized graph state. Use it
when deterministic policy needs data owned by another node. Do not mutate a
node instance or a session document directly.

With conditional fan-out, save parent-owned input before returning
`fanout(Child1Node, Child2Node)`. Each worker supplies explicitly selected facts
through `getPrompt(state)` or constructs a task message in
[`onEnter()`](/ezgraph/docs/developer-guide/nodes-and-execution/#prepare-input-with-onenter),
then saves accepted output in `onResponse()`. Its model history
is ephemeral, not a copy of a named conversation history. The parent remains
the durable conversation cursor until the joined conversational stage responds.
See [execution ownership](/ezgraph/docs/developer-guide/nodes-and-execution/#execution-ownership)
and [fan-out and join](/ezgraph/docs/developer-guide/topology/#conditional-fan-out-and-join).
