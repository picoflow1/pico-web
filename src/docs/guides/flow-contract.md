---
title: The Flow subclass contract
eyebrow: Guides
lede: Every hook you can override on Flow, what the base class actually does, and the narrow set of reasons that justify overriding each one.
source: pf/src/picoflow/flow/flow.ts
---

`Flow` is a large class, but only nine members are meant to be overridden by an application.
Everything else on it — `goto`, `getContext`, `saveStepState`, `getMemory`, `markCompleted`,
`concurrentSteps` — is API you call, not API you replace. Use this page when you are deciding
whether a behaviour belongs in a `Flow` override or somewhere else.

## The hooks at a glance

| Hook | Visibility | Default behaviour | Override when |
| --- | --- | --- | --- |
| `configModel()` | `protected abstract` | None — you must implement it | Always. It declares the flow's provider, model name and params |
| `constructor()` | `public` | Sets empty context | Deterministic setup only, such as memory summary policy. Call `super()` |
| `init()` | `public async` | No operation | Per-instance setup that needs neither the engine nor a loaded session |
| `defineSteps()` | `protected` | Returns `[new TerminateSessionStep(this).useMemory("temp")]` | Always, for any flow with real stages |
| `initialStep()` | `protected` | Returns `null`, so the first entry of `defineSteps()` starts the session | The starting cursor depends on runtime context |
| `defineTool()` | `public` | Returns `[]` | Several steps share one tool definition |
| `onRestoreSessionDoc(doc)` | `protected async` | Returns `null` when expired or when `doc.version !== K.sessionDocVersion`, otherwise returns `doc` | You need migration, a different expiry policy, or a stricter compatibility check |
| `spawnSteps()` | `protected async` | Returns `""` | `config._concurrent` selects this flow as a batch coordinator |
| `run(message)` | `public async` | Dispatches to `spawnSteps()` or `requireCurrentStep().run(message)`, then builds `RunResponseType` | Almost never |
| `isBatch()` | `public` | Returns `false` | The flow needs an extra session checkpoint saved before `run()` |

## configModel() and the constructor

`configModel()` returns a model selection object. It is resolved lazily — after construction,
during `bootstrap()` — and validated against the registered provider adapter.

```ts
protected configModel() {
  return {
    provider: "openai",
    name: "gpt-4o",
    params: { temperature: 0.2 },
  } as const;
}
```

The `as const` matters: it lets the model catalog narrow the `params` type to the exact
parameter contract for that provider and model. See
[Register providers and models](/docs/guides/providers-and-models/).

The constructor is the only place to configure memory compaction, because the memory
container is read when steps are collected. `HotelFlow` does this and nothing else:

```ts
public constructor() {
  super();
  this.getMemory()
    .setSummaryModel({ provider: "openai", name: "gpt-4o" })
    .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
    .enableSummary("hotel-explore");
}
```

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>The constructor runs on every HTTP request, including every restored session. Do not open connections, call external services, or read request-specific data there.</p></div>

## init() and what is not bound yet

The creation order is fixed:

```text
new FlowClass()
  -> addContext({ config })
  -> await init()
  -> collectSteps()        // calls defineSteps()
  -> await bootstrap(sessionId, engine)
```

`init()` therefore runs *before* steps exist and *before* the `FlowEngine` is attached.
`this.getFlowEngine()` throws `Flow 'X' has not been bound to a FlowEngine.` if you call it
there, and `this.getSessionDoc()` throws `Flow 'X' has not been bootstrapped.`

What `init()` can safely see: the request `config`, already merged into flow context by
`addContext()`. That makes it useful for deriving values that `defineSteps()` or
`initialStep()` will read.

## defineSteps() and initialStep()

`defineSteps()` is a registry, not a graph. It answers "which steps exist", never "which step
comes next". The transition graph lives in the `go(...)` targets inside step handlers.

Every step reachable by `go()`, `gotoByName()`, `runStep()`, `runSteps()`, a `LogicStep`
response, or a terminal transition must appear here. `requireStep()` throws otherwise.

```ts
protected defineSteps(): Step[] {
  return [
    new ExploreStep(this).useMemory("hotel-explore").useModel({
      provider: "openai",
      name: "gpt-5.1",
      params: { reasoning: { effort: "low" } },
    }),
    new PresentStep(this).useModel({
      provider: "openai",
      name: "gpt-4o",
      params: { temperature: 0.5 },
    }),
    new CompareStep(this),
    new TerminateSessionStep(this).useMemory("end"),
  ];
}
```

Step class names are persisted as document keys, memory namespaces, the value of
`flow.currentStep`, and every entry in the execution `sequence`. Renaming a step class is a
session-schema change. Keep the registered *set* stable across turns; vary only the cursor.

`initialStep()` returns a `StepClassType` or `null`. Returning a class that is not in
`defineSteps()` throws at bootstrap:

```text
Initial step 'PresidentStep' is not defined in flow 'BasicFlow'.
```

## defineTool() at flow level

Flow-level tool definitions exist for one reason: several steps need the same tool name and
schema, and tool names must be unique across the entire flow.

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "lookup_customer",
      description: "Look up a customer by stable identifier",
      schema: z.object({ customerId: z.string().uuid() }),
    },
  ];
}
```

Definitions from `Flow.defineTool()` and from every registered step are merged into one
registry at bootstrap. A duplicate name throws
`Duplicate tool 'lookup_customer' registered in flow 'CustomerFlow'.`

Defining a tool does not expose it to any model. Steps select it with `useTool()` or with a
matching `@Tool("lookup_customer")` handler. See
[Defining and handling tools](/docs/guides/tools/).

## onRestoreSessionDoc()

The real signature returns the document or `null`:

```ts
protected async onRestoreSessionDoc(
  sessionDoc: SessionType,
): Promise<SessionType | null>
```

Returning the document continues restoration; the runtime saves it first, so a mutation made
here is persisted immediately. Returning `null` discards the session and creates a fresh one,
which changes the session ID returned to the caller.

The base implementation is the default policy, and it is stricter than most people expect:

```ts
protected async onRestoreSessionDoc(sessionDoc: SessionType) {
  if (!this.isSessionCurrent(sessionDoc)) return null;
  return sessionDoc;
}
```

Any document whose `version` is not exactly `K.sessionDocVersion` is reset. If you ship a
session-schema change without an override, every in-flight conversation silently restarts.
Full recipe in [Session document migration](/docs/guides/migration/).

## spawnSteps() and isBatch()

`Flow.run()` reads `config._concurrent` from flow context. When it is truthy, it calls
`spawnSteps()` instead of the current step:

```ts
public async run(message: string): Promise<RunResponseType> {
  const isConcurrent = this.getContext<boolean>("config._concurrent");
  const resp = isConcurrent
    ? await this.spawnSteps()
    : await this.requireCurrentStep().run(message);

  const step = this.requireCurrentStep();
  return {
    success: true,
    completed: step.isEnd(),
    message: MessageUtil.contentToText(resp),
    session: this.requireSessionDoc().id,
    contentType: step.contentType,
  };
}
```

`isBatch()` is unrelated to that dispatch, despite the name. It only makes the engine call
`saveSession()` once *before* `run()` starts, so a long-running coordinator has a persisted
document to log into. It does not select `spawnSteps()`.

See [Concurrent batch mode](/docs/guides/concurrent-steps/).

## Overriding run()

Do not, unless you are replacing the entire dispatch contract. An override takes ownership of
current-step selection, batch dispatch, `MessageContent` to text conversion, the `completed`
flag, the content type, and the shape of `RunResponseType` — which the HTTP adapter depends
on. Every case people reach for `run()` is better served by a step hook, a `LogicStep`, or
`direct(...)`.

## Flow accessors you call rather than override

| Concern | API |
| --- | --- |
| Durable cursor | `getCurrentStep()`, `requireCurrentStep()`, `goto(StepClass)`, `gotoByName(name)` |
| Execution frame | `getExecutingStep()`, `requireExecutingStep()` |
| Steps | `getStep(name)`, `requireStep(name)` |
| Cross-step state | `getStepState(StepClass, key?)`, `saveStepState(...)`, `saveTransientStepState(...)` |
| Context | `getContext<T>(key)`, `addContext(json)`, `setContext(obj)` |
| Memory | `getMemory()`, `getMemory(namespace)` |
| Session | `getSessionId()`, `getSessionDoc()`, `saveSession()`, `markCompleted()` |
| Tools | `getTool(name)`, `requireTool(name)` |

<div class="callout callout--note"><span class="callout__title">Current-step accessors</span><p>Use <code>getCurrentStep()</code> or <code>requireCurrentStep()</code> for the durable cursor. Inside nested execution, use <code>getExecutingStep()</code> or <code>requireExecutingStep()</code> for the step owning the current async frame.</p></div>

`getCurrentStep()` reads `flow.currentStep` from the document. `getExecutingStep()` returns
the innermost step on the execution stack when one exists, and falls back to the current step
otherwise. Inside `runStep()` these are different objects; outside nested execution they are
the same.

Next: [Register providers and models](/docs/guides/providers-and-models/), or the normative
listing in [Flow reference](/docs/reference/).
