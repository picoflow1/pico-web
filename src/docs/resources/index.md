---
title: Architecture and operating model
eyebrow: Compare
lede: "PicoFlow supplies a common application/session convention for guided conversations; direct LangGraph leaves the graph, state, persistence, and operating conventions to the application team."
source: picoflow/src/picoflow/, pico-demo/src/myflow/hotel-flow/, pico-demo/src/myflow/hotel-langgraph/
---

This comparison is not about whether either framework can build a durable, tool-calling
conversation. Both can. The design choice is **which recurring application boundary your team
wants supplied as a convention and which it wants to design itself**.

PicoFlow is an application-layer runtime for guided customer journeys. It gives every flow the
same Flow/Step lifecycle, session envelope, model/provider boundary, tool-loop conventions, and
operational record. Direct LangGraph starts with graph primitives: nodes, state, reducers, edges,
and optional persistence. It gives a team maximum freedom to compose that shape, and makes the
team responsible for standardising it when several applications need the same conventions.

## The ownership choice

<figure class="flow-journey">
  <img src="/assets/img/picoflow-vs-langgraph-architecture.svg" width="1200" height="680" alt="Comparison between PicoFlow's supplied application-session convention and a direct LangGraph application's chosen graph, persistence, and operations conventions.">
  <figcaption>PicoFlow supplies a reusable application/session baseline. A direct LangGraph application chooses and integrates the topology, durable state, and operational shape that best fits its requirements.</figcaption>
</figure>

| Concern | PicoFlow supplies | A direct LangGraph team chooses |
| :--- | :--- | :--- |
| **Authoring unit** | A `Flow` with cohesive `Step` responsibilities: prompt, allowed tools, owned state, and outcomes. | The graph decomposition: nodes, edges, state channels, reducers, and the boundaries between them. |
| **Turn and session lifecycle** | A shared HTTP/session envelope, durable cursor, model policy, tool loop, and restore lifecycle. | How a graph is invoked, which state is durable, and how a conversation/session boundary is represented. |
| **Operational case record** | One versioned session document with state, memory, status, token totals, and diagnostics. | Whether to use an application record, a LangGraph checkpointer/store, application logs and metrics, LangSmith, or another operating stack. |
| **Topology and execution control** | A guided Flow/Step lifecycle with nested and bounded concurrent work. | Full ownership of graph topology, reducers, scheduler-level branching, subgraphs, and checkpoint behavior. |

This is a difference in defaults, not a claim that LangGraph lacks persistence, checkpointing,
interrupts, private deployment, or observability. A direct graph can use those facilities; a
team decides how to combine and operate them. Likewise, PicoFlow's shared convention is valuable
only when the Flow/Step lifecycle fits the product.

## Why the session document matters

PicoFlow's durable document is an application-readable case record: active step, business state,
named memories, transition sequence, effective model details, tokens, run status, revision, and
structured diagnostics travel together. That makes a common operational vocabulary available
before a second or third conversational application is built.

It is not automatic checkpoint time travel. For a safe production reproduction, copy and redact
the record into isolated storage under a new session ID; choose the resume step; deliberately
restore or trim the relevant state and history; sandbox tools and credentials; then compare the
new result with the original evidence. See [State, memory, and persistence](/docs/resources/state-memory-and-persistence/)
and [Interrupts, replay, and operations](/docs/resources/interrupts-replay-and-operations/) for
the exact trade-offs.

## Choosing the primary model

Choose PicoFlow when several customer-facing conversations benefit from one lifecycle, session
contract, operating record, and domain-oriented authoring model. It is especially useful when
teams want to review business stages—collect, validate, present, decide, finish—rather than
recreate session, tool-loop, and response conventions in every application.

Choose direct LangGraph when graph topology, custom reducers, scheduler-level parallelism,
checkpoint behavior, interrupts, or unusual state reduction are the primary design objects—or
when an existing platform already standardises the surrounding session and operating concerns.

The [HotelFlow case study](/docs/resources/hotel-flow-benchmark/) is deliberately separate from
this architectural discussion. It measures one 14-turn hotel-reservation implementation built
twice, including the source boundary, current line counts, behavior differences, and what those
results do and do not establish.

## Explore the two paths

- Continue the conceptual comparison with [Architectural advantages inventory](/docs/resources/architectural-advantages/), [Architecture and routing](/docs/resources/architecture-and-routing/), and [Parallelism and fan-out](/docs/resources/parallelism-and-fanout/).
- Inspect the implementation evidence in [The 14-turn HotelFlow benchmark](/docs/resources/hotel-flow-benchmark/), [One turn, traced twice](/docs/resources/one-turn-traced-twice/), and [Testing and evaluation](/docs/resources/testing-and-evaluation/).
