---
title: Flows and steps
eyebrow: Concepts
lede: "The two classes that carry the whole mental model: a Flow is the durable boundary and the registry, a Step is the customization boundary, and class names are persisted identifiers."
source: pico-demo/docs/picoflow-workflow-developer-guide.md
---

PicoFlow has exactly two abstractions you subclass. Everything else — memory, tools,
persistence, routing, model resolution — hangs off one of them. Getting the division of
responsibility right is most of what "learning PicoFlow" means.

```text
Flow -> registered Step -> prompt, tools, typed state, and memory
                       -> go(...) / stay(...) / direct(...)
                       -> one versioned session document
```

## Flow: the durable boundary

A `Flow` subclass declares a workflow. It owns:

| Responsibility | Expressed as |
| --- | --- |
| A stable registered name | The class name, or the static `id` |
| The default model | `configModel()` — abstract, you must implement it |
| The set of steps that can ever be activated | `defineSteps()` |
| The initial cursor | The first step from `defineSteps()`, or `initialStep()` |
| Flow-wide tool definitions | `defineTool()` |
| Memory container and summary policy | `getMemory()` in the constructor |
| Session-wide context | Populated from the first request's `config` |
| Restore and migration policy | `onRestoreSessionDoc(doc)` |
| Batch coordination | `spawnSteps()` and `concurrentSteps(...)` |

```ts
export class HotelFlow extends Flow {
  public constructor() {
    super();
    this.getMemory()
      .setSummaryModel({ provider: "openai", name: "gpt-4o" })
      .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
      .enableSummary("hotel-explore");
  }

  protected configModel() {
    return { provider: "openai", name: "gpt-4o" } as const;
  }

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
      new CompareStep(this).useModel({
        provider: "openai",
        name: "gpt-5.1",
        params: { reasoning: { effort: "low" } },
      }),
      new TerminateSessionStep(this).useMemory("end"),
    ];
  }
}
```

That is the entire `HotelFlow` class. Topology, model policy, and memory policy — nothing
else. All hotel behaviour lives in the three steps.

### The flow is the persistence boundary

"Durable boundary" is literal. One flow instance corresponds to exactly one session
document, and that document contains exactly one flow envelope — never an array of them.

The flow object itself is rebuilt from scratch on every HTTP invocation. It is not a
long-lived service. The engine constructs it, binds the registered name, adds the request
`config` as context, calls `init()`, collects steps, loads or creates the session, and
throws the instance away when the turn ends. Anything you want to survive must be in the
session document.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p>Do not do request-specific work in the <code>Flow</code> constructor or in <code>init()</code>. Both run on every single request, including restored sessions. They are for deterministic setup such as memory configuration, not for calling external systems.</p></div>

### defineSteps() is a registry, not a graph

`defineSteps()` does not describe transitions. It declares which steps exist. The transition
graph lives inside the step handlers, as `go(...)` targets.

This has a consequence worth internalising: conditional *registration* is dangerous,
conditional *activation* is fine. `BasicFlow` selects its starting step from context:

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

Both `PresidentStep` and `WeatherStep` are always registered. Only the choice of cursor
varies. If instead you registered a different *set* of steps depending on a value that can
change between turns, a restored session could find that the step named in
`flow.currentStep` no longer exists.

## Step: the customization boundary

A `Step` subclass owns one cohesive part of the conversation. Its constructor takes the flow
and nothing else:

```ts
protected constructor(flow: Flow)
```

A conventional conversational step overrides three members and nothing more:

```ts
export class CollectNameStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    return "Ask for a full name, then call capture_name.";
  }

  public defineTool(): ToolType[] {
    return [{
      name: "capture_name",
      description: "Validate and save a full name",
      schema: z.object({ name: z.string().min(1) }),
    }];
  }

  @Tool
  protected async capture_name(
    args: Record<string, any>,
  ): Promise<ToolResponseType> {
    const name = args.name.trim();
    if (!name.includes(" ")) return stay("Please provide a full name.");
    this.saveState({ name });
    return go(NextStep);
  }
}
```

Everything a stage needs is co-located: what the model is told, what it may call, what
happens when it calls, what gets saved, and where control goes next. A developer changing
name-collection behaviour opens one file.

The step is also the boundary for:

- **state** — `saveState`/`getState`, persisted per step;
- **memory** — a named conversation-history namespace, selected with `useMemory(...)`;
- **model** — an optional override with `useModel(...)`;
- **content type** — the HTTP content type of the response;
- **lifecycle hooks** — `onStart`, `onRestore`, `onEnter`, `onExit`, `onCrossing`;
- **response handling** — `onResponse`, `checkResponse`, `structOutputSchema`.

See [Step lifecycle](/docs/concepts/step-lifecycle/) for when each hook fires, and
[State, memory, context, transient](/docs/concepts/state-memory-context/) for the data model.

### One durable cursor

The flow envelope holds exactly one cursor: `flow.currentStep`, a step-name string. There is
no "active" flag on a step document. `Flow.goto(...)` — reached through `go(...)` in a
handler — is the only API that moves it.

Nested execution is different. `runStep(ChildStep)` and `runSteps([...])` push in-memory
execution frames. Children can save their own state, but they cannot move the cursor; they
return results to their owner, which alone decides the next durable position.

## Step class names are persisted identifiers

This is the single most important operational fact about PicoFlow, and it is easy to miss
because nothing in the source looks like a schema declaration.

The BasicFlow session document you supplied stores the step identifier in more
than one place. A shortened fragment looks like this:

```ts
flow: {
  name: "BasicFlow",
  currentStep: "TerminateSessionStep",
  steps: [{ name: "WeatherStep", state: { /* ... */ } }],
  memory: { "WeatherStep": { messages: [/* ... */] } },
  sequence: [{ level: 1, stepName: "WeatherStep" }],
}
```

`flow.currentStep` answers “which registered step receives the next top-level
turn?” The `flow.steps[].name` value answers “which persisted state entry
belongs to this step?” `flow.memory` and `flow.sequence` carry related step
identifiers. In this completed capture the cursor is `TerminateSessionStep`,
but `WeatherStep` still appears in the stored state, memory, and sequence.

Those identifiers are normally derived from the step class's `id` (which
defaults to its class name). Renaming `WeatherStep` to `WeatherLookupStep`
changes:

- the `name` key under which its state is stored and reloaded;
- the value written to `flow.currentStep`;
- every entry in the execution `sequence`;
- its default memory namespace, if `useMemory(...)` was not used;
- any `flow.getStepState(OldStepClass, ...)` call elsewhere; and
- any application query that searches sessions by step name.

<div class="callout callout--danger"><span class="callout__title">Renaming a step is a schema migration</span><p>If a session's <code>currentStep</code> is <code>"WeatherStep"</code>, the next restore cannot resolve it after the class is renamed. Even when the renamed step is not the current cursor—as in the completed capture above—its persisted <code>steps[].name</code>, memory namespace, sequence entries, and cross-step references still need migration if that stored history and state must be preserved. Handle all affected identifiers together in <code>onRestoreSessionDoc()</code>. See <a href="/docs/guides/migration/">Session document migration</a>.</p></div>

The same applies to the flow's registered name. Because the flow-name check happens before
the restore hook, a renamed flow cannot even reach your migration code — the request fails
with `SESSION_FLOW_MISMATCH` first.

## The shared tool registry

Tool definitions are collected once per flow instance, at bootstrap, from two sources:

1. `defineTool()` on every registered step; and
2. `defineTool()` on the flow itself.

They are merged into one registry. **Tool names must be unique across the entire flow.** A
duplicate throws at bootstrap:

```text
Duplicate tool 'lookup_customer' registered in flow 'CustomerFlow'.
```

Define a tool once at flow level when several steps share it:

```ts
public defineTool(): ToolType[] {
  return [{
    name: "lookup_customer",
    description: "Look up a customer by stable identifier",
    schema: z.object({ customerId: z.string().uuid() }),
  }];
}
```

### Definition, exposure, and dispatch are three different things

| Concern | Mechanism |
| --- | --- |
| Definition | `defineTool()` — the name, description and Zod schema, registered flow-wide |
| Exposure | Which tools this step offers the model on this turn: `@Tool`-decorated methods plus anything named in `useTool()` |
| Dispatch | Which method runs when the model calls it: the `@Tool`-decorated method, or a same-named undecorated method |

`@Tool` covers exposure and dispatch together, which is why it is the preferred form. Use
`@Tool("external_name")` when the method name differs from the tool name. Decorated
handlers are inherited, so a subclass can reuse or override a parent's handler.

A step is not offered tools it did not select, even though they exist in the flow registry.
If the model hallucinates a tool that is not exposed, PicoFlow records a session warning and
returns an informational tool message rather than failing the turn.

For a single model response containing several calls that should be processed together, add
a group handler with `@Tools([...])`. A matching group handler is authoritative — it shadows
the individual handlers completely, including for a single call, and must itself return a
valid route.

## Where to go next

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">The session document</span>
		<span class="card__body">Exactly what is persisted, and how revision-based writes work.</span>
	</a>
	<a class="card" href="/docs/concepts/flow-lifecycle/">
		<span class="card__title">Flow lifecycle</span>
		<span class="card__body">What happens between the HTTP request and the final save.</span>
	</a>
	<a class="card" href="/docs/concepts/routing/">
		<span class="card__title">Routing</span>
		<span class="card__body">go(), stay(), direct() and the transition builders.</span>
	</a>
	<a class="card" href="/docs/concepts/state-memory-context/">
		<span class="card__title">State, memory, context, transient</span>
		<span class="card__body">Four kinds of data with four different lifetimes.</span>
	</a>
</div>
