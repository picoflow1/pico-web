---
title: Architecture and routing
eyebrow: Compare
lede: PicoFlow makes the active conversation stage the runtime cursor; LangGraph makes state, nodes, and routes explicit graph concerns.
source: codex/pico-web/picoflow-langgraph.html, picoflow/src/picoflow/flow/flow.ts, picoflow/src/picoflow/utils/tool-response.ts, picoflow-demo/src/myflow/hotel-flow/, picoflow-demo/src/myflow/hotel-langgraph/
---

The supplied architecture brief is right about the central distinction, after updating its
older API examples: PicoFlow authors a multi-turn conversation around `Flow` and `Step`; LangGraph
authors a state graph around nodes and routing.

## The two authoring shapes

```text
PicoFlow                         Direct LangGraph hotel example

Flow                              StateGraph(state)
  currentStep                       START -- conditional route --> agent node
  Step: prompt + tools + state       agent node --> tool node | END
  tool result --> go/stay/direct     tool node --> next agent | END
```

`HotelFlow` registers `ExploreStep`, `PresentStep`, and `CompareStep`. The active step name is
persisted in `flow.currentStep`; a tool handler returns `go(TargetStep)`, `stay(...)`, or
`direct(...)`. The framework applies the transition, state, feedback, or direct message.

The direct hotel graph defines three agent nodes, three tool nodes, and conditional edges after
each. Its state carries both business data and runtime-routing fields such as `phase`, `route`,
and `inputConsumed`. This is transparent and flexible, but those fields and every edge are
application responsibilities.

## The same state machine, different decomposition

| Responsibility | PicoFlow module | Direct LangGraph location |
| --- | --- | --- |
| Default and per-stage models | `hotel-flow.ts` | constructor model factory and `createOpenAiModel()` |
| Criteria prompt and search | `ExploreStep` | `exploreAgent` plus `exploreTools` |
| Results, booking, and branch selection | `PresentStep` | `presentAgent` plus `presentTools` |
| Comparison and return | `CompareStep` | `compareAgent` plus `compareTools` |
| Terminal behavior | shared `TerminateSessionStep` | repeated `terminate_session` branches plus `terminateUpdate()` |
| Cursor | framework `flow.currentStep` | application `phase` and `route` |
| Agent/tool loop | PicoFlow `LlmRunner` | graph nodes and conditional edges |
| Session lifecycle | `FlowEngine` and `FlowSession` | `HotelLanggraph.run()` and `HotelSessionStore` |

PicoFlow decomposes by business stage and inherits infrastructure. The direct implementation
decomposes some concerns into helper files, but its 1,063-line `HotelLanggraph` class remains
the integration point for topology, prompts, tools, models, validation, domain operations,
response creation, and session lifecycle.

That monolith is not a LangGraph requirement. Agent nodes, tool nodes, validators, and state
updates could be split by stage. The architectural question is what shared convention replaces
the current class when the application adds its second and third graphs.

## Where routing lives

PicoFlow has no declarative edge table. Routing is ordinary TypeScript colocated with the tool
or response handler that knows the business rule:

```ts
if (!hotel) return stay("No hotel found; adjust the criteria.");
return go(PresentStep).withState({ hotelFound: hotel });
```

In LangGraph, a conditional edge selects the next named node. A current alternative is to return
a `Command`, which combines a state update with `goto`. Neither representation is inherently
more expressive: the trade-off is whether topology should be a first-class graph artifact or a
local part of a stage's domain code.

The direct graph currently combines both approaches indirectly. Tool nodes return a `route`
field, then the shared `routeAfterTools()` conditional edge reads it. A `Command({ update,
goto })` could remove that transient routing channel, but would couple each tool node directly
to destination node names. The existing form centralizes the edge map at the cost of persisting
`route` in the custom session document.

## One HTTP turn versus one graph execution

PicoFlow restores one session, starts at `currentStep`, and may recursively call models and
tools until it has a user-facing response. The internal call stack—not a public graph
scheduler—owns those within-turn transitions.

The direct implementation manually restores its document, passes the hydrated state into
`compiledGraph.invoke()`, and always enters at `START`. A conditional entry edge derives the
first agent from `phase`. The graph may traverse several agent/tool nodes in one HTTP turn and
stops at `END` when it has a response.

This has an important consequence: `END` does not mean that the hotel conversation is
complete. It usually means only that this HTTP turn is complete. Durable conversation
completion is the separate `completed` flag plus `phase: "terminal"`. PicoFlow has a similar
distinction between returning a turn response and entering its terminal step, but the framework
encapsulates it.

## Static topology and dynamic behavior

The direct graph's six nodes and conditional edges can be inspected or visualized as topology.
That is useful when reviewing loops and possible destinations. However, important behavior
still lives outside the edge diagram:

- `routeFromPhase()` decides the entry node;
- `hasToolCall()` decides whether an agent ends the turn or enters a tool node;
- each tool node mutates both `phase` and `route`;
- `inputConsumed` controls whether the original user input appears in the next model call; and
- `completed` overrides normal phase routing.

PicoFlow's application topology is less directly visualizable because transitions are returned
from handlers. In exchange, the route, forwarded message, target state, and exact response can
be read together at the business decision point.

## Extension cost: add a “review booking” stage

In PicoFlow the normal change is a new `ReviewStep`, registration in `defineSteps()`, and
`go(ReviewStep)` outcomes from relevant handlers. The shared engine already knows how to run,
persist, log, and restore it.

In the direct implementation the change normally touches the phase and route unions, state
defaults, tool declarations, stage tool map, model record and factory, graph nodes, conditional
edge destinations, one or more tool dispatchers, prompts, message arrays, serialization, and
tests. LangGraph permits a cleaner modular design, but the application must establish it.

## Practical choice

Choose PicoFlow's shape when a flow benefits from named responsibilities—collect, validate,
present, compare, and finish—and from composing nested, sequential, parallel, and tool-driven
work through ordinary steps. Choose direct LangGraph when explicit graph topology, custom
reducers, or scheduler-level control are the primary design objects.

The strongest use case for PicoFlow is a portfolio of similarly shaped multi-turn assistants
whose teams benefit from one lifecycle, while its stack-based step composition also serves
one-turn and background orchestration. Direct LangGraph is a good fit when the team wants its
graph semantics—parallel branches, checkpointed tasks, interrupts, subgraphs, or unusual state
reduction—to remain the primary application model.

Do not copy the reference HTML's constructor or model-configuration snippets verbatim. The
current PicoFlow API uses `defineSteps()`/`initialStep()` to choose the cursor and
`configModel()` for a flow default; `useModel()` is a `Step` API.
