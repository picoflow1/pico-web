---
title: Create and register a flow
eyebrow: Guides
lede: "The shortest path from an empty file to a working endpoint: a Flow subclass, a step, provider adapters, engine registration, and the first HTTP call."
source: picoflow-demo/docs/picoflow-workflow-developer-guide.md
---

You need this when you are adding a new workflow to an application that already runs
PicoFlow, or when you are wiring PicoFlow into a service for the first time. A flow is not
usable until four things exist: the `Flow` subclass, at least one `Step`, a provider adapter
that can resolve the model you named, and a registration on the `FlowEngine`.

## The shortest correct recipe

Four files, in this order.

### 1. The flow shell

```ts
// src/myflow/customer-flow/customer-flow.ts
import { Flow, Step, TerminateSessionStep } from "@picoflow/core";
import { CollectCustomerStep } from "./collect-customer-step.js";

export class CustomerFlow extends Flow {
  protected configModel() {
    return { provider: "openai", name: "gpt-4o-mini" } as const;
  }

  protected defineSteps(): Step[] {
    return [
      new CollectCustomerStep(this).useMemory("customer"),
      new TerminateSessionStep(this).useMemory("end"),
    ];
  }
}
```

`configModel()` is abstract — the build fails without it. `defineSteps()` returns every step
that can ever be activated in this flow, in order. The first entry becomes the initial cursor
for a new session.

<div class="callout callout--note"><span class="callout__title">The Step constructor takes one argument</span><p>The signature is <code>protected constructor(flow: Flow)</code>; write <code>new SomeStep(this)</code>. The initial step is the first entry of <code>defineSteps()</code>, or whatever <code>initialStep()</code> returns.</p></div>

### 2. One step

```ts
// src/myflow/customer-flow/collect-customer-step.ts
import { Flow, Step, Tool, TerminateSessionStep, go, stay } from "@picoflow/core";
import type { ToolResponseType, ToolType } from "@picoflow/core";
import { z } from "zod";

export class CollectCustomerStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    return "Ask for the customer ID, then call lookup_customer with it.";
  }

  public defineTool(): ToolType[] {
    return [
      {
        name: "lookup_customer",
        description: "Validate and save a customer identifier",
        schema: z.object({ customerId: z.string().uuid() }),
      },
    ];
  }

  @Tool
  protected async lookup_customer(
    args: Record<string, any>,
  ): Promise<ToolResponseType> {
    const customer = await this.directory.find(args.customerId);
    if (!customer) return stay("No customer matched that ID; ask for another.");
    this.saveState({ customer });
    return go(TerminateSessionStep).withPrompt("Confirm the saved customer.");
  }
}
```

### 3. Register providers and flows on the engine

`FlowEngine.create({ flows, providers })` is the form the demo application uses. It is a
static async factory that returns a configured engine.

```ts
// src/app.module.ts
FlowEngine.create({
  flows: [BasicFlow, HotelFlow, InvoiceFlow, CustomerFlow],
  providers: [
    ...ModelProvider.createBuiltinAdapters({
      openai: { apiKey: config.get<string>("OPENAI_API_KEY") },
      google: { apiKey: config.get<string>("GEMINI_API_KEY") },
      anthropic: { apiKey: config.get<string>("ANTHROPIC_API_KEY") },
    }),
  ],
});
```

PicoFlow ships no default model catalog and reads no API key on its own. If nothing registers
an adapter for the provider string in `configModel()`, the flow fails at bootstrap with
`Model 'openai:gpt-4o-mini' is not registered and provider 'openai' has no adapter.`

### 4. Call it

```bash
curl -i http://localhost:8000/ai/run \
  -H 'content-type: application/json' \
  -d '{
    "flowName":"CustomerFlow",
    "message":"Hi",
    "config":{"tenantId":"demo"}
  }'
```

The response carries a `CHAT_SESSION_ID` header and a matching `session` field. Send that
header back on every later turn of the same conversation.

## How registration actually works

`registerFlows()` accepts either an array of constructors or a name-to-constructor map:

```ts
engine.registerFlows([CustomerFlow, HotelFlow]);

engine.registerFlows({
  CustomerIntake: CustomerFlow,
});
```

The map form throws unless the key equals `FlowClass.id`, and `Flow.id` defaults to the class
name. So the map form is not a renaming mechanism by itself — override the static `id` on the
flow class when you want a public name that survives a TypeScript class rename:

```ts
export class CustomerFlow extends Flow {
  static override get id(): string {
    return "CustomerIntake";
  }
  // ...
}
```

The registered name is part of the persisted schema. A session document stores
`flow.name`, and the name check happens *before* `onRestoreSessionDoc()`, so a renamed flow
cannot migrate its own old sessions. See
[One flow per session](/docs/concepts/one-flow-per-session/).

`registerFlow(FlowClass)` is a single-flow convenience wrapper. Prefer the bulk form during
bootstrap because it validates the whole set — duplicates, empty IDs, key mismatches —
before mutating the registry.

## Decisions you are making here

| Decision | Options | Consequence |
| --- | --- | --- |
| Registered name | Class name, or an overridden static `id` | Baked into every session document; renaming breaks resume |
| Initial step | First entry of `defineSteps()`, or `initialStep()` | `initialStep()` can read request context; the ordering rule cannot |
| Memory layout | Per-step default namespace, or shared via `useMemory(...)` | Shared namespaces give continuity; separate ones isolate tool traces |
| Model scope | Flow default only, or per-step `useModel(...)` | Step overrides are persisted in the session document |
| Terminal step | Include `TerminateSessionStep`, or call `sessionCompleted()` | Conversations should terminate through the step; workers may not need it |

`initialStep()` is only worth overriding when the starting cursor depends on runtime context.
`BasicFlow` does exactly that:

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

Both classes stay registered in `defineSteps()`. Conditional *activation* is safe;
conditional *registration* is not, because a restored session may name a step that the
current `defineSteps()` no longer builds.

## Failure modes

| Symptom | Cause |
| --- | --- |
| `FlowClass 'X' not registered.` | The class never reached `registerFlows()`, or the caller sent a different `flowName` |
| `Flow registration 'X' must match Flow ID 'Y'.` | Map-form key does not equal the class's static `id` |
| `Flow 'X' is already registered.` | The same name was registered twice, often from two module imports |
| `Model '...' is not registered and provider '...' has no adapter.` | No adapter for the provider string in `configModel()` or `useModel()` |
| `Initial step 'X' is not defined in flow 'Y'.` | `initialStep()` returned a class that is absent from `defineSteps()` |
| `Duplicate tool 'x' registered in flow 'Y'.` | Two steps defined the same tool name; definitions are flow-wide |
| `Flow 'X' has not been bound to a FlowEngine.` | `getFlowEngine()` was called from `init()`, which runs before the engine is bound |
| `SESSION_FLOW_MISMATCH` | An existing session ID was reused with a different `flowName` |

<div class="callout callout--note"><span class="callout__title">Note</span><p><code>init()</code> runs after request context is added but before <code>defineSteps()</code> collects steps and before the engine binding exists. Use it only for setup that needs neither the engine nor a loaded session, and remember it runs on every request including restored ones.</p></div>

## Where to go next

<div class="cards">
	<a class="card" href="/docs/guides/flow-contract/">
		<span class="card__title">The Flow subclass contract</span>
		<span class="card__body">Every hook on Flow, what it defaults to, and when overriding it is justified.</span>
	</a>
	<a class="card" href="/docs/guides/authoring-a-step/">
		<span class="card__title">Steps and tools</span>
		<span class="card__body">Authoring a step, defining tools, prompts, batch handlers and structured output.</span>
	</a>
	<a class="card" href="/docs/guides/nested-execution/">
		<span class="card__title">Composition</span>
		<span class="card__body">Nested children with runStep/runSteps, and concurrent batch workers.</span>
	</a>
	<a class="card" href="/docs/guides/persistence/">
		<span class="card__title">Production</span>
		<span class="card__body">Session stores, migration, concurrency conflicts, error handling and testing.</span>
	</a>
</div>

Working through a flow line by line instead? Start at
[Bootstrapping PicoFlow in NestJS](/docs/tutorials/basic-flow/bootstrapping/). For the normative
API surface see [FlowEngine](/docs/reference/flow-engine/) and [Flow](/docs/reference/).
