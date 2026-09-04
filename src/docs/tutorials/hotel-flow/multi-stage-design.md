---
title: 2. Designing a multi-turn conversation
eyebrow: HotelFlow tutorial
lede: A booking journey has natural seams. Each seam becomes a step, each step owns its data, and the flow class is nothing more than the registry that lists them.
source: pico-demo/src/myflow/hotel-flow/hotel-flow.ts
---

Before any prompt is written, the design question for a multi-turn conversation is
where the seams are. A seam is a point where the assistant's job changes:
different instructions, different tools, different data in scope. HotelFlow has
three of them, and each becomes a `Step`.

## The goal

- Split one user journey into steps along the points where the job changes.
- Understand that `defineSteps()` is a registry, not a sequence.
- Know why `ExploreStep` starts the session without any `initialStep()` call.
- Decide which step owns which piece of business state.

## The journey, and where it breaks

A user booking a hotel does four distinguishable things:

```text
1. Answers questions until the search criteria are complete   -> ExploreStep
2. Looks at a priced result list and picks a next action      -> PresentStep
3. Asks for feature-by-feature comparisons, repeatedly        -> CompareStep
4. Books, and the conversation ends                           -> TerminateSessionStep
```

Stage 1 needs a long task-list prompt and a tool that runs a catalogue search.
Stage 2 needs nothing but the result list and three branch tools. Stage 3 needs
the full hotel records and a table renderer. Those are three different prompts,
three different tool sets, and three different pieces of state. Trying to serve
all three from one step means one prompt that has to describe all three modes
and hope the model picks the right one.

## The whole flow class

This is the complete file, `pico-demo/src/myflow/hotel-flow/hotel-flow.ts`:

```ts
export class HotelFlow extends Flow {
  public constructor() {
    super();

    //configure memory compaction, if no configuration is provided, the default is
    // to summarize after 16 messages, keeping the most recent 8 messages in memory
    this.getMemory()
      .setSummaryModel({
        provider: 'openai',
        name: 'gpt-4o',
        retryAttempts: 3,
      })
      .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
      .enableSummary('hotel-explore');
  }

  protected configModel() {
    return {
      provider: 'openai',
      name: 'gpt-4o',
      retryAttempts: 3,
    } as const;
  }

  protected defineSteps(): Step[] {
    return [
      new ExploreStep(this)
        .useMemory('hotel-explore')
        .useModel({
          provider: 'openai',
          name: 'gpt-5.1',
          params: { reasoning: { effort: 'low' }},
        }),
      new PresentStep(this).useModel({
        provider: 'openai',
        name: 'gpt-4o',
        params: { temperature: 0.5 },
      }),
      new CompareStep(this).useModel({
        provider: 'openai',
        name: 'gpt-5.1',
        params: { reasoning: { effort: 'low' }},
      }),
      new TerminateSessionStep(this).useMemory('end'),
    ];
  }
}
```

Sixty lines, including the comment. Everything else in the track is a step, a
prompt, or a plain TypeScript module.

## Steps are constructed with the flow, and nothing else

`Step`'s constructor is protected and takes exactly one argument:

```ts
protected constructor(flow: Flow) {
  this.flow = flow;
  this.memorySpace = this.id;
}
```

So every registration is `new SomeStep(this)`, optionally followed by the
chainable configurators `.useMemory(ns)` and `.useModel({...})`, both of which
return `this`. The constructor also sets the default memory namespace to the
step's class name, which is why `PresentStep` and `CompareStep` get isolated
histories without asking for them.

<div class="callout callout--note"><span class="callout__title">Entry-point selection</span><p><code>Step</code> takes only the flow. Registration order supplies the default entry point; override <code>initialStep()</code> when the choice depends on runtime context.</p></div>

## Registration order picks the entry point

`Flow.initialStep()` exists, but its base implementation returns `null`:

```ts
/**
 * Override only when the initial cursor depends on runtime context. Without
 * an override, the first step returned from defineSteps() starts the session.
 */
protected initialStep(): StepClassType | null {
  return null;
}
```

When the session document is created, the flow resolves the cursor like this:

```ts
const configuredInitialStep = this.initialStep();
const firstStep = this.stepMap.values().next().value as Step | undefined;
const currentStep =
  configuredInitialStep?.id ?? firstStep?.getName() ?? null;
```

`HotelFlow` does not override `initialStep()`, so `ExploreStep` starts the
session purely because it is first in the array. Move it below `PresentStep`
and the flow would open on a result list it has never populated.

Override `initialStep()` only when the entry point depends on runtime context —
BasicFlow does that to branch on `config.isPresident`. If the entry point is
static, ordering the array is clearer than an override that always returns the
same class.

## Registration is also permission

`go(...)` resolves its target through `flow.requireStep(name)`. A step that is
not in `defineSteps()` cannot be reached:

```text
Step 'CompareStep' is not defined in flow 'HotelFlow'.
```

That error is thrown mid-turn, after the model has already committed to a tool
call. `TerminateSessionStep` is a framework class, but it still has to be
registered by hand, which is why the last line of `defineSteps()` exists.

## Who owns what

Each step owns the state it writes with `this.saveState(...)`, and the durable
session document keeps those state bags separate per step. HotelFlow's
ownership map:

| Data | Owner | Written by |
| --- | --- | --- |
| `json` — the accumulated criteria scaffold | `ExploreStep` | `capture_choices` handler |
| `hotelFound` — name, daily prices, total | `PresentStep` | `go(PresentStep).withState({ hotelFound })` |
| `available_hotel` — the names on the result list | `CompareStep` | `go(CompareStep).withState({ available_hotel })` |
| `compare_hotel` — the names the user picked | `CompareStep` | `flow.saveStepState(CompareStep, ...)` |
| `chosen_hotels` — the enriched comparison rows | `CompareStep` | `generate_comparison` handler |
| `hotel` — the booked hotel name | `PresentStep` | `chosen_hotel` handler |

Notice that `hotelFound` is written by `ExploreStep`'s handler but lands on
`PresentStep`. `.withState(...)` always writes to the **destination** step, not
the one returning the builder. `PresentStep.getPrompt()` then reads it back
with a plain `this.getState("hotelFound")`, with no knowledge of who supplied
it.

## Why it is written this way

The flow class holds only policy that is genuinely flow-wide: the default
model, the memory-compaction configuration, and the list of reachable stages.
Everything conversational lives on a step. That split has one practical
consequence worth stating: you can read any single step file top to bottom and
know every way that stage can end, because the transitions are return values
from its own handlers. There is no edge table elsewhere to cross-reference.

The four steps also map one-to-one onto the four things you would put in a
product spec. When the spec changes — say, comparison needs a fourth feature —
you know before opening an editor that the change is confined to `CompareStep`,
`compare.md`, and `GenChart`.

## Common mistakes

- **Hiding the entry point.** Keep the default entry step visible in registration
  order, or use `initialStep()` when runtime context selects it.
- **Forgetting to register a `go()` target.** The failure happens at runtime,
  mid-turn, not at compile time.
- **Overriding `initialStep()` to return a constant.** It works, but it hides
  the entry point from anyone reading `defineSteps()`.
- **Expecting `.withState()` to write to the current step.** It writes to the
  destination. Use `this.saveState(...)` for data the current step owns, as
  `capture_choices` does for `json`.
- **Splitting steps by turn rather than by job.** A step is not one question. It
  is one mode; `ExploreStep` asks eight questions before it transitions once.

## Next

[3. Big prompts as spec files](/docs/tutorials/hotel-flow/prompt-files/) opens
`explore.md` and shows how an eight-task specification and a mutable JSON
scaffold become one system prompt.
