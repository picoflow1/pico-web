---
title: Flow
eyebrow: Reference
lede: "The abstract Flow class: subclass hooks, the model declaration, the step registry, the restore hook, and the flow-owned data helpers that steps read through."
source: pf/src/picoflow/flow/flow.ts
---

`Flow` is the durable workflow boundary. One `Flow` subclass corresponds to one registered
name, one default model selection, one step registry, one tool registry, and exactly one
flow envelope inside a session document.

```ts
export abstract class Flow {
  static get id(): string;          // defaults to the class name
  public constructor();
  protected abstract configModel(): ModelSelection;
}
```

A flow instance is constructed fresh for every request and thrown away when the turn ends.
Nothing on the instance survives except what is written into the session document.

## Subclass hooks

| Hook | Signature | Default | Override when |
| --- | --- | --- | --- |
| `configModel()` | `protected abstract configModel(): ModelSelection` | Abstract — you must implement it | Always |
| `init()` | `public async init(): Promise<void>` | No operation | Deterministic per-instance setup is needed before steps are collected |
| `defineSteps()` | `protected defineSteps(): Step[]` | `[new TerminateSessionStep(this).useMemory('temp')]` | The flow declares its own stages |
| `initialStep()` | `protected initialStep(): StepClassType \| null` | `null` — the first step from `defineSteps()` starts the session | The initial cursor depends on runtime context |
| `defineTool()` | `public defineTool(): ToolType[]` | `[]` | Several steps share one tool definition |
| `onRestoreSessionDoc()` | `protected onRestoreSessionDoc(sessionDoc: SessionType): Promise<SessionType \| null>` | Accepts only the current document version | The stored document needs migration, an idle-time reset, or another stricter policy |
| `spawnSteps()` | `protected spawnSteps(): Promise<string>` | Returns `''` | `config._concurrent` should coordinate worker sessions |
| `run()` | `public run(message: string): Promise<RunResponseType>` | Dispatches to `spawnSteps()` or the current step, then builds the response envelope | The whole dispatch contract intentionally differs |
| `isBatch()` | `public isBatch(): boolean` | `false` | An extra pre-run session checkpoint is required |

### configModel()

```ts
protected abstract configModel(): ModelSelection;
```

Declares the flow's default provider, model, parameters, and runner retry policy, independently from step
composition. It is resolved lazily on first use, validated through `PicoModelCatalog`, and
then validated again against the registered provider adapter during bootstrap.

```ts
protected configModel() {
  return {
    provider: "openai",
    name: "gpt-4o",
    params: { temperature: 0.2 },
    retryAttempts: 3,
  } as const;
}
```

Every step without its own `useModel(...)` override inherits this selection, including
`retryAttempts`. See
[Model catalog](/docs/reference/model-catalog/) for the typing rules.

### init()

```ts
public async init(): Promise<void>;
```

Called by `FlowCreator.create()` after the request `config` has been added as context, but
**before** `collectSteps()` and before `bootstrap()` binds the `FlowEngine`. `getFlowEngine()`
therefore throws inside `init()`. Use it only for setup that needs neither the engine nor a
loaded session.

### defineSteps()

```ts
protected defineSteps(): Step[];
```

Constructs the step registry. Steps are keyed by `Step.id`, which defaults to the class name,
so the returned array is a registry rather than a graph — transitions live in the handlers.

```ts
protected defineSteps(): Step[] {
  return [
    new CollectCustomerStep(this).useMemory("customer"),
    new TerminateSessionStep(this).useMemory("end"),
  ];
}
```

Any step reachable by `go(...)`, `runStep(...)`, `runSteps(...)`, or a logic response must
appear here. Registering a *different set* of steps between turns can strand a restored
session whose `flow.currentStep` no longer resolves.

### initialStep()

```ts
protected initialStep(): StepClassType | null;
```

Returns the class whose `id` becomes `flow.currentStep` for a new session. Returning `null`
selects the first entry of `defineSteps()`. A returned class that is not registered fails
during document creation with `Initial step '<name>' is not defined in flow '<id>'.`

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

### defineTool()

```ts
public defineTool(): ToolType[];
```

Flow-level tool definitions. They are merged with every step's `defineTool()` into one
flow-wide registry during `bootstrap()`. Duplicate names throw
`Duplicate tool '<name>' registered in flow '<id>'.` See [Defining and handling tools](/docs/guides/tools/).

### onRestoreSessionDoc()

```ts
protected async onRestoreSessionDoc(
  sessionDoc: SessionType,
): Promise<SessionType | null>;
```

The compatibility boundary for a stored session. Return the (optionally mutated) document to
continue restoring it; return `null` to abandon it and create a fresh session document.

The default implementation is:

```ts
if (!this.isSessionCurrent(sessionDoc)) return null;
return sessionDoc;
```

`isSessionCurrent(doc)` compares `doc.version` against `K.sessionDocVersion`.
`sessionIdleMs(doc)` returns the time since `saveOn`, allowing an override to
enforce its own idle policy. Both are `protected` and overridable.

When the hook returns a document, `bootstrap()` saves it immediately through the normal
compare-and-swap path before reading step state. The hook runs only for a document that
already exists, is not `completed` or `aborted`, belongs to this flow, and satisfies the
one-flow invariant. See [Session document migration](/docs/guides/migration/).

### spawnSteps()

```ts
protected async spawnSteps(): Promise<string>;
```

Called by `run()` instead of the current step when `getContext<boolean>('config._concurrent')`
is truthy. Pair it with `concurrentSteps(...)`:

```ts
public async concurrentSteps<T>(options: {
  items: T[];
  batchSize: number;
  onConfig: (item: T) => object;
  onBotResponse: (item: T, response: any) => void;
}): Promise<void>;
```

`concurrentSteps()` slices `items` into sequential batches, runs each batch with
`Promise.all`, and issues one `SelfClient` POST per item to `SELF_URL` carrying
`{ flowName, config }`. Each item therefore gets its own session document. Returning a string
from `spawnSteps()` does not complete the coordinator session; call `markCompleted()` or
`sessionCompleted()` explicitly. See [Concurrent batch mode](/docs/guides/concurrent-steps/).

### run()

```ts
public async run(message: string): Promise<RunResponseType>;
```

```ts
type RunResponseType = {
  success: boolean;
  completed: boolean;
  message: string;
  session: string;
  contentType: HttpContentType;
};
```

`completed` is `requireCurrentStep().isEnd()` and `contentType` is that same step's
`contentType`. Overriding `run()` takes over cursor selection, completion reporting, and
content conversion; prefer step hooks.

### isBatch()

```ts
public isBatch(): boolean;
```

When `true`, `FlowEngine` saves the session once before calling `run()`. It does **not** select
the `spawnSteps()` path — that is decided by `config._concurrent`.

## Flow-owned data and helpers

### Cursor movement

| Method | Signature | Notes |
| --- | --- | --- |
| `goto` | `goto(stepClass: StepClassType): Promise<Step>` | Moves the one durable cursor. Calls `onExit()` on the old step and `onEnter()` on the new one, and appends a sequence entry |
| `gotoByName` | `gotoByName(stepName: string): Promise<Step>` | The string form used by `go("StepName")` |

Both throw if called from inside a nested execution frame:
`Cannot goto '<name>' from a child execution frame.` A child returns a result to its owner
instead. Moving to the step that is already current is a no-op.

### Context

| Method | Signature |
| --- | --- |
| `getContext` | `getContext<T>(key: string): T` |
| `addContext` | `addContext(json: object): void` |
| `setContext` | `setContext(context: object): void` |

Context is seeded from the first request's `config`, stored as `{ config: ... }`, and
persisted in `flow.context`. `getContext` is a lodash path read, so `getContext<string>('config.tenantId')`
works. A restored session keeps its stored context; a new `config` on a later turn does not
replace it.

### Step state

| Method | Signature |
| --- | --- |
| `getStepState` | `getStepState<T = JsonObject>(stepClass: StepClassType, key?: string): T` |
| `saveStepState` | `saveStepState(stepClass: StepClassType, json: JsonObject, stateType?: SaveStateType): void` |
| `saveTransientStepState` | `saveTransientStepState(stepClass: StepClassType, json: JsonObject): void` |

`SaveStateType` is an enum with `transient` and `persistent`; `persistent` is the default.
Transient state is stored under the `_transient` key and stripped on write. All three throw
if the class is not registered.

### Memory

```ts
public getMemory(): Memory;
public getMemory(nameSpace: string): MessageTypes[];
```

The no-argument form returns the flow's `Memory` container, which is where summary policy is
configured:

```ts
this.getMemory()
  .setSummaryModel({ provider: "openai", name: "gpt-4o" })
  .setSummaryConfig({ minMessages: 16, recentMessages: 8 })
  .enableSummary("conversation");
```

The string form returns the raw message array for one namespace. Namespaces must match
`/^[A-Za-z][A-Za-z0-9_-]{0,127}$/`. Compaction runs inside `saveSession()`; a failure is
recorded as a session warning rather than failing the turn.

### Session access and completion

| Method | Signature | Purpose |
| --- | --- | --- |
| `getSessionDoc` | `getSessionDoc(): SessionType` | The whole document. Throws before bootstrap |
| `getSessionId` | `getSessionId(): string` | The session ID |
| `markCompleted` | `markCompleted(): void` | Sets `runStatus` to `completed` |
| `getFlowEngine` | `getFlowEngine(): FlowEngine` | Throws until `bootstrap()` has bound the engine |
| `id` | `static get id(): string` / `protected get id(): string` | The registered name; defaults to the class name |

Overriding `static get id()` decouples the public flow name from a TypeScript class rename.
The registered name must equal `FlowClass.id` — see [FlowEngine](/docs/reference/flow-engine/).

### Step and tool lookup

| Method | Signature | Throws when missing |
| --- | --- | --- |
| `getCurrentStep` | `getCurrentStep(): Step \| null` | No |
| `requireCurrentStep` | `requireCurrentStep(): Step` | Yes |
| `getExecutingStep` | `getExecutingStep(): Step \| null` | No |
| `requireExecutingStep` | `requireExecutingStep(): Step` | Yes |
| `getStep` | `getStep(stepName: string): Step \| undefined` | No |
| `requireStep` | `requireStep(stepName: string): Step` | Yes |
| `getTool` | `getTool(name: string): DynamicStructuredTool \| undefined` | No |
| `requireTool` | `requireTool(name: string): DynamicStructuredTool` | Yes |

`getCurrentStep()` reads the durable cursor. `getExecutingStep()` returns the innermost step
of the current nested execution frame, falling back to the durable cursor when no frame is
open — that is the accessor the runner uses.

<div class="callout callout--note"><span class="callout__title">Current-step accessors</span><p>Use <code>getCurrentStep()</code> or <code>requireCurrentStep()</code> for the durable cursor. Inside nested execution, use <code>getExecutingStep()</code> or <code>requireExecutingStep()</code> when you need the step owning the current async frame.</p></div>

## Runtime plumbing

These are public because the runtime uses the same class. Application flows should not call
or override them: `bootstrap`, `collectSteps`, `saveSession`, `tallyToken`, `setMemory`,
`withNestedSequence`, and `enterChild`.

## The rest of the reference

<div class="cards">
	<a class="card" href="/docs/reference/step/">
		<span class="card__title">Step</span>
		<span class="card__body">Every override hook, state helper, memory helper, and the plumbing you should leave alone.</span>
	</a>
	<a class="card" href="/docs/reference/response-builders/">
		<span class="card__title">go() / stay() / direct()</span>
		<span class="card__body">Transition construction and the ToolResponseBuilder methods.</span>
	</a>
	<a class="card" href="/docs/reference/decorators/">
		<span class="card__title">@Tool and @Tools</span>
		<span class="card__body">Exposure, dispatch, precedence, and the no-fallback rule.</span>
	</a>
	<a class="card" href="/docs/reference/flow-engine/">
		<span class="card__title">FlowEngine</span>
		<span class="card__body">Creation, registration, run, session locking, and deletion.</span>
	</a>
	<a class="card" href="/docs/reference/model-catalog/">
		<span class="card__title">Model catalog</span>
		<span class="card__body">The checked-in model IDs and their exact parameter types.</span>
	</a>
	<a class="card" href="/docs/reference/session-document/">
		<span class="card__title">Session document schema</span>
		<span class="card__body">The envelope, the single flow object, and the sequence format.</span>
	</a>
	<a class="card" href="/docs/reference/http-api/">
		<span class="card__title">HTTP API</span>
		<span class="card__body">The demo controller's run, flows, and end endpoints.</span>
	</a>
	<a class="card" href="/docs/reference/environment-variables/">
		<span class="card__title">Environment variables</span>
		<span class="card__body">Every variable the code actually reads, and the ones only the sample file mentions.</span>
	</a>
</div>
