---
title: Authoring a step
eyebrow: Guides
lede: A step owns one stage of a workflow. This is the minimum you must write, the hooks available when the minimum is not enough, and the review checklist before you ship one.
source: pico-demo/docs/step-authoring-contract.md
---

Reach for this page when adding a stage to an existing flow, or when a step has grown hooks
you are not sure it needs. A conventional conversational step needs three members. Everything
else on `Step` is opt-in, and most of it should stay unused.

## The short version

```ts
export class CollectNameStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    return "Ask for a full name, then call capture_name.";
  }

  public defineTool(): ToolType[] {
    return [
      {
        name: "capture_name",
        description: "Validate and save a full name",
        schema: z.object({ name: z.string().min(1) }),
      },
    ];
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

That is prompt, contract, and decision — colocated. Register it in the flow:

```ts
protected defineSteps(): Step[] {
  return [
    new CollectNameStep(this).useMemory("customer"),
    new TerminateSessionStep(this).useMemory("end"),
  ];
}
```

<div class="callout callout--note"><span class="callout__title">The constructor takes only the flow</span><p>The signature is <code>protected constructor(flow: Flow)</code>; write <code>new CollectNameStep(this)</code>. The initial step is the first entry in <code>defineSteps()</code>, or the class returned by <code>initialStep()</code>.</p></div>

## The durable cursor

A step does not have an "active" flag. The flow envelope holds exactly one cursor:

```ts
flow: {
  name: "CustomerFlow",
  currentStep: "CollectNameStep",   // null only when the flow has no next turn
  steps: [{ name: "CollectNameStep", state: {}, model: undefined }],
  memory: { customer: { messages: [] } },
  context: {},
  sequence: [{ level: 1, stepName: "CollectNameStep" }],
}
```

`Flow.goto()` — reached through `go(...)` in a handler, or by returning a `Step` class from
`onResponse()` / `runLogic()` — is the only thing that moves it. `runStep()` and `runSteps()`
push in-memory execution frames instead; their children may save state but cannot move the
cursor.

This is why `flow.getCurrentStep()` and `flow.getExecutingStep()` are different methods.
Inside a nested child they return different objects.

## Lifecycle: which hook fires when

| Scenario | Hooks, in order |
| --- | --- |
| New session | `onStart()` → which calls `onEnter()` then `onCrossing(null)` |
| Restored session | `onRestore()` only |
| Top-level transition into this step | `onEnter()` → `onCrossing(message, priorStep)` |
| Top-level transition out of this step | `onExit()` |
| Nested child via `runStep` / `runSteps` | `onEnter()` → run → `onExit()` in a `finally` |

`onStart()` is never called for a restored session. `onRestore()` is never called for a new
one. A `direct(...)` response activates the destination and runs its `onEnter()`, but ends
the HTTP turn without a further model call, so that step's `onCrossing()` may not run.

Nested execution calls the child directly and does not behave like a cross-step transition.
Pass an explicit `userMessage`, or set the child up in its `onEnter()`. Do not assume its
`onCrossing()` will synthesise a starting message.

## The override hooks

| Hook | Default | Override when |
| --- | --- | --- |
| `getPrompt()` | Returns `_prompt` state if a transition attached one, otherwise `null` | The step needs a system prompt built from state, context or prompt files |
| `defineTool()` | `[]` | The step contributes tool definitions to the flow-wide registry |
| `useTool()` | `[]`; decorated handlers are added automatically | The step uses a tool defined by another step or by the flow, with no `@Tool` handler |
| `@Tool` handler | none | A tool must validate input, do work, save state, and return a transition |
| `onEnter()` | no-op | Setup on every activation — clearing memory, running prerequisite children |
| `onExit()` | no-op | Release something acquired in `onEnter()` |
| `onRestore()` | no-op | Rebuild runtime-only caches without repeating entry work |
| `onStart()` | `onEnter()` then `onCrossing(null)` | The initial step needs custom bootstrap |
| `onCrossing(message, priorStep?)` | Synthesises `HumanMessageEx("Start")` when there is no incoming message | The stage must transform, replace or forward the incoming message |
| `run(userMessage?)` | Wraps a non-empty string as `HumanMessageEx` and starts the model runner | Pre-model preparation is needed; call `super.run(message)` |
| `checkResponse(result)` | `false` | A bad response should be retried. **`true` means retry** |
| `onResponse(result)` | Stringifies objects, otherwise returns the result | Free-form or structured output needs validation, rewriting, or routing |
| `structOutputSchema()` | `null` | The provider should constrain output to a schema |
| `isEnd()` | Reads `runStatus === "completed"` | Rarely; prefer `TerminateSessionStep` or `sessionCompleted()` |

Two hooks are commonly misused. `onEnter()` runs on nested activation too, so anything
expensive there runs once per `runStep()` call. And `checkResponse()` may run several times
inside the retry loop, so it must be deterministic and free of side effects.

`isLogic()` should only be changed by extending `LogicStep`, which also requires
`runLogic(): Promise<LogicResponseType>`.

## Complete step skeleton

Every normal hook, with the real signatures. A real step implements a fraction of these.

```ts
export class CustomStep extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  protected async onEnter(): Promise<void> {}
  protected async onExit(): Promise<void> {}
  public async onRestore(): Promise<void> {}

  public async onStart(): Promise<MessageTypes | null> {
    return await super.onStart();
  }

  public onCrossing(
    message: MessageTypes | null | undefined,
    priorStep?: string,
  ): MessageTypes | null {
    return super.onCrossing(message, priorStep);
  }

  public getPrompt(): string | null {
    return super.getPrompt() ?? "Custom system prompt";
  }

  public defineTool(): ToolType[] {
    return [];
  }

  public useTool(): string[] {
    return [];
  }

  @Tool("tool_name")
  protected async handleTool(
    args: Record<string, any>,
  ): Promise<ToolResponseType> {
    return stay();
  }

  public async run(message?: string): Promise<MessageContent | null> {
    // Prepare state here, then keep the standard model lifecycle.
    return await super.run(message);
  }

  public checkResponse(result: string | object): boolean {
    return false; // true means retry
  }

  public async onResponse(
    result: string | object,
  ): Promise<LastResponseType> {
    return await super.onResponse(result);
  }

  public structOutputSchema(): object | null {
    return null;
  }
}
```

## State, memory and content type

| Concern | API | Lifetime |
| --- | --- | --- |
| Durable step state | `saveState(json)`, `getState<T>(key?)`, `removeState(key)` | Persisted in the session document |
| Transient step state | `saveTransientState(json)`, `getTransientState<T>(key?)` | Dropped from the persisted document |
| Another step's state | `flow.getStepState(Cls, key?)`, `flow.saveStepState(Cls, json)` | Persisted, owned by that step |
| Flow context | `getContext<T>("config.x")` | Persisted; set from the first request's `config` |
| Conversation history | `useMemory(ns)`, `getMemory()`, `getLastMessage()`, `eraseMemory()` | Persisted per namespace |
| HTTP content type | `this.contentType`, or `.withContentType(...)` on a transition | Per response |

`saveState()` replaces the top-level key it is given rather than deep-merging it, and stamps
`_saveOn`. Erasing memory does not erase state.

Memory namespace names become persisted object keys, so they must match
`/^[A-Za-z][A-Za-z0-9_-]{0,127}$/`. `useMemory("hotel explore")` throws.

## Review checklist

1. Is exactly one responsibility expressed in `getPrompt()`?
2. Are tool names unique across the whole flow, and arguments validated by Zod?
3. Does every `@Tool` handler make the domain decision in code and return an explicit
   transition, rather than relying on prompt instructions?
4. Is `stay()` used only inside a tool handler? It resolves the executing step and throws
   elsewhere.
5. Does destination state travel with `.withState(...)`, and durable state stay on its owner?
6. Do `onStart`, `onRestore`, `onEnter`, `onExit` and `onCrossing` avoid duplicating work?
7. If `run()` is overridden, does it call `super.run(message)`?
8. Are shared memory namespaces deliberate — especially for parallel children?
9. Is completion explicit, through `TerminateSessionStep` or `sessionCompleted()`?
10. Do tests cover invalid input, retries, transitions, restore, nested work, direct
    responses, content type and persisted state?

Next: [Defining and handling tools](/docs/guides/tools/) and
[Prompts and prompt files](/docs/guides/prompts/). Lesson form:
[Your first step](/docs/tutorials/basic-flow/first-step/). Normative listing:
[Step reference](/docs/reference/step/).
