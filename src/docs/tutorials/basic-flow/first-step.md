---
title: 3. Your first step
eyebrow: BasicFlow tutorial
lede: A working step needs two methods. Everything else in the Step contract is opt-in, and BasicFlow contains two steps that prove it.
source: pico-demo/src/myflow/basic-flow/concur-step3.ts, pico-demo/src/myflow/basic-flow/concur-step4.ts
---

`Step` exposes a large surface — entry and exit hooks, restore, crossing, tool
dispatch, structured output, nested execution. Almost all of it has a working default.
The smallest useful step overrides exactly two methods, and BasicFlow ships two of
them so you can see the floor before the ceiling.

## What you will build

- A step that supplies a system prompt with `getPrompt()`.
- A step that consumes the model's reply with `onResponse()`.
- Durable state written with `saveState()`.
- An understanding of what `LastResponseType` lets you return.

## The whole step

`pico-demo/src/myflow/basic-flow/concur-step3.ts`, in full apart from the licence
header and imports:

```ts
export class ConcurStep3 extends Step {
  constructor(flow: Flow) {
    super(flow);
  }

  public getPrompt(): string {
    return `
    You are ConcurStep3.
    Reply with one short sentence confirming the ConcurStep 3  follow-up task is complete.
    `;
  }

  public async onResponse(
    llmResult: string | object,
  ): Promise<LastResponseType> {
    this.saveState({ concurStep3: llmResult as JsonValue });
    return llmResult as string;
  }
}
```

`ConcurStep4` is the same class with a different number. That is the point: it is the
floor, and there is nothing else to add.

### The constructor

```ts
constructor(flow: Flow) {
  super(flow);
}
```

`Step` declares `protected constructor(flow: Flow)`. Because it is protected, a
subclass must redeclare a public constructor before `new ConcurStep3(this)` will
compile in `defineSteps()`. This two-line constructor is boilerplate you will write in
every step, and it takes exactly one argument.

The base constructor also sets `this.memorySpace = this.id`, which is why a step that
never calls `.useMemory(...)` gets a namespace named after its own class.

### getPrompt()

`getPrompt()` returns the system message. It is called before **every** model
invocation for this step, including the repeat calls inside a tool loop. That makes it
the right place to assemble a prompt from current state — it will always reflect the
latest values — and the wrong place to do anything expensive or side-effecting.

The base implementation is not a no-op:

```ts
public getPrompt(): string | null {
  const p = this.getState("_prompt");
  return p ? p.toString() : null;
}
```

It returns whatever a previous transition attached with `.withPrompt(...)`, stored as
`_prompt` in this step's state. `ConcurStep3` overrides it unconditionally, so it
ignores any transition-supplied prompt. When you want to honour both, chain them:

```ts
public getPrompt(): string {
  return super.getPrompt() ?? "The normal prompt for this step.";
}
```

`TerminateSessionStep` does precisely that, which is how
`go(TerminateSessionStep).withPrompt(DemoPrompt.AbruptEnd)` changes the closing
message.

### onResponse()

`onResponse(llmResult)` runs when the model replies **without** calling a tool. The
base implementation stringifies objects and passes strings through:

```ts
public async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  if (typeof llmResult === "object") {
    return JSON.stringify(llmResult);
  }
  return llmResult;
}
```

`ConcurStep3` overrides it to persist the reply before returning it. `saveState`
merges a JSON object into this step's durable state and stamps `_saveOn`. The value is
written to the session document at the end of the request.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p><code>saveState</code> replaces the top-level key it is given rather than deep-merging into it. Call it once per logical value, as these steps do, instead of trying to patch a nested object in place.</p></div>

## What onResponse may return

The return type is `LastResponseType`, which is a union:

```ts
export type LastResponseType =
  | {
      step: StepTarget;
      message?: MessageTypes;
      prompt?: string;
      state?: JsonObject;
      contentType?: HttpContentType;
    }
  | StepTarget;              // a Step constructor, or a step-name string
```

The runner branches on what it gets:

| You return | The runner does |
| --- | --- |
| a `string` | Appends it to memory as an AI message and returns it to the caller |
| a `Step` constructor | Calls `flow.goto(...)` and runs the new step in the same request |
| a `go(Step)...` builder object | Transitions, applies `prompt`/`state`/`contentType`/`message`, then runs |

`ConcurStep3` takes the first branch. [Lesson 10](/docs/tutorials/basic-flow/response-driven-steps/)
takes the third.

## How it works

For a step with no tools, one turn is short:

```text
Step.run(userMessage)
  -> HumanMessageEx pushed into this step's memory namespace
  -> getPrompt()
  -> obtainTools()          // [] here
  -> structOutputSchema()   // null here
  -> model call
  -> no tool calls in the reply
  -> onResponse(text)
  -> handleLastResponse(...)  // string branch: push AI message, return text
```

Note what does *not* happen: nothing routes, nothing transitions,
`flow.currentStep` is untouched. A step that only implements `getPrompt` and
`onResponse` is a terminal leaf unless something else moves the cursor.

## Why it is written this way

The split between `getPrompt()` and `onResponse()` is the whole reason a step is a
class rather than a function. `getPrompt()` is re-entrant and may run several times per
turn; `onResponse()` runs at most once, at the end. Keeping them as separate methods
makes that asymmetry visible instead of hiding it behind one callback with a mode flag.

Returning a value from `onResponse()` rather than mutating a context object means the
routing decision and the validation that produced it sit in the same function, and the
type system can check the result.

<div class="callout callout--info"><span class="callout__title">Where these two steps actually run</span><p>ConcurStep3 and ConcurStep4 are registered in BasicFlow but are never a <code>go()</code> target. They run as nested children from <code>ConcurStep1.onEnter()</code> and <code>ConcurStep2.onEnter()</code>, respectively. ConcurStep1 then makes its completion tool call and returns <code>directResult(...)</code>. Lesson 13 covers the ordering.</p></div>

## Common mistakes

- **Overriding `getPrompt()` without calling `super.getPrompt()`.** Any prompt attached
  by an inbound `.withPrompt(...)` is silently discarded. That is fine when it is
  intentional, as here, and a bug when it is not.
- **Doing work in `getPrompt()`.** It runs again after every tool response. A database
  call there executes several times per turn.
- **Returning a bare step-name string from `onResponse()` expecting a transition.**
  The runner's string branch treats a string as message text, not as a target. Return
  the constructor, or `go(Step)`, to transition.
- **Assuming instance fields persist.** Steps are reconstructed on every request. Only
  what `saveState()` wrote comes back.

## Next

[4. Tools and Zod](/docs/tutorials/basic-flow/tools/) adds the mechanism that lets a step do
something other than talk.
