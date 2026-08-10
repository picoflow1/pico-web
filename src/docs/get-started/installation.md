---
title: Installation
eyebrow: Get started
lede: Install the package, satisfy the ESM and Node requirements, add a license key, and decide where your environment variables live.
source: pf/README.md
---

PicoFlow ships as a single package, `@picoflow/core`. It has no CLI, no code generator,
and no project scaffold. You add it to an existing TypeScript service and start writing
`Flow` and `Step` classes.

## Install the package

```bash
npm install @picoflow/core
```

```bash
yarn add @picoflow/core
```

The published package version is 1.1.2. Pin it explicitly rather than floating a caret
range while you are still learning the API surface.

## Runtime requirements

The published `package.json` declares:

| Field | Value | Consequence |
| --- | --- | --- |
| `type` | `module` | The package is ESM. |
| `engines.node` | `>=22.5` | Older Node releases are unsupported. |
| `exports["."]` | `import` points at `dist/picoflow.mjs`; `require` points at `dist/picoflow.cjs` | Both ESM and CommonJS applications are supported. |

### The package is ESM

`@picoflow/core` publishes ESM and CommonJS entry conditions. In practice this means:

- Your own package must set `"type": "module"`, or your files must use the `.mts`/`.mjs`
  extensions.
- Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`.
- Relative imports in your own source need explicit `.js` extensions, because Node's ESM
  loader does not do extension resolution:

```ts
import { HotelFlow } from "./myflow/hotel-flow/hotel-flow.js";
```

- CommonJS applications can use `require("@picoflow/core")` through the published
  `require` export.

### Decorators

`@Tool` and `@Tools` are legacy TypeScript method decorators. Enable them in
`tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Without `experimentalDecorators`, TypeScript compiles the newer ECMAScript decorator
form, and the handler registration that `@Tool` performs will not run.

## Peer expectations

PicoFlow declares its LangChain and Zod dependencies directly rather than as peers, but
your application code shares those types across the boundary, so version drift shows up as
confusing type errors rather than clean resolution failures.

| Package | Version PicoFlow 1.1.2 depends on | Why your code sees it |
| --- | --- | --- |
| `zod` | 4.4.3 | `defineTool()` returns `ToolType[]`, whose `schema` field is typed as `z.ZodObject`. You author those schemas. |
| `@langchain/core` | 1.2.3 | Memory holds LangChain messages. `withMessage(...)`, `HumanMessageEx`, `AiMessageEx` and `structOutputSchema()` all sit on LangChain types. |

Install the same major versions in your own `package.json`:

```bash
npm install zod@4 @langchain/core@1
```

Zod 4 is not optional. PicoFlow's `ToolType.schema` is `z.ZodObject` from Zod 4, and the
session document schema is built with Zod 4 constructs such as
`z.record(z.string(), z.any())`. A Zod 3 object will not be assignable.

Provider SDKs (`@langchain/openai`, `@langchain/anthropic`, `@langchain/deepseek`,
`@langchain/google`, `@langchain/ollama`, `@langchain/openrouter`) are bundled with
`@picoflow/core`. You do not install them separately to use the built-in adapters.

Azure OpenAI, Moonshot, and Z.AI use the bundled OpenAI runtime with their respective
connection settings, so they do not require another provider SDK.

## The license key

PicoFlow is proprietary and validates a signed license token at runtime. The token is read
from the `PICOFLOW_KEY` environment variable.

```bash
PICOFLOW_KEY=your-license-token
```

Personal evaluation keys are free and issued on request. See
[licensing](/license/) to request one; it is normally returned the same working day.

Verification happens inside the model/tool loop, not at import time. The practical effect
is that a service with a missing or expired key starts and accepts HTTP requests normally,
and then fails on the first turn that reaches a model response. The failure surfaces as a
flow error: `License token missing`, `Invalid license signature`, `Unsupported license
version` or `License expired`.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Add a smoke test that runs one real turn of a trivial flow in CI. A unit test that only constructs a <code>Flow</code> will pass without a valid key and will not tell you that production is about to fail.</p></div>

## Where environment variables go

PicoFlow reads configuration through its own `ConfigManager`, which is created when you
build a `FlowEngine`. Precedence is, from lowest to highest:

1. values loaded from a dotenv file (`.env` in the current working directory by default);
2. `process.env`;
3. explicit `values` passed to the `ConfigManager` constructor.

That means a real environment variable always wins over a value in `.env`, which is the
behaviour you want in a container.

You can point it at a different file, or bypass dotenv entirely:

```ts
import { ConfigManager, FlowEngine } from "@picoflow/core";

const engine = await FlowEngine.create({
  configManager: new ConfigManager({
    envFilePath: [".env.local", ".env"],
  }),
  flows: [],
  providers: [],
});
```

If a `.env` file is absent, `ConfigManager` continues silently; any other read error is
thrown.

### The variables PicoFlow itself reads

| Variable | Purpose |
| --- | --- |
| `PICOFLOW_KEY` | Runtime license token. Required. |
| `SESSION_STORE` | Session backend: `MEMORY` (default), `SQLITE`, `MONGO`, `COSMO`/`COSMOS`. |
| `SESSION_EXPIRATION` | Session lifetime in seconds. Defaults to `600`. |
| `SQLITE_PATH` | SQLite file path. Defaults to `ignore/session/session.sqlite`. |
| `COSMODB_KEY`, `COSMODB_URL`, `COSMODB_ID`, `COSMODB_SESSION_ID` | Azure Cosmos DB connection. |
| `MONGODB_NAME`, `MONGODB_COLLECTION`, `MONGODB_URL` | MongoDB connection. |
| `SELF_URL` | The application's own run endpoint. Only needed for `concurrentSteps(...)` batch mode. |

Provider API keys such as `OPENAI_API_KEY` are also read into `CoreConfig`, but the
adapters you register in `FlowEngine.create({ providers })` receive their credentials
explicitly from your bootstrap code. Reading the key from configuration and passing it to
an adapter is your application's job, not a hidden default. See
[Models and providers](/docs/concepts/models-and-providers/).

## Verify the install

```ts
import { Flow, FlowEngine, Step, TerminateSessionStep } from "@picoflow/core";

class PingFlow extends Flow {
  protected configModel() {
    return { provider: "openai", name: "gpt-4o-mini" } as const;
  }

  protected defineSteps(): Step[] {
    return [new TerminateSessionStep(this)];
  }
}

const engine = await FlowEngine.create({ flows: [PingFlow], providers: [] });
console.log(engine.getFlowNames()); // [ 'PingFlow' ]
```

`FlowEngine.create(...)` is asynchronous and returns a promise. This example registers no
providers, so it proves that imports and registration work but cannot run a turn. Continue
with [Your first flow](/docs/get-started/first-flow/).
