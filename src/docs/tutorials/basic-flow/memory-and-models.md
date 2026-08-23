---
title: 15. Memory namespaces and model overrides
eyebrow: BasicFlow tutorial
lede: Two builder calls on a registered step decide what conversation history it sees and which model answers for it. Both are declared in one place, and both are load-bearing.
source: pico-demo/src/myflow/basic-flow/basic-flow.ts
---

`defineSteps()` is where BasicFlow's non-obvious configuration lives. Every
`.useMemory(...)` decides whether a step shares a transcript with its neighbours, and
every `.useModel(...)` decides what it costs and how it reasons. This lesson reads that
list line by line.

## The goal

- Share a conversation history between steps, or isolate it.
- Override the flow's model for one step.
- Understand how step params combine with flow params — and when they do not.
- Read the `gpt-5` reasoning example correctly.

## The registration list

```ts
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
```

Both builders return `this`, so they chain in either order.

## Memory namespaces

A namespace is a named message array in the flow document. Steps sharing a name share
one array; steps with different names cannot see each other's turns at all.

| Namespace | Steps | Effect |
| --- | --- | --- |
| `default` | `NameStep`, `AddressStep`, `DOBStep`, `FooLogicStep`, `GooLogicStep` | One continuous profile-collection transcript |
| `separate` | `InContextStep` | The nested movie-idea work is quarantined |
| `favorite` | `FavoritesStep` | The favourites exchange does not enter the profile transcript |
| `president` | `PresidentStep` | The alternate entry point has its own history |
| `temp` | `TerminateSessionStep` | The closing turn does not inherit the collection transcript |
| class name | `WeatherStep`, `ConcurStep1`–`ConcurStep4` | Default when `.useMemory()` is not called |

The default comes from the `Step` constructor:

```ts
protected constructor(flow: Flow) {
  this.flow = flow;
  this.memorySpace = this.id;
}
```

so a step that says nothing gets a private namespace named after its class. `WeatherStep`
is the only main-path step in that position, which is fine — nothing later needs to see
how the city names were negotiated, and the temperatures are in its durable state.

### What sharing actually buys

The `default` group is genuinely sequential conversation. When `DOBStep` runs, the model
sees the name exchange that `NameStep` just had. That is why `DOBStep`'s prompt can say
{% raw %}`ask the user to provide the date of birth for {{UserName}}`{% endraw %} and the reply reads as a
continuation rather than a fresh interrogation.

The cost is context length and cross-talk. Every message in a shared namespace is sent
on every model call for every step using it. A step with a very different role — the
sci-fi movie generator, the favourites collector — inherits instructions and tool
traces that are irrelevant at best and confusing at worst. That is why
`InContextStep` and `FavoritesStep` are isolated.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Share a namespace when the steps are stages of one conversation with one persona. Isolate when the step has a different role, a different audience, or runs as a nested child.</p></div>

### Namespace rules

```ts
const MEMORY_NAMESPACE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const RESERVED_MEMORY_NAMESPACES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
```

`useMemory` calls `assertValidMemoryNamespace` immediately, so an invalid name throws in
`defineSteps()` — before the first request completes. Namespaces become object keys in
the persisted document, which is why the pattern is conservative and the three
prototype-pollution names are reserved.

### The nested-execution hazard

Repeating the warning from [lesson 13](/docs/tutorials/basic-flow/parallel-runsteps/) because
it is a namespace decision, not a `runSteps` decision: two steps in the same
`runSteps([...])` call must not share a namespace. The runner mutates the history array
in place — including overwriting slot 0 with the current step's system prompt — so
concurrent children on one array interleave and corrupt it. `ConcurStep1` through
`ConcurStep4` are each on their own class-name namespace, which is what makes BasicFlow's
fan-out safe.

## Model overrides

The flow default is declared once:

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

Two steps override it. `WeatherStep` gets `gpt-5` and `DOBStep` gets `gpt-5.1`, both
with `reasoning: { effort: "low" }`. Everything else inherits `gpt-4o-mini`.

During `bootstrap()` the flow walks its steps and fills in the gaps:

```ts
for (const [, step] of this.stepMap) {
  const name = step.getModel();
  if (!name) {
    step.inheritModel(this.getModelSelection());
  }
  if (!step.isLogic()) flowEngine.validateModel(step.getModelSelection());
}
```

Note the second line: logic steps are skipped, because they never call a model.
Everything else is validated against the registered providers on the first request.

### The parameter merge rule

This is the subtle part, and the `gpt-5` example only works because of it:

```ts
export function resolveStepModelSelection(
  flow: ResolvedModelSelection,
  step?: ResolvedModelSelection,
): ResolvedModelSelection {
  if (!step) {
    return {
      provider: flow.provider,
      name: flow.name,
      params: merge({}, flow.params),
      ...(flow.retryAttempts === undefined ? {} : { retryAttempts: flow.retryAttempts }),
    };
  }
  return {
    provider: step.provider,
    name: step.name,
    params:
      step.provider === flow.provider && step.name === flow.name
        ? merge({}, flow.params, step.params)
        : merge({}, step.params),
    ...((step.retryAttempts ?? flow.retryAttempts) === undefined
      ? {}
      : { retryAttempts: step.retryAttempts ?? flow.retryAttempts }),
  };
}
```

Flow params are inherited **only when the step selected the same provider and model**.
A step on a different model starts from an empty parameter set.

`retryAttempts` is different: it is PicoFlow's runner policy, not a provider
parameter. A Step inherits the Flow value even when it selects a different
model, unless the Step explicitly provides its own value. BasicFlow sets three
attempts once in `configModel()`, so its `gpt-5` and `gpt-5.1` stages use the
same runner policy without inheriting an invalid temperature.

`timeoutMs` is runner policy too, but it is deliberately not part of the model
selection. BasicFlow declares it with `configLlmCallPolicy()`, so the same deadline
applies when a step changes provider or model. Unlike `retryAttempts`, the call policy
is code-owned and is not persisted in the session document. See
[lesson 2](/docs/tutorials/basic-flow/first-flow/#configllmcallpolicy) for its scope and
override rules.

That is not a stylistic choice. Parameters belong to a model, and `gpt-5` does not
accept `temperature`. The OpenAI adapter says so explicitly:

```ts
capabilities: (selection) => ({
  temperature: !/^gpt-5(?:$|[-.:])|^o\d/.test(selection.name),
}),
```

and `validateAdapter` throws when a temperature is present on a model that reports
`temperature: false`:

```text
Model 'openai:gpt-5' does not support temperature.
```

If step params inherited the flow's `temperature: 0.2`, `WeatherStep` and `DOBStep`
would both fail at bootstrap on every request. Because the model name differs, they get
`{ reasoning: { effort: "low" } }` and nothing else.

### Params are schema-checked

For a built-in provider and model, the params object is parsed by a strict Zod schema
before it is stored:

```ts
const openAIReasoningSchema = z
  .object({
    reasoning: z
      .object({ effort: z.enum(["minimal", "low", "medium", "high"]).optional() })
      .strict()
      .optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();
```

So `effort: "very low"` is rejected, and `.strict()` means writing
`{ temperature: 0.2 }` alongside `gpt-5` is rejected at the schema before it ever
reaches the capability check. Chat models like `gpt-4o-mini` get a different schema that
accepts `temperature` and `topP` but has no `reasoning` field.

An unknown model on a **built-in** provider is a hard error:

```text
Unknown built-in model 'openai:gpt-4.7'. Add it to PicoModelCatalog before selecting it.
```

A model on a **custom** provider passes through untyped, which is exactly what the
NVIDIA adapter from [lesson 1](/docs/tutorials/basic-flow/bootstrapping/) needs:

```ts
new FavoritesStep(this)
  .useMemory("favorite")
  .useModel({
    provider: "nvidia",
    name: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    params: { temperature: 0.2 },
  }),
```

That block is present but commented out in `basic-flow.ts`; the active registration is
the plain `new FavoritesStep(this).useMemory("favorite")`. It is worth reading anyway as
the shape of a custom-provider override.

## Persistence and change detection

The resolved selection is written into the flow document, and any step-level override
into that step's slot. `toPersistedModelSelection` strips anything that looks like a
credential before writing:

```ts
const SENSITIVE_PARAMETER_KEYS = new Set([
  "apikey", "api_key", "authorization", "credential",
  "credentials", "password", "secret", "token",
]);
```

so a params object carrying a key does not end up in your session store.

Because the override is persisted per step, a resumed session keeps the model it started
with for that step, even if you have since edited `defineSteps()`.

## Why it is written this way

Putting memory and model on the registration line rather than inside the step class is a
deliberate inversion. A step class describes *what the stage does*; the flow describes
*how this deployment runs it*. The same `NameStep` could be registered in a cheap flow on
`gpt-4o-mini` and in a premium flow on something larger, with no change to the step.

It also gives you one screen that answers the two questions an operator actually asks:
what does this cost, and what can each stage see? Scanning fourteen `.useModel` and
`.useMemory` calls is faster than opening fourteen files.

The strictness — Zod-checked params, capability checks, namespace patterns validated on
call — is all front-loaded to bootstrap. A misconfiguration fails on request one, in
development, rather than on the turn that happens to reach `DOBStep`.

## Common mistakes

- **Assuming flow params carry over to an overridden model.** They do not, unless the
  provider and model name are identical. That is the behaviour that makes `gpt-5` work.
- **Setting `temperature` on a reasoning model.** Rejected by the strict schema, and by
  the capability check if it gets past it.
- **Sharing a namespace between concurrent children.** Silent history corruption.
- **Sharing a namespace between roles.** Every message is resent on every call for every
  step in that namespace. It costs tokens and it confuses the model.
- **Expecting `useMemory` to isolate state.** It isolates *conversation history* only.
  Step state is always per step, and `flow.getStepState` crosses namespaces freely.
- **Overriding a model without a registered provider.** `validateModel` throws at
  bootstrap; add the adapter in the module.

## Next

`WeatherStep` has not been examined yet.
[16. @Tools batching](/docs/tutorials/basic-flow/mcp-and-multi-tool/) takes it apart.
