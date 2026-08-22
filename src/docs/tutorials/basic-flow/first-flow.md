---
title: 2. Your first flow
eyebrow: BasicFlow tutorial
lede: A Flow declares a default model and a registry of the steps it is allowed to activate. It is not a graph, and it does not describe the order steps run in.
source: pico-demo/src/myflow/basic-flow/basic-flow.ts
---

The most common early misreading of PicoFlow is to treat `defineSteps()` as a
sequence. It is not. It is an allow-list. The order of the array matters only for
picking a default entry point; everything after that is decided by the transition a
handler returns.

## The goal

- Declare a flow-wide default model with `configModel()`.
- Register every step the flow may ever activate with `defineSteps()`.
- Understand why a `go()` target must appear in that list.
- Understand what a `Flow` instance's lifetime actually is.

## The minimum flow

From `pico-demo/src/myflow/basic-flow/basic-flow.ts`:

```ts
export class BasicFlow extends Flow {
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
      new WeatherStep(this).useModel({
        provider: "openai",
        name: "gpt-5",
        params: { reasoning: { effort: "low" } },
      }),
      new NameStep(this).useMemory("default"),
      new AddressStep(this).useMemory("default"),
      new DOBStep(this).useMemory("default").useModel({
        provider: "openai",
        name: "gpt-5.1",
        params: { reasoning: { effort: "low" } },
      }),
      new FooLogicStep(this).useMemory("default"),
      new GooLogicStep(this).useMemory("default"),
      new InContextStep(this).useMemory("separate"),
      new ConcurStep1(this),
      new ConcurStep2(this),
      new ConcurStep3(this),
      new ConcurStep4(this),
      new PresidentStep(this).useMemory("president"),
      new FavoritesStep(this).useMemory("favorite"),
      new TerminateSessionStep(this).useMemory("temp"),
    ];
  }
}
```

That is the entire structural declaration of a fourteen-step workflow. There is no
edge list, no `.addTransition()`, no separate graph file.

### configModel()

`configModel()` is `protected abstract` on `Flow`; every subclass must implement it. It
returns a `{ provider, name, params, retryAttempts? }` selection. `as const` is not required but it
narrows the literal types, which makes the provider/model pair checkable.

The returned model is the default for every step that does not call `.useModel(...)`.
During `bootstrap()` the flow walks its step map and calls `step.inheritModel(...)`
for each step with no model of its own, then validates each resolved selection against
the registered providers. A typo in a provider name fails at bootstrap, on the first
request, not halfway through a conversation.

### defineSteps()

Every step is constructed with `new SomeStep(this)`. The `Step` constructor is
`protected constructor(flow: Flow)` — a single argument.

<div class="callout callout--note"><span class="callout__title">Choosing the entry point</span><p>The <code>Step</code> constructor takes only the flow. The first registered step is the default entry point; override <code>initialStep()</code> when the entry point depends on context.</p></div>

The builder methods `.useMemory(ns)` and `.useModel(sel)` both return `this`, so they
chain, and both are covered in [lesson 15](/docs/tutorials/basic-flow/memory-and-models/).

## A flow is a registry

`Flow.collectSteps()` calls `defineSteps()` once and stores the results in a map keyed
by class name:

```ts
public collectSteps() {
  const steps = this.defineSteps();
  for (const step of steps) {
    this.stepMap.set(step.getName(), step);
  }
}
```

Everything downstream reads that map. `flow.goto(StepClass)` resolves through
`requireStep(stepClass.id)`, which throws:

```text
Step 'ReviewStep' is not defined in flow 'BasicFlow'.
```

The same map backs `flow.getStepState(StepClass, key)`,
`flow.saveTransientStepState(StepClass, json)`, and `runStep(StepClass)`. If a class
is not in `defineSteps()`, none of those work on it.

Tool definitions are collected the same way. `composeTool()` iterates the step map,
calls `defineTool()` on each step, appends `Flow.defineTool()`, and builds one
flow-wide registry. Duplicate tool names fail at bootstrap:

```text
Duplicate tool 'address' registered in flow 'BasicFlow'.
```

That is why tool names must be unique across the whole flow, not merely per step.

## The step document is created from the registry too

`createFlowDoc()` calls `createDoc()` on every registered step, so the persisted
session document contains a slot for all fourteen steps from the moment the session is
created — even the ones this conversation will never reach. The flow envelope looks
like this:

```json
{
  "name": "BasicFlow",
  "currentStep": "WeatherStep",
  "model": { "provider": "openai", "name": "gpt-4o-mini", "params": { "temperature": 0.2 } },
  "steps": [{ "name": "WeatherStep", "state": {} }],
  "memory": {},
  "context": {},
  "sequence": []
}
```

`currentStep` is the only durable conversation cursor. There is exactly one, and it
holds a step name string.

## How it works

Per request, the engine does this:

```text
new BasicFlow()          // fresh instance, no state
flow.addContext(config)  // only when a config object was supplied
flow.init()              // your async setup hook, default no-op
flow.collectSteps()      // defineSteps() runs here
flow.bootstrap(...)      // resolve models, fetch or create the doc, read state back
```

So `defineSteps()` runs on **every request**, and the `Step` instances are recreated
every time. Their durable state is not held on the instance across requests; it is
read back out of the session document by `step.readDoc(flowDoc.steps)` during
bootstrap and written back by `step.writeDoc(...)` during save.

This has a practical consequence: do not put mutable runtime caches in a step field
and expect them to survive a turn. Use `saveState()` for anything durable, or rebuild
the cache in `onRestore()`.

## Why it is written this way

Declaring the allowed steps up front, rather than discovering them from the
transitions, gives the framework three things it could not otherwise have:

1. **A complete persistence schema before the first turn.** Every step's state slot
   exists immediately, so a resumed session never has to reconcile a missing entry.
2. **Bootstrap-time validation.** Unknown providers, duplicate tool names, and an
   `initialStep()` that names an unregistered class all fail on request one.
3. **A readable inventory.** `defineSteps()` is the one place a reviewer can see
   every stage, its memory namespace, and its model. That listing is the reason this
   file is worth opening first when you inherit someone else's flow.

The cost is that adding a step means editing two files: the step itself and the
registry. That is a deliberate trade — the framework prefers an explicit failure at
startup over an implicit one mid-conversation.

## Common mistakes

- **Reading `defineSteps()` as an execution order.** It is an allow-list. The array
  order only supplies the default `currentStep` when `initialStep()` returns `null`,
  and `BasicFlow` overrides `initialStep()` anyway.
- **Hiding the entry point.** The constructor takes only the flow. Keep the
  default entry step visible in registration order, or override `initialStep()`
  when runtime context selects it.
- **Returning a step from `go()` that is not registered.** It throws
  `Step 'X' is not defined in flow 'Y'.` at transition time, which is the middle of a
  user turn.
- **Duplicating a tool name across two steps.** Tool definitions are merged into one
  flow-wide registry, so a second `address` or `terminate_session` definition fails at
  bootstrap. Note that `terminate_session` is defined once, by the framework's
  `TerminateSessionStep`; the four steps that call it only add a `@Tool` handler.

## Next

The registry is declared. [3. Your first step](/docs/tutorials/basic-flow/first-step/)
writes the smallest thing you can put in it.
