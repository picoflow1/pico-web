---
title: Choose a track
eyebrow: Tutorials
lede: Four tutorial tracks, each built line by line from a flow that actually ships in the demo application. Start with BasicFlow.
source: picoflow-demo/src/myflow
---

Every lesson on this site is derived from a real, running flow in
`picoflow-demo/src/myflow`. Nothing here is a sketch: the code quoted in a lesson is the
code the demo NestJS application loads, and the transitions described are the ones
the end-to-end tests assert against the persisted session document.

There are four flows, and therefore four tracks. They overlap deliberately — each
one is a complete workflow, not a fragment — but each was written to make a different
set of framework features unavoidable.

## The four tracks

<div class="cards">
	<a class="card" href="/docs/tutorials/basic-flow/">
		<span class="card__title">BasicFlow — the complete tour</span>
		<span class="card__body">Fourteen registered steps covering tools, MCP, logic steps, structured output, nested execution, memory namespaces, and batch mode. Eighteen lessons.</span>
	</a>
	<a class="card" href="/docs/tutorials/hotel-flow/">
		<span class="card__title">HotelFlow — multi-turn assistant</span>
		<span class="card__body">A search, compare, and book workflow. Large prompt files, your own backend behind a tool, memory compaction, and answering without an LLM call.</span>
	</a>
	<a class="card" href="/docs/tutorials/invoice-flow/">
		<span class="card__title">InvoiceFlow — one-shot extraction</span>
		<span class="card__body">No conversation to speak of. Attach a PDF or PNG, extract typed JSON, return it with a content type, and fan the same job out over a list of files.</span>
	</a>
	<a class="card" href="/docs/tutorials/support-flow/">
		<span class="card__title">SupportFlow — guided support case</span>
		<span class="card__body">Verify an order, route returns or billing, apply policy in deterministic steps, obtain approval when required, and close the case with a durable recap.</span>
	</a>
</div>

## What each track demonstrates

| Feature | BasicFlow | HotelFlow | InvoiceFlow | SupportFlow |
| --- | --- | --- | --- | --- |
| Zod tool definitions and `@Tool` handlers | yes | yes | yes | yes |
| Multi-tool batching with `@Tools([...])` | yes | no | no | no |
| MCP server behind a tool handler | yes | no | no | no |
| `LogicStep` (no model call) | yes | no | no | yes |
| Structured output via `structOutputSchema()` | yes | no | no | no |
| Nested execution: `runStep()` / `runSteps()` | yes | no | no | no |
| Memory compaction and summarisation | no | yes | no | yes |
| `direct()` responses with no second model call | no | yes | yes | no |
| Multimodal file uploads | no | no | yes | no |
| Batch mode via `spawnSteps()` + `concurrentSteps()` | yes | no | yes | no |
| Per-step model overrides | yes | yes | yes | yes |
| Named memory namespaces | yes | yes | yes | yes |
| Custom session restoration | no | no | no | yes |

## Which one first

Read **BasicFlow** first, even if your production workflow looks more like HotelFlow.
BasicFlow is the only track that exercises the whole `Step` contract, and the later
three tracks assume you already know what `go()`, `stay()`, `saveState()`, and a memory
namespace are. The BasicFlow track spends its first six lessons on exactly those
fundamentals and only then moves into composition.

BasicFlow is also a slightly artificial flow. It asks for the weather in two cities,
then your favourite colour, then your name, then your date of birth, then your
address. No product would be shaped that way. It is shaped that way so that every
lesson has a step that isolates one framework idea, and so the end-to-end test can
walk a single deterministic eight-turn path through all of it.

<div class="callout callout--note"><span class="callout__title">Note</span><p>The demo application registers all four flows in one NestJS module and serves them from one endpoint, <code>POST /ai/run</code>. The <code>flowName</code> field in the request body selects which flow a session belongs to. A session is bound to exactly one flow for its lifetime.</p></div>

## Running the code alongside the lessons

Every lesson names the demo file it quotes, in the `source` line under the page
title. Open that file while you read. Two commands cover most of what you need:

```bash
npm run start:dev
npm run test:basic-flow
```

The first starts the NestJS application on port 8000. The second replays the
scenario in `test/basic-flow/basic-flow.scenario.json` through the real HTTP
controller and asserts both the assistant's wording and the persisted step cursor
after every turn.

## Next

Start with the [BasicFlow track overview](/docs/tutorials/basic-flow/), which maps all
fourteen steps before the first lesson.
