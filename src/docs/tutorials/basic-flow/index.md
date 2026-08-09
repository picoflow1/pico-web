---
title: Track overview
eyebrow: BasicFlow tutorial
lede: BasicFlow registers fourteen steps and uses them to demonstrate every major part of the PicoFlow Step contract. This page maps the whole graph before the lessons take it apart.
source: picoflow-demo/src/myflow/basic-flow/basic-flow.ts
---

`BasicFlow` collects a small user profile across many turns: weather for two cities,
three favourites, a full name, a date of birth, and a mailing address. The domain is
deliberately thin. What matters is that each stage was written to isolate one
framework mechanism, so a lesson can quote one file and explain one idea.

The implementation lives in `picoflow-demo/src/myflow/basic-flow/`. Its deterministic
conversation scenario lives in `picoflow-demo/test/basic-flow/`.

## What BasicFlow is

A `Flow` subclass with three overrides that matter and two that are situational:

- `configModel()` declares the default model, `openai` / `gpt-4o-mini` with
  `temperature: 0.2`.
- `defineSteps()` returns the fourteen `Step` instances the flow is allowed to
  activate, each with its memory namespace and optional model override.
- `initialStep()` picks the entry point at runtime: `PresidentStep` when
  `config.isPresident` is true, otherwise `WeatherStep`.
- `spawnSteps()` implements batch mode, reached when `config._concurrent` is set.
- `onRestoreSessionDoc()` is overridden but currently delegates to `super`.

## The step graph

The normal profile path, exactly as the code routes it:

```text
                     initialStep()
                config.isPresident === true ?
                   /                      \
                 yes                       no
                  |                         |
           PresidentStep                WeatherStep
        (sessionCompleted)             |    ^      |
                                       |    |      | terminate_session
                            both cities|    |stay  |
                                       v    |      v
                                  FooLogicStep   TerminateSessionStep
                                       |
                       go().withState({fooData})
                                       v
                                  GooLogicStep
                                       |
                       go().withState({gooData})
                                       v
                                 FavoritesStep
                                       |
                        onResponse() parses JSON
                                       v
                                   NameStep -----------------+
                                       |                     |
                                       |  runStep(InContextStep)
                                       |                     |
                                       |            InContextStep
                                       |          (onEnter: runSteps)
                                       |            /            \
                                       |     ConcurStep1     ConcurStep2
                                       |          |               |
                                       |     runSteps([          onEnter:
                                       |      ConcurStep3])   runSteps([ConcurStep4])
                                       |          |               |
                                       |     ConcurStep3     ConcurStep4
                                       |                     |
                                       | <-------------------+
                                       v
                                    DOBStep
                                       |
                                       v
                                  AddressStep
                                       |
                     go().withPrompt(FromAddressEnd)
                          .withState({ fromAddress: 5 })
                                       v
                             TerminateSessionStep
```

Three things about that diagram are worth stating explicitly, because they are the
source of most confusion:

1. `WeatherStep`, `NameStep`, `DOBStep`, and `AddressStep` each define a
   `terminate_session` tool, so any of them can jump straight to
   `TerminateSessionStep`. Those edges are omitted above to keep the spine readable.
2. The `InContextStep` subtree is **not** part of the durable path. It runs inside
   `NameStep`'s tool handler through `runStep()`, and it never becomes
   `flow.currentStep`. After it returns, `NameStep` still owns the transition and
   goes to `DOBStep`.
3. `FooLogicStep` and `GooLogicStep` make no model call at all. They are traversed
   within the same HTTP request that produced the second city temperature.

## Every registered step

`defineSteps()` returns these fourteen instances, in this order. The first entry is
only the default cursor; `initialStep()` overrides it here.

| Step | File | Memory | Model | What it demonstrates |
| --- | --- | --- | --- | --- |
| `WeatherStep` | `weather-step.ts` | class default | `openai` / `gpt-5`, `reasoning.effort: "low"` | An MCP-backed tool, incremental `saveState`, `stay()` as a corrective loop, and a `@Tools(["get_weather"])` batch handler |
| `NameStep` | `name-step.ts` | `default` | flow default | Zod tool schema, rejecting input in code, transient state, and nested `runStep()` |
| `AddressStep` | `address-step.ts` | `default` | flow default | Validation delegated to a plain TS module, and `go().withPrompt().withState()` |
| `DOBStep` | `dob-step.ts` | `default` | `openai` / `gpt-5.1`, `reasoning.effort: "low"` | Reading another step's state into a prompt template |
| `FooLogicStep` | `foo-logic.ts` | `default` | n/a | `LogicStep.runLogic()` with zero model calls |
| `GooLogicStep` | `goo-logic.ts` | `default` | n/a | A second logic hop, showing `withState` landing on the destination |
| `InContextStep` | `incontext-step.ts` | `separate` | flow default | `structOutputSchema()` and `runSteps()` fan-out from `onEnter()` |
| `ConcurStep1` | `concur-step1.ts` | class default | flow default | Nesting from `onResponse()` |
| `ConcurStep2` | `concur-step2.ts` | class default | flow default | Nesting from `onEnter()` |
| `ConcurStep3` | `concur-step3.ts` | class default | flow default | The minimum viable step: prompt plus `onResponse` |
| `ConcurStep4` | `concur-step4.ts` | class default | flow default | The same, reached from a different parent hook |
| `PresidentStep` | `president-step.ts` | `president` | flow default | An alternate entry point driven by `config`, and `sessionCompleted()` |
| `FavoritesStep` | `favorites-step.ts` | `favorite` | flow default | Prompt files, `onCrossing()`, and routing from `onResponse()` without tools |
| `TerminateSessionStep` | framework | `temp` | flow default | The built-in terminal step |

<div class="callout callout--note"><span class="callout__title">Note</span><p>&ldquo;Class default&rdquo; means the step never called <code>.useMemory(...)</code>, so its memory namespace is its own class name and its conversation history is isolated from every other step.</p></div>

## The eighteen lessons

Read them in order. Lessons 1 to 8 are the fundamentals; 9 to 14 are composition;
15 to 18 are operations.

1. [Bootstrapping PicoFlow in NestJS](/docs/tutorials/basic-flow/bootstrapping/) — the
   `FlowEngine` provider, model adapters, and the `/ai/run` controller.
2. [Your first flow](/docs/tutorials/basic-flow/first-flow/) — `configModel()` and
   `defineSteps()`, and why a flow is a registry.
3. [Your first step](/docs/tutorials/basic-flow/first-step/) — the smallest step that
   works: `getPrompt()` plus `onResponse()`.
4. [Tools and Zod](/docs/tutorials/basic-flow/tools/) — `defineTool()`, the `@Tool`
   decorator, and why the handler owns the decision.
5. [Routing with go() and stay()](/docs/tutorials/basic-flow/routing/) — the corrective
   loop and the response builders.
6. [Validation belongs in code](/docs/tutorials/basic-flow/validation/) — moving rules out
   of prompt prose into plain TypeScript.
7. [Prompt files and templates](/docs/tutorials/basic-flow/prompts/) — `Prompt.file()`,
   `Prompt.replace()`, and a shared role file.
8. [Reading another step's state](/docs/tutorials/basic-flow/cross-step-state/) —
   `flow.getStepState()` and who owns which data.
9. [Deterministic LogicStep](/docs/tutorials/basic-flow/logic-steps/) — a stage with no
   LLM call at all.
10. [Response-driven steps](/docs/tutorials/basic-flow/response-driven-steps/) — routing
    from `onResponse()` when there are no tools.
11. [Structured output](/docs/tutorials/basic-flow/structured-output/) — constraining the
    model with a Zod schema.
12. [Nested execution: runStep()](/docs/tutorials/basic-flow/nested-runstep/) — calling a
    child step inline and using its return value.
13. [Parallel children: runSteps()](/docs/tutorials/basic-flow/parallel-runsteps/) —
    fan-out, and the independence rules that make it safe.
14. [Transient state and context](/docs/tutorials/basic-flow/transient-state/) — the four
    kinds of data and what survives persistence.
15. [Memory namespaces and model overrides](/docs/tutorials/basic-flow/memory-and-models/)
    — sharing or isolating history, and per-step models.
16. [MCP tools and @Tools batching](/docs/tutorials/basic-flow/mcp-and-multi-tool/) — an
    MCP server behind a handler, and group tool dispatch.
17. [Sessions, migration, batch mode](/docs/tutorials/basic-flow/sessions-and-batch/) —
    conditional entry, restore policy, and `concurrentSteps()`.
18. [Testing a flow end to end](/docs/tutorials/basic-flow/testing/) — scenario-driven
    assertions on message content and persisted state.

## Next

Begin with [1. Bootstrapping PicoFlow in NestJS](/docs/tutorials/basic-flow/bootstrapping/).
