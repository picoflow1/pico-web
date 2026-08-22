---
title: Track overview
eyebrow: HotelFlow tutorial
lede: HotelFlow is a four-step booking conversation that collects criteria, searches a local catalogue, compares results, and books a room. This page maps the whole graph before the lessons take it apart.
source: pico-demo/src/myflow/hotel-flow/hotel-flow.ts
---

`HotelFlow` is the transactional track. Where BasicFlow is a tour of the `Step`
contract, HotelFlow is one product journey — search, look, compare, go back,
book — expressed as four registered steps that move a single durable cursor
between them while keeping business state on the step that owns it.

The implementation lives in `pico-demo/src/myflow/hotel-flow/`. Its fourteen-turn
deterministic scenario lives in `pico-demo/test/hotel-flow/`. Browse the
[HotelFlow source on GitHub](https://github.com/picoflowio/pico-demo/tree/main/src/myflow/hotel-flow).

## What HotelFlow is

A `Flow` subclass with a constructor and two overrides:

- The **constructor** configures rolling memory compaction for one namespace.
- `configModel()` declares the flow default, `openai` / `gpt-4o`, with three
  runner attempts.
- `defineSteps()` returns four `Step` instances, each with its own memory
  namespace and model override.

There is no `initialStep()` override, so the first entry in `defineSteps()` —
`ExploreStep` — is the initial cursor.

The conversation itself is driven by two large prompt files that read like
specifications rather than instructions, plus a mutable JSON scaffold that the
model fills in over several turns and hands back through a single tool call.

## The step graph

Every edge below is a `go(...)` or `direct(...)` returned from a `@Tool` handler.

```text
                    ExploreStep is first in defineSteps()
                       and therefore the initial cursor
                                    |
                                    v
                            +----------------+
         capture_choices,   |                |
         no results found   |  ExploreStep   |
              stay(...) <---|                |<--------------------+
                            +----------------+                     |
                                    |                              |
                capture_choices, results found                     |
             go(PresentStep).withState({ hotelFound })             |
                                    |                    go(ExploreStep)
                                    v                  .withMessage(last)
                            +----------------+          (search_again)
                            |                |----------------------+
                            |  PresentStep   |
                    +------>|                |
                    |       +----------------+
                    |          |          |
      go(PresentStep)          |          | chosen_hotel
      (resume_booking)         |          | go(TerminateSessionStep)
                    |          |          |      .withPrompt(confirmation)
                    |  go_compare         |
                    |          |          v
                    |          |   +----------------------+
                    |          |   | TerminateSessionStep |
                    |          |   +----------------------+
                    |          v          ^
                    |  +----------------+ |
                    +--|  CompareStep   |-+ terminate_session
                       +----------------+
                             ^      |
                             |      | generate_comparison
                             +------+ direct(table) stays on CompareStep
```

Two edges are deliberately drawn as self-loops:

1. `capture_choices` returns `stay(...)` when the catalogue matches nothing.
   The turn is not lost; the corrective text goes back to the model, which asks
   the user to loosen a criterion.
2. `generate_comparison` returns `direct(table)`. `direct()` targets the
   currently executing step, so the cursor never moves and no second model call
   is made — the rendered Markdown table is the response.

Every step except `TerminateSessionStep` also defines its own
`terminate_session` tool, so an explicit "bye" jumps to the terminal step from
anywhere. Those three edges are collapsed into one arrow above.

## The four registered steps

`defineSteps()` returns these instances in this order:

| Step | File | Memory namespace | Model override | What it demonstrates |
| --- | --- | --- | --- | --- |
| `ExploreStep` | `explore-step.ts` | `hotel-explore` (summarised) | `openai` / `gpt-5.1`, `reasoning.effort: "low"` | A task-list prompt file, a mutable JSON scaffold, typed capture criteria, an MCP-backed search, and `go().withState()` against `stay()` |
| `PresentStep` | `present-step.ts` | class default, `PresentStep` | `openai` / `gpt-4o`, `temperature: 0.5` | `onEnter()` memory erasure, `onCrossing()` seeding, a three-way branch, and `withPrompt()` handoff |
| `CompareStep` | `compare-step.ts` | class default, `CompareStep` | `openai` / `gpt-5.1`, `reasoning.effort: "low"` | `direct()` responses, cross-step state reads, and a return transition |
| `TerminateSessionStep` | framework | `end` | none, uses flow default `gpt-4o` | The built-in terminal step and the `_prompt` handoff |

<div class="callout callout--note"><span class="callout__title">Note</span><p>&ldquo;Class default&rdquo; means the step never called <code>.useMemory(...)</code>, so <code>Step</code>&rsquo;s constructor set <code>memorySpace</code> to the class name. <code>PresentStep</code> and <code>CompareStep</code> therefore have completely isolated histories, which is what makes erasing them on entry safe.</p></div>

## Supporting files

None of these import anything from `@picoflow/core`. That separation is the
point of lesson 3.

| File | Responsibility |
| --- | --- |
| `backend/hotel-catalog.ts` | Loads `data/hotels.json` once and filters by amenities, room type, and distance |
| `backend/pricing-engine.ts` | Enumerates stay dates, applies month, holiday, room, and weekend multipliers, filters by nightly budget, and totals |
| `tools/hotel-pricing-mcp-*.ts` | Typed local stdio MCP service and client adapter for hotel search |
| `gen-chart.ts` | Flattens hotel records and renders the Markdown comparison table |
| `data/hotels.json` | Thirty-two Portland-area hotel records with amenities, room types, a `level` base price, and distances |
| `prompt/hotel-prompt.ts` | Loads `role.md` as a reusable partial |
| `prompt/role.md` | Persona, tone, and the escalation rule for ending the chat |
| `prompt/explore.md` | The eight-task criteria-collection specification |
| `prompt/explore.json` | The JSON scaffold injected into the explore prompt |
| `prompt/present.md` | Result presentation and the three follow-up actions |
| `prompt/compare.md` | A four-state comparison machine with a feature-synonym map |

## What this track does and does not cover

HotelFlow was written to make four things unavoidable: large externalised
prompts, a typed MCP-backed business operation, memory compaction, and answering
without a model call. It is silent on everything else.

| Feature | In HotelFlow? |
| --- | --- |
| Memory compaction and rolling summaries | yes, `ExploreStep` only |
| `direct()` responses with no second model call | yes, `CompareStep` |
| Per-step model overrides and named namespaces | yes, all four steps |
| Cross-step state via `saveStepState` / `getStepState` | yes |
| Multi-tool batching with `@Tools([...])` | no |
| Structured output via `structOutputSchema()` | no |
| Nested execution with `runStep()` / `runSteps()` | no |
| Concurrent batch mode with `spawnSteps()` | no |
| Multimodal file uploads | no |

For batching, structured output, and nesting, read the
[BasicFlow track](/docs/tutorials/basic-flow/). For file uploads and batch fan-out,
read the [InvoiceFlow track](/docs/tutorials/invoice-flow/).

## The seven lessons

1. [Designing a multi-stage workflow](/docs/tutorials/hotel-flow/multi-stage-design/)
   — mapping a user journey onto steps, and why registration order picks the
   entry point.
2. [Big prompts as spec files](/docs/tutorials/hotel-flow/prompt-files/) —
   `Prompt.file()`, prompt composition, and the mutable JSON scaffold.
3. [MCP-backed hotel search](/docs/tutorials/hotel-flow/backend-tools/) — typed
   criteria, an MCP service boundary, and PicoFlow-owned routing.
4. [Memory compaction and erasure](/docs/tutorials/hotel-flow/memory-compaction/) —
   `enableSummary()`, the compaction thresholds, and `eraseMemory()`.
5. [Branch, forward, and return](/docs/tutorials/hotel-flow/branch-and-return/) —
   `onCrossing()`, `.withMessage(...)`, and priming a step before you enter it.
6. [Answering without an LLM](/docs/tutorials/hotel-flow/direct-responses/) —
   `direct()` and building a Markdown table from cross-step state.
7. [Present and book](/docs/tutorials/hotel-flow/present-and-book/) — the
   present-and-choose prompt and the terminal handoff.

## Running it

```bash
npm run start:dev
npm run test:hotel-flow
```

The scenario pins `HOTEL_FLOW_CURRENT_DATE` to `2027-07-15T00:00:00.000Z` and
books a stay from 1 August to 8 August 2027, so the prices and the comparison
tables are reproducible across runs.

## Next

Start with
[1. Designing a multi-stage workflow](/docs/tutorials/hotel-flow/multi-stage-design/).
