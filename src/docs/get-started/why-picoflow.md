---
title: Why PicoFlow
eyebrow: Get started
lede: What PicoFlow actually removes from an application, what the HotelFlow versus LangGraph comparison measured, and the cases where a lower-level orchestration library is the better choice.
source: pico-demo/docs/hotel-flow-critical-evaluation.md
---

PicoFlow's strongest value is a multi-turn, tool-calling conversation that has to survive
process restarts, be picked up again tomorrow, and be maintained by a team that did not write
it. It also composes one-turn, nested, sequential, parallel, and tool-driven work through
ordinary `Step` code. The expensive part is repeatedly building the durable conversation
contract consistently and correctly.

## The problem

Write a durable conversational agent directly on top of a graph library and you will end up
owning all of this in application code:

- a state object that encodes which stage the conversation is in;
- routing logic that inspects that state after every model call and every tool call;
- tool definitions, plus a name-based dispatch table that maps a call to a handler;
- construction of tool-result messages, including the error and validation-failure cases;
- synthetic messages when a stage change means the model needs a fresh instruction;
- serialization and restoration of the message history;
- a session document, an expiration policy, and a store adapter per backend;
- a concurrency story for two requests that arrive for the same session; and
- a response envelope for the HTTP layer.

None of that is domain logic. It is the same code in every conversation your organisation
builds, written slightly differently each time, and each copy carries its own bugs.

PicoFlow's claim is narrow: it owns that list, and it leaves the hotel rules, the invoice
rules, and the validation decisions in your code.

## What the comparison measured

The repository contains two independent implementations of the same hotel reservation
conversation: collect a date range and search criteria, search a local catalog, present
priced results, compare hotels, return to booking, finish with a confirmation number. One
is `HotelFlow` on PicoFlow. The other is a direct LangGraph graph with its own state
definition, types, and session store. Both pass the same 14-turn semantic scenario.

| Scope | HotelFlow with PicoFlow | Direct LangGraph | Difference |
| --- | ---: | ---: | ---: |
| Workflow boundary: flow/steps versus graph/state/types/store | 472 | 1,397 | +925 for LangGraph |
| All hotel application code, including backend and charting | 942 | 1,687 | +745 for LangGraph |
| Complete hotel directory inventory | 2,083 | 2,847 | +764 for LangGraph |

The first row is the one that isolates the framework. It compares the code an application
author writes to express the conversation against the code needed to build the direct
graph's state machine and session runtime. Counts are `wc -l`, so they include imports,
comments and blank lines, and framework source is excluded on both sides.

The second and third rows are context, not a scoreboard. The direct implementation has a
more compact chart helper, so not every line of difference is a framework win.

### Modularity

`HotelFlow` decomposes into four application-owned modules with non-overlapping
responsibilities: the flow owns topology, default model policy and memory compaction;
`ExploreStep` owns criteria collection and search; `PresentStep` owns presentation,
booking and re-search; `CompareStep` owns feature comparison and charts. A developer
changing comparison behaviour opens one file.

The direct graph distributes the equivalent behaviour across `phase`, `route` and
`inputConsumed` fields whose invariants are maintained by hand in every node and every
conditional edge.

### Contract clarity

| Boundary | PicoFlow | Direct LangGraph |
| --- | --- | --- |
| HTTP contract | One shared controller taking `flowName` and `CHAT_SESSION_ID` | A graph-specific input object |
| Durable cursor | `flow.currentStep` | `phase` plus a transient `route` |
| Tool contract | Zod definition plus a decorated `@Tool` handler, dispatched by the framework | LangChain tool objects plus manual name-based dispatch |
| Transition contract | `go()`, `stay()`, `direct()` and destination state/message/prompt | State updates to `phase`, `route`, message arrays and `inputConsumed` |
| Persistence contract | One versioned session schema, shared adapters, logs, tokens, revisions | A graph-specific document with custom store adapters |

PicoFlow has the stronger cross-application contract: every flow validates the same
one-flow-per-session invariant, records the same operational metadata, and returns the
same response envelope. The direct graph is more locally explicit — a LangGraph developer
can read its `StateGraph` without learning anyone's lifecycle.

## Where the boilerplate went

PicoFlow removes the machinery around the rules, not the rules. `HotelFlow` still contains
the schemas, the validation choices, the search, the comparison construction, the booking
transition and the prompts.

It also introduces its own visible ceremony, and it is honest to name it:

- a tool typically appears twice, once in `defineTool()` and once as a decorated handler;
- transitions use framework helpers rather than plain returns; and
- forwarding, replacing or suppressing a message when a stage changes requires
  understanding `onCrossing()`.

## Trade-offs and risks

Adopting PicoFlow is a dependency decision, and the risks are real even though they are
bounded.

**It is proprietary and license-gated.** A runtime `PICOFLOW_KEY` is verified inside the
model loop. Your production service fails on the first model turn if that key is missing or
expired. Get the distribution, versioning and support terms in writing before you commit.

**A framework defect has a blast radius.** One bug in the agent loop or the session layer
affects every flow at once. Mitigate by pinning the version, running conformance scenarios
against your own flows in CI, and staging rollouts.

**Persisted step names are schema.** The session document stores step state keyed by class
name and stores the cursor as a step-name string. Renaming a step class is a data
migration, not a refactor. See [Session document
migration](/docs/guides/migration/).

**You inherit the lifecycle.** `onStart()`, `onRestore()`, `onEnter()`, `onExit()` and
`onCrossing()` have specific firing rules. Until a developer has internalised them, "why
did my setup code run twice" is a real cost. See [Step lifecycle](/docs/concepts/step-lifecycle/).

**You wait for the framework to expose capabilities.** If a LangGraph feature ships
tomorrow and you need it next week, a direct graph gets it first.

**The abstraction is opinionated about shape.** A conversation that does not decompose into
named stages will fight the `Flow`/`Step` model rather than benefit from it.

## When to prefer a lower-level library

Prefer direct LangGraph, or another graph-first orchestration library, when most of these hold:

- the team wants graph state, reducers, topology, or checkpointing as direct application primitives;
- another platform in your organisation already owns sessions, observability and
  concurrency, and PicoFlow would duplicate it;
- your team already has strong LangGraph expertise and no second flow is planned; or
- the workflow is unusual enough that the `Flow`/`Step` lifecycle fights its design.

Prefer PicoFlow when most of these hold:

- the application will contain several conversational flows;
- those flows should share one HTTP contract, session shape, storage policy and
  operational metadata model;
- developers should work in domain-oriented stages;
- memory compaction, token accounting, provider adapters and same-session concurrency
  safeguards should be shared infrastructure; and
- the team can accept PicoFlow's release and licensing terms.

<div class="callout callout--note"><span class="callout__title">Note</span><p>The evaluation's own conclusion is that PicoFlow is easier &quot;for the second and subsequent multi-turn workflows that fit its Flow / Step model&quot;. For a single graph, the comparison is much closer than the line counts suggest, because the framework learning cost is paid once and amortised over zero additional flows.</p></div>

## The defensible claim

> PicoFlow gives developers graph-level orchestration without requiring them to model their
> application as a graph. Compose nested, sequential, parallel, and tool-driven work in
> ordinary steps, while every customer conversation retains one durable session record.

It does not make the model more capable, and it does not remove the need for real business
validation in your own code. Tool schemas and handler code are the runtime boundary; prompt
text is not.

The full evaluation, including the functional comparison, the memory and session-document
analysis, and the direct-LangGraph risk section, is in
[Compare](/docs/resources/).
