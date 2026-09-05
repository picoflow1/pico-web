---
title: PicoFlow vs. LangGraph
eyebrow: Compare
lede: "A side-by-side evaluation of the same hotel-reservation chatbot built twice: once on PicoFlow, once directly on LangGraph. Code size, modularity, contracts, persistence, debugging, and the risks on both sides."
source: pico-demo/docs/hotel-flow-critical-evaluation.md, picoflow/src/picoflow/, pico-demo/src/myflow/hotel-flow/, pico-demo/src/myflow/hotel-langgraph/
---

Both implementations now live side by side in `pico-demo`. They describe the same
conversation: collect a date range and search criteria, search a local hotel catalog, present
priced results, compare hotels, return to booking, and finish with a confirmation number. They
carry parallel copies of the same 14-turn semantic scenario.

Start from the honest baseline: **nothing here is impossible without PicoFlow**. LangGraph,
LangChain tools, and an application-owned session layer deliver the same visible workflow. The
real question is not capability, it is **which layer your team ends up owning** — and how many
times you intend to own it.

The reason to adopt PicoFlow is developer and operator leverage. It turns a recurring body of
agent infrastructure into one regular application model: small stage modules, standard
transitions, one session contract, one model/provider policy, one persistence boundary, and one
diagnostic artifact. Less code is only the visible symptom. The larger savings are shared
comprehension, faster review and onboarding, fewer local conventions, and the ability to fix a
runtime concern once for every flow.

## Two perspectives on this evaluation

This comparison is arranged into two complementary tracks:

1. **Type 1: Architectural Comparison & Capabilities** — The foundational principles, cognitive mental models, persistence boundaries, DevOps observability, and AI-assisted debugging advantages. For the complete reference inventory, read [Architectural Advantages Inventory](/docs/resources/architectural-advantages/).
2. **Type 2: Empirical Case Study (HotelFlow Benchmark)** — A reproducible side-by-side implementation of the same 14-turn hotel booking assistant, featuring code-size measurements (486 vs. 1,434 lines), file inventories, and turn-by-turn code execution traces.

---

## Architectural contrast at a glance

The fundamental choice is between a **cohesive, class-based application model backed by a single human-readable Case Record** versus a **low-level graph of nodes and edges backed by normalized database checkpoint blobs**:

```text
                 PICOFLOW                                        LANGGRAPH
        (The Business Application)                        (The Low-Level Graph)
 ─────────────────────────────────────────       ─────────────────────────────────────────

          ┌─────────────────────┐                         ┌─────────────────────┐
          │  Cohesive Flow/Step │                         │ Node A  ──►  Node B │
          │  ┌───────────────┐  │                         │   │            │    │
          │  │  Prompt       │  │                         │   ▼            ▼    │
          │  │  Tools & Zod  │  │                         │ Conditional Edges   │
          │  │  State & Goto │  │                         │ (Scattered Routing) │
          │  └───────────────┘  │                         └─────────────────────┘
          └──────────┬──────────┘                                    │
                     │ (Single Turn)                                 │ (Superstep Barrier)
                     ▼                                               ▼
          ┌─────────────────────┐                         ┌─────────────────────┐
          │  Single JSON Doc    │                         │ Multi-Table Schema  │
          │  ┌───────────────┐  │                         │ ┌─────────────────┐ │
          │  │ state         │  │                         │ │ checkpoints     │ │
          │  │ memory        │  │                         │ │ checkpoint_blobs│ │
          │  │ currentStep   │  │                         │ │ writes / queues │ │
          │  │ diagnostics   │  │                         │ └─────────────────┘ │
          │  └───────────────┘  │                         │ (Requires LangSmith │
          │ (Human & AI Read)   │                         │  for visibility)    │
          └─────────────────────┘                         └─────────────────────┘
```

### The 6 Foundational Pillars

| Pillar | PicoFlow | Direct LangGraph | Deep Dive Reference |
| :--- | :--- | :--- | :--- |
| **1. State & Persistence** | **Single Case Record:** Whole session stored as one readable JSON document (`SessionDoc`). | **Checkpoint Blobs:** Fragmented across multiple relational/blob tables. | [State & Persistence](/docs/resources/state-memory-and-persistence/) |
| **2. Mental Model** | **Cohesive OOP:** 1 Step file bundles prompt, Zod tools, handlers, state, and routing. | **Fragmented DAG:** Code scattered across nodes, edge routers, state schemas. | [Architecture & Routing](/docs/resources/architecture-and-routing/) |
| **3. DevOps & Analytics** | **Native DB Queries:** Standard MongoDB / Cosmos queries for funnels and costs. Zero SaaS lock-in. | **Proprietary Cloud:** Heavy reliance on LangSmith for production observability. | [Architectural Inventory](/docs/resources/architectural-advantages/) |
| **4. AI Incident Triage** | **Instant Root Cause:** Dump `session.json` directly into an LLM prompt for analysis. | **Complex Scripting:** Must traverse checkpoint parent hashes to reconstruct traces. | [Architectural Inventory](/docs/resources/architectural-advantages/) |
| **5. Replay & Time Travel** | **Single-Cursor Manipulation:** Reset `flow.currentStep` to rewind and test. | **Checkpoint Tree Forking:** Branching from internal checkpoint DAG nodes. | [Interrupts & Operations](/docs/resources/interrupts-replay-and-operations/) |
| **6. Concurrency** | **Coordinator Pattern:** Calling step aggregates parallel outputs with standard TypeScript. | **Pregel Supersteps:** Lockstep execution with binary channel reducers. | [Parallelism & Fan-Out](/docs/resources/parallelism-and-fanout/) |

For the complete, itemized technical breakdown across all six pillars, see the **[Architectural Advantages Inventory](/docs/resources/architectural-advantages/)**.

---

## Scope and API baseline

This is a comparison of two applications, not a claim that either framework lacks capabilities
the other has. Source and current APIs take precedence over historical documentation.

The PicoFlow side was checked against the local `picoflow` 1.0.23 source and
[`pico-demo/src/myflow/hotel-flow`](https://github.com/picoflowio/pico-demo/tree/main/src/myflow/hotel-flow). The direct side was checked against
[`pico-demo/src/myflow/hotel-langgraph`](https://github.com/picoflowio/pico-demo/tree/main/src/myflow/hotel-langgraph), which uses `@langchain/langgraph` 1.4.8. Current
LangGraph documentation still provides `StateGraph`, reducers, conditional edges, `Command`,
`Send`, optional checkpointers, stores, interrupts, and checkpoint history. The direct hotel
graph intentionally calls `.compile()` with no
checkpointer and instead persists its own session document. Therefore, the custom store,
missing checkpoint history, and lack of revision checks discussed below describe **this direct
implementation**—not an inherent limitation of LangGraph.

That distinction is material: a direct LangGraph application can adopt a checkpointer and
store, but it must choose, configure, integrate, and operate them. PicoFlow supplies a
different, fixed session-document model out of the box.

## Audit result in one table

| Question | Finding from these implementations |
| --- | --- |
| Can direct LangGraph reproduce the conversation? | Yes. The deterministic test completes search, repeated comparison, resume, booking, termination, and deletion. |
| Which has less application orchestration? | PicoFlow: 486 flow/step lines versus 1,434 graph/state/types/store lines. |
| Which implementation validates domain inputs more defensively? | Direct LangGraph. It validates dates, allowed values, selected hotels, comparison features, and booking membership in code. |
| Which has a reusable whole-response acceptance gate? | PicoFlow. Each step can veto a successful nonempty raw, structured, or tool-call result through `checkResponse()` and use the shared model retry loop before dispatch. HotelFlow has not yet used this hook. |
| Which has stronger session-write safety? | PicoFlow. It combines a per-session lock with revision compare-and-swap; the direct stores overwrite unconditionally. |
| Which exposes native checkpoint replay and interrupts here? | Neither implementation. LangGraph supports both, but this graph does not configure a checkpointer. |
| Which has the stronger fast application test? | Direct LangGraph. Its injected scripted model gives a deterministic 14-turn unit test and an HTTP boundary test. |
| Which scales conventions across many flows? | PicoFlow. The engine standardizes the HTTP envelope, session schema, model registry, lifecycle, logging, tokens, and stores. |
| Which gives maximum topology/state control? | Direct LangGraph. Every state channel, reducer, node, edge, and persistence choice is application-owned. |
| Which is easier to diagnose without another platform? | PicoFlow. Messages, state, cursor, sequence, models, tokens, logs, warnings, and errors travel in one session document. |
| Does production LangGraph require observability? | Yes. LangSmith is its official integrated option; otherwise the team must supply equivalent tracing and operations itself. |

## Tutorial and comparison map

Explore the comparison through its two distinct tracks:

### Track 1: Architectural Comparison & Capabilities
1. **[Architectural Advantages Inventory](/docs/resources/architectural-advantages/)** — The normative catalog of advantages across state, ergonomics, DevOps, triage, and concurrency.
2. **[Architecture and routing](/docs/resources/architecture-and-routing/)** — What each runtime considers the primary unit: cohesive steps vs. explicit nodes and edges.
3. **[State, memory, and persistence](/docs/resources/state-memory-and-persistence/)** — Durable shapes, single JSON case records, message histories, expiry, and concurrency.
4. **[Interrupts, replay, and operations](/docs/resources/interrupts-replay-and-operations/)** — Single-cursor rewind vs. checkpoint trees, human-in-the-loop holds, and production operations.
5. **[Parallelism and fan-out](/docs/resources/parallelism-and-fanout/)** — Coordinator-owned work vs. graph-scheduled superstep branches.

### Track 2: HotelFlow Benchmark & Code
6. **[One turn, traced twice](/docs/resources/one-turn-traced-twice/)** — The same comparison turn traced line-by-line through both stacks.
7. **[Tool loops and validation](/docs/resources/tool-loops-and-validation/)** — Model tool calls, dispatch loops, direct responses, and trust boundaries.
8. **[Reliability and production gaps](/docs/resources/reliability-and-production-gaps/)** — Concrete defects, production gaps, and hardening work observed on both sides.
9. **[Testing and evaluation](/docs/resources/testing-and-evaluation/)** — What the 14-turn deterministic scenarios actually prove and what they do not.

## What was compared

The review examined two working implementations of the same hotel conversation:

- the PicoFlow version — one `Flow` and three conversation steps, plus a hotel catalog and
  pricing backend, a chart renderer, prompt assets, and a semantic scenario;
- the direct version — a LangGraph `StateGraph`, its state and domain type definitions, a
  custom session store, an equivalent backend, chart renderer, prompt assets, and scenario.

Line counts use `wc -l`, so comments, imports, and blank lines are included. Tests and
framework source are excluded on both sides. The comparison is against real source rather than
an idealised architecture either implementation could build later. The prompt and catalog
copies differ only by trailing newlines, and the scenarios only by `flowName` versus
`graphName`. Pricing, catalog, and chart helpers are separate implementations, however, so
total-directory counts and edge-case behaviour are not framework-pure measurements.

"Direct LangGraph" here means "not built on PicoFlow". It still uses LangChain message and
tool types and binds chat models directly.

## Functional comparison

Both applications implement the same state machine:

```text
collect criteria -> present results -> compare hotels
       ^                 ^                 |
       |                 +-----------------+
       +-- change search                    |
                                            v
                                      resume booking

present results -> book -> terminal
any stage -> terminate -> terminal
```

Both collect dates, budget, room type, amenities, and distance preferences; search the same
style of bundled catalog; calculate daily prices and totals; present results and permit a new
search; compare on price, room type, amenities, or distance; reuse selected hotels for a
subsequent comparison; return to the list and generate a confirmation number; keep
stage-specific conversational context; and expose deterministic date overrides for replayable
tests.

The authoring shape is what differs:

```text
Flow -> ExploreStep -> PresentStep -> CompareStep
               \          |             /
                +---- go/stay/direct ---+

StateGraph
  START -> exploreAgent -> exploreTools
        -> presentAgent -> presentTools
        -> compareAgent -> compareTools -> END
```

The PicoFlow flow registers steps and configures their models and memory. A step combines its
prompt, tool definitions, handlers, domain state, and transition outcomes. `go(...)` activates
another step, `stay(...)` keeps the current step active with corrective feedback, and
`direct(...)` returns a response without another model call.

The direct version builds six explicit graph nodes — an agent node and a tool node per stage.
It stores `phase`, `route`, and `inputConsumed` in an annotation-based state and uses
conditional edge functions to route each invocation. Tool effects and routing are ordinary
branches in one large class.

The visible behaviour is close, but the implementations are not behaviourally identical
outside the tested path. The direct implementation validates malformed JSON, date ordering,
allowed room types and amenities, hotel membership, and comparison features. PicoFlow's demo
handlers trust more model-produced arguments. The direct version also persists the
confirmation number; PicoFlow embeds it only in the terminal prompt. These are application-
level choices, not evidence about what either framework can express, but they matter when
judging the code as written.

## Code-size evidence

For the identical 14-turn hotel workflow, PicoFlow uses **486** application-owned
flow/step lines while the direct LangGraph implementation uses **1,434** graph, state,
type, and session-store lines: **948 fewer lines, or 66.1% less** on the PicoFlow side.
This is a reproducible code-ownership case study, not a universal productivity or
runtime-performance claim.

<section class="line-reduction" aria-labelledby="line-reduction-title">
<div class="line-reduction__heading">
<div>
<p class="line-reduction__eyebrow">Same 14-turn hotel workflow</p>
<h3 id="line-reduction-title">One conversation, built twice.</h3>
<p class="line-reduction__label">Application-owned workflow/runtime code</p>
</div>
<div class="line-reduction__headline">
<strong>66.1%</strong>
<span>less code</span>
<small>486 vs. 1,434 lines</small>
</div>
</div>
<div class="line-reduction__stats">
<div class="line-reduction__stat line-reduction__stat--picoflow">
<span>PicoFlow</span>
<strong>486</strong>
<small>flow and step lines</small>
</div>
<div class="line-reduction__stat line-reduction__stat--langgraph">
<span>Direct LangGraph</span>
<strong>1,434</strong>
<small>graph, state, type, and store lines</small>
</div>
</div>
<div class="line-reduction__bars" aria-hidden="true">
<div class="line-reduction__bar line-reduction__bar--picoflow"><span></span></div>
<div class="line-reduction__bar line-reduction__bar--langgraph"><span></span></div>
</div>
<p class="line-reduction__note">Application-owned workflow/runtime scope; framework source excluded on both sides.</p>
</section>

<figure class="line-compare" aria-labelledby="line-compare-caption">
<div class="line-compare__grid">
<article class="line-compare__card line-compare__card--picoflow">
<h3>HotelFlow on PicoFlow</h3>
<ul class="line-compare__files">
<li><code>hotel-flow.ts</code><span>51</span></li>
<li><code>explore-step.ts</code><span>149</span></li>
<li><code>present-step.ts</code><span>129</span></li>
<li><code>compare-step.ts</code><span>157</span></li>
</ul>
<p class="line-compare__total"><span>TOTAL</span><strong>486</strong></p>
<p class="line-compare__note">Four domain modules. The session document, step cursor, tool dispatch, storage adapters, and concurrency checks come from the runtime.</p>
</article>
<article class="line-compare__card line-compare__card--langgraph">
<h3>The same flow, direct on LangGraph</h3>
<ul class="line-compare__files">
<li><code>hotel-langgraph.ts</code><span>1,100</span></li>
<li><code>hotel-session-store.ts</code><span>218</span></li>
<li><code>hotel-langgraph.state.ts</code><span>90</span></li>
<li><code>hotel-types.ts</code><span>26</span></li>
</ul>
<p class="line-compare__total"><span>TOTAL</span><strong>1,434</strong></p>
<p class="line-compare__note">One 1,100-line graph module, plus a hand-written session store with its own memory, SQLite, and MongoDB adapters.</p>
</article>
</div>
<figcaption class="line-compare__caption" id="line-compare-caption">The workflow boundary for the same 14-turn hotel-reservation conversation. Counts use <code>wc -l</code>; framework source is excluded on both sides.</figcaption>
</figure>

| Scope | PicoFlow | Direct LangGraph | Difference |
| --- | ---: | ---: | ---: |
| Flow/step versus graph/state/types/store | **486** | **1,434** | **+948 direct** |
| Domain backend and chart helpers | 470 | 290 | −180 direct |
| All TypeScript in each hotel directory | **967** | **1,754** | **+787 direct** |
| Prompt and catalog assets | 893 | 894 | +1 direct |
| Complete hotel directory inventory | **1,860** | **2,648** | **+788 direct** |

The first row is the clearest framework comparison: the code an application author writes to
express the conversation, against the code needed to build the direct graph's state and
session runtime. That is 66.1% less code on the PicoFlow side. Its 486 lines still contain
real domain logic — prompt construction, criteria extraction, search, booking, comparisons,
and chart assembly. PicoFlow removes repetitive conversation infrastructure, not the hotel
rules.

The remaining rows are inventory context. The direct implementation rewrites the pricing and
chart helpers more compactly, so its domain-helper total is 180 lines smaller. The prompt and
catalog asset difference is only three missing trailing newlines in the PicoFlow copies. The
workflow/runtime row is therefore the useful orchestration comparison; it avoids pretending
that every line in a catalog, prompt, or renderer is a framework win.

PicoFlow's own source is excluded, just as LangGraph and LangChain internals are. A consumer
pays to learn, configure, test, upgrade, and operate a framework; it does not rewrite that
framework for every chatbot.

### Where the 948 workflow/runtime lines went

These are additive source artifacts behind the headline. A zero means there is no separate,
graph-specific file because PicoFlow supplies that contract in its shared runtime; it does not
mean the concern disappears.

| Application-owned artifact | PicoFlow | Direct LangGraph |
| --- | ---: | ---: |
| Conversation flow/graph implementation | `hotel-flow.ts` + three steps: **486** | `hotel-langgraph.ts`: **1,100** |
| Session lifecycle and storage adapters | Shared runtime | `hotel-session-store.ts`: **218** |
| State channels and reducers | Shared Step/session contract | `hotel-langgraph.state.ts`: **90** |
| Graph-specific supporting types | Colocated with stages | `hotel-types.ts`: **26** |
| **Workflow/runtime total** | **486** | **1,434** |

The direct graph's additional code makes routing, tool dispatch, state updates, persistence,
and the HTTP response envelope explicit in this application. PicoFlow moves those recurring
mechanics into a reusable flow, step, and session contract while keeping hotel policy and
validation in application code.

## Modularity

The PicoFlow version has four small application-owned modules with clear responsibilities: the
flow owns topology, default model policy, and memory compaction; one step owns criteria
collection and searching; one owns result presentation, booking, re-search, and comparison
entry; one owns feature comparisons, chart generation, and the return to booking. The catalog,
pricing engine, chart renderer, and prompt assets stay outside the step classes. State is
associated with the step that owns it, and cross-step data is read through explicit flow
helpers.

That shape is consistent across the other flows in the same repository, so a team member
recognises a `Step` as the unit supplying a prompt, tools, state, and semantic transitions
without reconstructing a local convention.

There are real coupling costs. Step class names are persisted identifiers, so a rename is a
session migration. Decorated tool methods are connected to definitions by name. The developer
must understand `go`, `stay`, memory namespaces, and the inherited model loop.

The direct implementation has two good seams — a model factory that makes stage models
replaceable in tests, and a session store that separates memory, SQLite, and MongoDB
persistence. The conversational implementation is otherwise concentrated in a 1,100-line
class that constructs tools and models, builds topology, invokes agents, dispatches tools,
validates arguments, normalises criteria, performs hotel operations, creates responses, and
manages session lifecycle.

Direct LangGraph does not *require* a monolith. That class could be split into phase modules,
reusable agent/tool-loop helpers, and a shared persistence package. Doing it well would
recreate much of the standard application layer PicoFlow already provides.

**Modularity: PicoFlow, for this codebase.** Direct LangGraph keeps the advantage of local
visibility when stepping through a single raw graph invocation.

## Team consistency and time to market

Direct LangGraph provides flexible primitives but establishes no application-wide convention
for stage state, tool dispatch, persistence, history, error handling, or response envelopes.
One team can use reducers and checkpointers; another an outer session document; a third a
conversation cursor in a custom database record. Each choice may be reasonable in isolation,
but the portfolio becomes harder to review and operate.

PicoFlow makes the intended authoring picture explicit:

```text
Flow -> registered Step -> prompt and selected tools
     -> typed outcome -> step state and memory
     -> one versioned session document
```

The application controller also exposes every registered flow through one `/ai/run` contract
and one `flowName` selector, so a hotel flow shares a runtime vocabulary with the basic and
invoice flows beside it.

The line-count result is not a calendar-time benchmark. It does indicate that a new PicoFlow
chatbot has fewer application-owned concerns to design, review, test, and explain before
reaching the same demonstration. A stronger experiment would measure implementation hours,
review comments, defects, and time to add a second graph.

**Time to market: PicoFlow has the stronger default for a portfolio of multi-turn chatbots.**
It can also express one-turn orchestration through normal nested and parallel step calls; the
comparison is about the application model and repeated infrastructure, not a capability gap.

The compounding effect matters more than the first graph. With PicoFlow, developers review
business stages that look alike across applications. With direct graphs, every team can invent
its own cursor, message policy, tool loop, persistence envelope, retry rules, and diagnostics.
That flexibility becomes a code-sharing tax: reviewers and maintainers must relearn each local
runtime before changing the domain behavior.

## Contract clarity

| Boundary | PicoFlow | Direct LangGraph |
| --- | --- | --- |
| HTTP contract | Shared controller at `/ai/run`, with `flowName` and `CHAT_SESSION_ID` | A graph-specific `run(...)` input object |
| Graph identity | Registered flow name, bound to one session | An explicit graph name checked by its custom store |
| Durable cursor | `flow.currentStep` | `phase` plus a transient `route` |
| Stage contract | `Step` lifecycle, prompt, tools, state, memory, outcomes | Plain async graph nodes plus explicit conditional edges |
| Tool contract | Zod definition plus a decorated handler and framework dispatch | LangChain tool objects plus manual name-based dispatch branches |
| Transition contract | `go`, `stay`, `direct`, and destination state/message/prompt | State updates to `phase`, `route`, message arrays, and `inputConsumed` |
| Persistence contract | Shared versioned session schema, adapters, logs, tokens, revisions | A graph-specific document with custom memory/SQLite/Mongo adapters |
| Provider contract | Provider adapters and model selection | Direct chat-model construction with an injectable factory |

PicoFlow has the stronger cross-application contract: it validates the one-flow-per-session
invariant, records status and operational metadata, and gives every flow the same persistence
and response boundary.

The direct graph is more locally explicit. A LangGraph developer can read its `StateGraph` and
conditional edges without learning PicoFlow's lifecycle — valuable for one-off work and for
adopting new LangGraph features quickly. The cost is that `phase`, `route`, and
`inputConsumed` form a distributed protocol whose invariants are maintained by hand.

**Contracts: PicoFlow for a shared application platform; direct LangGraph for raw local
transparency.**

## Where the boilerplate went

The direct implementation carries these concerns in application source:

- seven Zod schemas and seven LangChain tool objects;
- stage-to-tool arrays and per-stage bound models;
- three agent nodes and three tool nodes;
- conditional routing after every agent and tool node;
- manual selection of termination and tool calls;
- repeated invalid-tool result construction and Zod error formatting;
- user-input consumption and synthetic messages when stages change;
- criteria normalisation and date validation;
- message serialisation and restoration;
- session ID validation, expiration, load, save, and deletion;
- memory, SQLite, and MongoDB adapters; and
- the graph-specific response envelope.

The PicoFlow version still contains the hotel rules, schemas, validation choices, search,
comparison construction, booking transition, and prompts. PicoFlow removes mostly the repeated
machinery around those rules — the useful kind of abstraction, where application code stays
responsible for what a hotel operation means while the framework owns how a multi-turn step is
executed and saved.

PicoFlow does retain visible ceremony. A tool appears in both `defineTool()` and a decorated
method; transitions use framework-specific helpers; and a developer must understand the
lifecycle when forwarding or replacing messages. Those costs are smaller than implementing a
separate state-and-session runtime per graph, but they are not zero.

**Boilerplate: PicoFlow.**

## Memory and session-document organisation

The direct graph writes a graph-specific document after each invocation. PicoFlow writes one
framework session document containing the flow, its steps, memory, status, operational logs,
and token totals.

```jsonc
// PicoFlow
{
  "id": "…",
  "revision": 7,
  "version": 1.5,
  "runStatus": "running | completed | aborted",
  "flow": {
    "name": "HotelFlow",
    "model": { "provider": "openai", "name": "gpt-4o", "params": {} },
    "currentStep": "ExploreStep | PresentStep | CompareStep | …",
    "steps": [{ "name": "ExploreStep", "state": {}, "model": {} }],
    "memory": { "hotel-explore": { "messages": [], "summary": "…" } },
    "context": {},
    "sequence": []
  },
  "tokens": {},
  "log": [], "error": [], "warn": [],
  "createdOn": "…", "saveOn": "…"
}
```

```jsonc
// Direct LangGraph
{
  "version": 1,
  "id": "…",
  "graphName": "…",
  "state": {
    "phase": "explore | present | compare | terminal",
    "route": "exploreAgent | presentAgent | compareAgent | end",
    "completed": false,
    "response": "…",
    "userInput": "…",
    "inputConsumed": true,
    "criteria": {}, "hotelFound": [], "availableHotels": [],
    "selectedHotels": [], "lastComparison": [],
    "bookedHotel": "…", "confirmationNumber": 123456,
    "exploreMessages": [], "presentMessages": [], "compareMessages": []
  },
  "expireAfter": 50000,
  "createdAt": "…", "modifiedAt": "…"
}
```

The PicoFlow flow enables rolling summary compaction for one namespace only, keeping the recent
conversation and summarising older messages. Present and compare use isolated step-named
memory and clear it when entering a new mode. PicoFlow also records provider-neutral token
totals and model overrides, and its `revision` field is a compare-and-swap value: the engine
serialises turns for a session in-process, and the stores reject stale revisions. The framework
therefore has a defined response to concurrent requests instead of letting the last
whole-document write win.

The direct shape is straightforward for one graph and keeps all domain state in one
annotation-compatible object. It also persists transient control values such as `response`,
`userInput`, `route`, and `inputConsumed`. It has no revision-based write protection, token
totals, warning/error history, or framework-wide operational status. Its custom store is
clear, but it is application code every direct graph would need to duplicate or extract.

There is no PicoFlow-wide expiration default. Each Flow decides its own restore policy; the
SupportFlow tutorial, for example, resets a case after 30 minutes of inactivity. The direct
implementation's fallback is 50,000 **milliseconds** — roughly 50 seconds — and belongs to
that graph's own code. Neither is a finished product policy, but the direct fallback is
especially short for a human conversation.

| Question | Better choice | Reason |
| --- | --- | --- |
| Understand one graph in isolation | Direct | Its state mirrors the graph annotation directly |
| Diagnose a production turn | PicoFlow | Status, logs, warnings, errors, model metadata, and tokens are standard fields |
| Query sessions across many flows | PicoFlow | Every flow shares the same outer schema |
| Add a small custom store | Direct | The store interface is compact and local |
| Prevent stale whole-document writes | PicoFlow | Revision checks and session locking are framework concerns |
| Compact long-running chat history | PicoFlow | Memory namespaces and rolling summaries are built in |
| Persist only the minimum fields | Direct | The graph controls its own envelope |

## Debugging and machine comprehension

The direct implementation is easy to enter with a debugger: the model call, graph node, tool
dispatch, route selection, and state update are in the same file. The drawback is that a stage
transition can involve several manually maintained fields and repeated branches. A bug in input
forwarding may require tracing `phase`, `route`, `inputConsumed`, message reducers, and
conditional edges together.

PicoFlow is easier to navigate by business responsibility. A search problem belongs to the
explore step; a comparison problem to the compare step; the runtime lifecycle is shared. A rare
framework problem requires stepping into PicoFlow's runner, memory, or session store, so the
debugging boundary moves out of the application repository. That is a real dependency cost,
balanced by the fact that the same infrastructure is debugged once for many flows.

For an AI coding agent reading one local function, direct LangGraph is more explicit: tool
calls and state updates are ordinary code. For an agent reasoning about a complete application,
three named steps are more cohesive than one 1,100-line multipurpose class.

For machines consuming persisted data, PicoFlow has the stronger contract. A tool can reliably
look for `runStatus`, `flow.currentStep`, `flow.steps`, `flow.memory`, `tokens`, and `error`
across an entire portfolio. A direct LangGraph consumer must learn a new state and persistence
vocabulary per application. That advantage depends on documentation and type declarations being
available — an opaque framework with an undocumented lifecycle turns the same abstractions into
hidden context.

For production diagnosis, the PicoFlow document is unusually valuable because the evidence is
co-located: conversation memory, step state, active cursor, transition sequence, effective
models, token totals, and structured log/warn/error records can be exported together. An
incident does not begin with correlating a trace ID across a graph service, tracing vendor,
session database, and application logs.

**Debugging: direct LangGraph for low-level local stepping; PicoFlow for routine domain work,
session diagnosis, and fleet-wide automation.**

## Risks specific to PicoFlow

PicoFlow's risks are real but comparatively bounded. They are mostly dependency-governance and
lifecycle-learning risks, not repeated productivity risks in every chatbot:

- Pin the PicoFlow version, run its contract tests in CI, and review upgrades against the
  public `Flow`, `Step`, tool, memory, and session contracts. The distribution terms should
  also be explicit before production adoption.
- A framework defect can affect several flows at once. Version pinning, conformance scenarios,
  staged rollout, and a supported release process keep that blast radius observable and
  recoverable.

The practical mitigation is straightforward: keep the framework boundary stable, test it once
at the platform level, and keep business rules in the steps and backend. None of these risks
requires each chatbot team to reimplement the session engine or agent loop.

## Risks specific to direct LangGraph

The main risk is not that direct LangGraph cannot work. It is that every application team
becomes responsible for a growing amount of workflow infrastructure, and that responsibility
compounds as the number of graphs and developers increases.

- **More code means more design work before domain work begins.** Here the direct
  workflow/runtime boundary is 1,434 lines against 486. The extra 948 lines are largely agent
  loops, tool routing, state transitions, message forwarding, session serialisation, and
  persistence — all of which must be understood and maintained before adding a hotel feature.
- **A small feature crosses too many mechanisms.** Adding a stage or tool can require a schema,
  a tool object, a stage-tool array, a bound model, an agent node, a tool node, one or more
  conditional routes, message-history handling, state fields, and persistence serialisation.
  The business code is surrounded by coordination work.
- **State-machine complexity consumes engineering capacity.** `phase`, `route`,
  `inputConsumed`, three message arrays, reducers, synthetic messages, and conditional edges
  form a protocol that must remain consistent. Explicit distributed state is still cognitive
  load, and a change that looks local can alter resume behaviour, tool-loop behaviour, or the
  next HTTP response.
- **Productivity declines through review and onboarding.** A new developer must reconstruct the
  local graph conventions before safely changing a node. Reviewers inspect topology, state
  updates, tool dispatch, persistence, and error paths in addition to the business rule. That
  increases ramp-up time, review latency, and the chance that a correct domain change
  introduces an unrelated lifecycle regression.
- **The same infrastructure is paid for repeatedly.** Each direct graph needs decisions about
  session shape, expiration, message serialisation, token accounting, logging, errors,
  concurrency, and provider adapters. Even if the first graph tolerates that cost, the second
  repeats it or forces an early internal framework project.
- **Operational inconsistency becomes a maintenance tax.** One graph may persist a `phase`,
  another a `currentNode`, another only a database checkpoint. Operators, dashboards, migration
  scripts, and coding agents must learn every vocabulary, and shared incidents cannot be fixed
  once at a common runtime boundary.
- **Testing must cover infrastructure combinations, not only intent.** Tests need to exercise
  agent-without-tool responses, malformed tool calls, repeated comparisons, cross-stage input
  forwarding, terminal behaviour, stale sessions, expired sessions, serialisation, and
  concurrent writes. The direct class owns all of those combinations.
- **Debugging complexity grows faster than linearly.** A route bug can involve a model
  response, the latest-tool-call selector, a reducer, a synthetic message, a conditional edge,
  and a session write. The source is visible, but the interaction surface is large. Visibility
  should not be confused with simplicity.
- **The opportunity cost is material.** Time spent building a runner, store, history policy,
  and observability layer is time not spent on booking correctness, security, user experience,
  or integrations.
- **The likely end state is another framework.** Once several direct graphs exist, teams
  naturally extract shared runners, stores, state conventions, and tool loops — creating
  framework maintenance without the benefit of a deliberate public contract, migration policy,
  or shared conformance suite.

The direct implementation's local transparency is a legitimate benefit, but it does not cancel
this productivity cost. Raw primitives give maximum control; they also transfer the complexity
budget from the framework maintainer to every application team.

## Is PicoFlow actually easier?

**Yes, for the second and subsequent multi-turn workflows that fit its Flow / Step model
model.** The domain modules are smaller and more cohesive, and important session, memory, and
provider behaviour comes from one runtime. The 486-versus-1,434 workflow/runtime comparison makes
that visible.

**There is still a bounded abstraction and dependency cost.** A developer must learn the
lifecycle, understand inherited behaviour, preserve persisted step names, and wait for the
framework to expose advanced capabilities. That cost is usually smaller than the recurring
direct-LangGraph complexity above when several flows share the same runtime contract.

The defensible value proposition is:

> PicoFlow standardises the repetitive application engineering around multi-turn
> LangChain/LangGraph-style conversations so individual flow authors can focus on prompts,
> tools, validation, domain state, and transitions.

It should not be advertised as making the language model more capable, or as eliminating the
need for direct business validation.

## Decision framework

Use PicoFlow when most of the following are true:

- the application will contain several conversational flows;
- flows need one HTTP contract, session shape, storage policy, and operational metadata model;
- developers should work in domain-oriented stages;
- memory compaction, token accounting, provider adapters, and concurrency safeguards should be
  shared;
- the team can depend on PicoFlow's release and licensing terms; and
- the workflow fits the `Flow`/`Step` lifecycle.

Prefer direct LangGraph when most of the following are true:

- the team wants graph/state primitives as the primary application model;
- full direct control of state reducers, topology, and persistence is more valuable than a common
  application contract;
- another platform already owns sessions, observability, and concurrency;
- the team has strong direct LangGraph expertise; or
- the graph is unusual enough that the PicoFlow lifecycle fights its design.

For a normal multi-turn product chatbot, direct LangGraph should carry an explicit
productivity-risk review. Estimate not only the first graph's implementation effort, but also
the cost of the next graph, onboarding, cross-graph operations, regression testing, and
maintaining the custom runtime. And measure future graphs by implementation time, defects,
review effort, and operational incidents — not by line count alone.
