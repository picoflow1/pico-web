---
title: Your first flow
eyebrow: Get started
lede: "Build a working two-step flow from an empty file: the flow shell, one step with a prompt and a tool, provider registration, and the first HTTP call."
source: pico-demo/docs/picoflow-workflow-developer-guide.md
---

This page builds a complete, runnable flow. It collects a customer email address, validates
it in code, and ends the session. Every snippet is copy-pasteable; the last section wires
them together.

Assumes you have completed [Installation](/docs/get-started/installation/) and have
`OPENAI_API_KEY` and `PICOFLOW_KEY` available.

## 1. Create the flow shell

A `Flow` is the durable workflow boundary. It owns the registered name, the default model,
and the set of steps that can ever be activated. Two members are mandatory: `configModel()`
and `defineSteps()`.

```ts
// src/support-flow/support-flow.ts
import { Flow, Step, TerminateSessionStep } from "@picoflow/core";
import { CollectEmailStep } from "./collect-email-step.js";

export class SupportFlow extends Flow {
  protected configModel() {
    return {
      provider: "openai",
      name: "gpt-4o-mini",
      params: { temperature: 0.2 },
      retryAttempts: 3,
    } as const;
  }

  protected defineSteps(): Step[] {
    return [
      new CollectEmailStep(this).useMemory("support"),
      new TerminateSessionStep(this).useMemory("end"),
    ];
  }
}
```

Four things are happening here.

`configModel()` is abstract on `Flow`. It declares the default provider, model, model
parameters, and runner retry policy for every step that does not override it. The `as const` matters: it narrows the literal types so
PicoFlow's catalog can select the exact parameter shape for that model.

`defineSteps()` constructs the step registry. Every step that can be activated by `go(...)`,
`runStep(...)`, `runSteps(...)`, a logic response, or a terminal transition must appear
here. A step you can reach but did not register is a runtime error.

Each step takes the flow as its only constructor argument. `Step`'s constructor signature is
`protected constructor(flow: Flow)` — there is no "is initial" flag.

The **first** step returned from `defineSteps()` becomes the initial cursor for a new
session. Here that is `CollectEmailStep`. Override `initialStep()` only when the starting
step depends on runtime context.

`useMemory("support")` selects the conversation-history namespace this step writes to.
Without it the namespace defaults to the step's class name.

<div class="callout callout--note"><span class="callout__title">Note</span><p>Use explicit <code>.js</code> extensions in relative imports. PicoFlow is ESM and Node's loader does not resolve extensions.</p></div>

## 2. Write the step

A `Step` is the customisation boundary. A conventional conversational step overrides only
three things: `getPrompt()`, `defineTool()`, and one or more `@Tool` handlers.

```ts
// src/support-flow/collect-email-step.ts
import {
  Flow,
  Step,
  TerminateSessionStep,
  Tool,
  ToolResponseType,
  ToolType,
  go,
  stay,
} from "@picoflow/core";
import { z } from "zod";

export class CollectEmailStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    return `You are a support intake assistant.
Ask the user for the email address on their account.
As soon as they supply one, call the capture_email tool with it.
Do not ask the user to confirm or reformat an address that looks complete.`;
  }

  public defineTool(): ToolType[] {
    return [
      {
        name: "capture_email",
        description: "Validate and store the customer's account email address",
        schema: z.object({
          email: z.string().describe("The email address the user supplied"),
        }),
      },
    ];
  }

  @Tool
  protected async capture_email(
    args: Record<string, any>,
  ): Promise<ToolResponseType> {
    const email = String(args.email ?? "").trim().toLowerCase();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return stay("That address is not valid. Ask the user for another one.");
    }

    this.saveState({ email });

    return go(TerminateSessionStep).withPrompt(
      `Thank the user and confirm that support will reply to ${email}.`,
    );
  }
}
```

### getPrompt()

Returns the system message. It is called before every model invocation, including the
repeated calls inside a tool loop, so it may safely read current state, another step's
state, or session context.

Write behavioural instructions here. Do not put security or final business validation in
prompt text — the model can misread it. The tool schema and the handler are the runtime
boundary.

### defineTool()

Returns `ToolType[]`: a `name`, a `description`, and a Zod object `schema`. Definitions from
every step and from `Flow.defineTool()` are composed into one flow-wide registry, so tool
names must be unique across the entire flow. A duplicate fails at bootstrap.

### The @Tool handler

`@Tool` does two things: it exposes the registered tool to this step's model call, and it
registers the method as the runtime handler. When the method name matches the tool name,
the bare decorator is enough; otherwise use `@Tool("capture_email")` on a differently named
method.

The handler is where the decision lives:

- `stay(feedback)` keeps `CollectEmailStep` active and hands the feedback string back to
  the model as the tool result. The model sees it and asks again. `stay()` is valid only
  inside a tool handler.
- `this.saveState({ email })` merges durable JSON into this step's persisted state.
- `go(TerminateSessionStep)` moves the one durable cursor to another registered step.
  `.withPrompt(...)` stores that text as `_prompt` on the destination, and
  `TerminateSessionStep.getPrompt()` honours it.

Routing is a return value from your code. The model never chooses the next step.

## 3. Register the flow and a provider

PicoFlow ships no default model catalog. Every model — the flow default, every
`.useModel(...)` override, and any memory-summary model — must resolve through a provider
adapter that your application registers.

```ts
// src/engine.ts
import { ConfigManager, FlowEngine, ModelProvider } from "@picoflow/core";
import { SupportFlow } from "./support-flow/support-flow.js";

const config = new ConfigManager();

export const engine = await FlowEngine.create({
  flows: [SupportFlow],
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get("OPENAI_API_KEY") },
    }),
  ],
});
```

`FlowEngine.create({ ... })` is asynchronous and validates the complete set of flows before
registering any of them.

By default the registered flow name is the class name, so callers send
`"flowName": "SupportFlow"`. If you need a public name that survives a TypeScript class
rename, pass a map instead of an array:

```ts
await FlowEngine.create({
  flows: { support: SupportFlow },
  providers: [],
});
```

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>A map key must equal the class's static <code>id</code>, which defaults to the class name. To decouple a public name from the class name you must also override the static <code>id</code> on the flow class. Registration throws if the two disagree.</p></div>

`createBuiltinAdapters(...)` returns adapters for PicoFlow's bundled integrations —
`openai`, `azureOpenai`, `google`, `anthropic`, `moonshot`, `zai`, `ollama`,
`openrouter`. Pass connection options only for the ones you use. Adapters own connection
setup; they do not set temperature, reasoning effort or any other hyperparameter. Those
belong in `configModel()` or `.useModel(...)`.

## 4. Expose it over HTTP

`@picoflow/core` does not ship an HTTP controller. You call `engine.run(...)` from whatever
web framework you already use. This is the whole contract:

```ts
// src/server.ts
import { createServer } from "node:http";
import { HttpContentType } from "@picoflow/core";
import { engine } from "./engine.js";

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/ai/run") {
    res.statusCode = 404;
    return res.end();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  const result = await engine.run({
    flowName: body.flowName,
    userMessage: body.message,
    sessionId: req.headers["chat_session_id"] as string | undefined,
    config: body.config,
  });

  if (result.session) res.setHeader("CHAT_SESSION_ID", result.session);
  if (!result.success) res.statusCode = 400;

  if (result.contentType && result.contentType !== HttpContentType.Plain) {
    res.setHeader("content-type", result.contentType);
    return res.end(result.message);
  }

  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result));
}).listen(8000);
```

`engine.run(...)` takes `{ flowName, userMessage, sessionId?, config? }` and returns
`{ success, completed, message, session, contentType }`. The `config` object is stored as
the flow's session-wide context on the first turn of a session.

The demo application's NestJS version of exactly this handler is in
`pico-demo/src/controllers/ai-controller.ts`, and it also exposes `GET /ai/flows` and
`POST /ai/end`.

## 5. Make the first call

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{"flowName":"SupportFlow","message":"Hi"}'
```

```text
HTTP/1.1 200 OK
CHAT_SESSION_ID: 6870216993a135e7deb762c7
content-type: application/json

{"success":true,"completed":false,"message":"Hi. What is the email address on your account?","session":"6870216993a135e7deb762c7","contentType":"text/plain"}
```

Send the returned session ID back on the next turn:

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -H 'CHAT_SESSION_ID: 6870216993a135e7deb762c7' \
  -d '{"flowName":"SupportFlow","message":"its not-an-email"}'
```

The model calls `capture_email`, your regex rejects it, `stay(...)` returns the feedback,
and the model asks again — all inside one HTTP request. Supply a valid address and the same
handler saves state, routes to `TerminateSessionStep`, and the response comes back with
`"completed": true`.

## What you built

```text
SupportFlow                       one registered flow, one session document
 ├── CollectEmailStep             prompt, capture_email tool, handler, state
 │     stay(...)  -> ask again
 │     go(...)    -> advance
 └── TerminateSessionStep         marks the session completed
```

At this point the session document holds the flow name, the model selection, the context
from `config`, the `support` and `end` memory namespaces, the saved `email` under
`CollectEmailStep`, the current cursor, and the execution sequence.

## Next

<div class="cards">
	<a class="card" href="/docs/get-started/first-request/">
		<span class="card__title">Your first request</span>
		<span class="card__body">The full HTTP contract: session resumption, error codes, and content types.</span>
	</a>
	<a class="card" href="/docs/concepts/">
		<span class="card__title">Flows and steps</span>
		<span class="card__body">The mental model behind what you just wrote.</span>
	</a>
	<a class="card" href="/docs/concepts/state-memory-context/">
		<span class="card__title">State, memory, context, transient</span>
		<span class="card__body">The four kinds of data and which one your value belongs in.</span>
	</a>
	<a class="card" href="/docs/get-started/run-the-demo/">
		<span class="card__title">Run the demo app</span>
		<span class="card__body">Three larger flows you can run and read.</span>
	</a>
</div>
