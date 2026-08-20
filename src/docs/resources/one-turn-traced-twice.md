---
title: One turn, traced twice
eyebrow: Compare
lede: Follow “compare hotel 2, 5, and 8 on price” from HTTP request to rendered table in both implementations.
source: picoflow/src/picoflow/flow/llm-runner.ts, pico-demo/src/controllers/ai-controller.ts, pico-demo/src/controllers/ai-langgraph-controller.ts, pico-demo/src/myflow/hotel-flow/present-step.ts, pico-demo/src/myflow/hotel-flow/compare-step.ts, pico-demo/src/myflow/hotel-langgraph/hotel-langgraph.ts
---

A feature matrix can hide the engineering cost of one ordinary turn. This trace uses the
scenario request `compare hotel 2,5,8 on price`, issued while the user is looking at search
results.

## Before the request

Both implementations already hold the same essential domain data:

- the nine priced search results;
- the ordered hotel names shown to the user;
- the selected date range and per-day prices; and
- stage-specific model history for presenting results.

Their cursors differ. PicoFlow persists `flow.currentStep = "PresentStep"`. The direct graph
persists `phase = "present"`; each new HTTP turn enters the compiled graph at `START`, where
`routeFromPhase()` selects `presentAgent`.

## PicoFlow trace

```text
POST /ai/run
  -> FlowEngine.run({ flowName, userMessage, sessionId })
  -> restore and lock the PicoFlow session
  -> PresentStep.run(user message)
  -> model calls go_compare
  -> decorated PresentStep.go_compare(args)
  -> save selected names in CompareStep state
  -> go(CompareStep).withState(...).withMessage(original request)
  -> framework exits PresentStep and enters CompareStep
  -> CompareStep.onEnter() clears its prior visit's memory
  -> model calls generate_comparison
  -> decorated CompareStep.generate_comparison(args)
  -> fetch domain data and render Markdown
  -> direct(table) returns without another model call
  -> save the common session document with compare-and-swap
```

The application expresses the transition in its handler:

```ts
return go(CompareStep)
  .withState({ available_hotel: strAvailableHotel })
  .withMessage(this.getLastMessage());
```

PicoFlow supplies the remaining protocol: finding the decorated handler, matching tool-call
IDs, switching the cursor, applying destination state, delivering the forwarded message,
recognizing the direct response, serializing memory, and saving the session.

There are two model calls in the turn: one in `PresentStep` to recognize the transition and one
in `CompareStep` to choose the comparison tool. `direct()` prevents a third call after the
deterministic table is ready.

## Direct LangGraph trace

```text
POST /ai-langgraph/run
  -> HotelLanggraph.run({ userMessage, sessionId })
  -> custom store.get(sessionId), then hydrate messages
  -> compiledGraph.invoke(update, { recursionLimit: 50 })
  -> START conditional edge reads phase and selects presentAgent
  -> presentAgent calls the bound model
  -> conditional edge sees a tool call and selects presentTools
  -> presentTools manually dispatches go_compare
  -> validate selected names and update phase/route/message state
  -> conditional edge selects compareAgent
  -> compareAgent calls the bound model
  -> conditional edge selects compareTools
  -> compareTools validates generate_comparison, renders Markdown
  -> route = end sends execution to END
  -> serialize messages and custom store.set(document)
```

The equivalent transition is a state update:

```ts
return {
  compareMessages: new HumanMessage(
    "Choose hotels and one feature to compare.",
  ),
  availableHotels: available,
  selectedHotels: selected,
  phase: "compare",
  inputConsumed: false,
  response: "",
  route: "compareAgent",
};
```

The original request remains in `state.userInput`. `inputConsumed: false` tells
`compareAgent` to append it to the comparison history, while the synthetic message establishes
the new stage. Again there are two model calls; `compareTools` places the deterministic table
directly in `state.response` and routes to `END`.

## What the trace reveals

| Concern | PicoFlow | Direct LangGraph |
| --- | --- | --- |
| Durable cursor | `currentStep` | `phase` |
| Within-turn cursor | Framework execution stack | `route` plus conditional edges |
| Input forwarding | `withMessage(...)` | `userInput`, `inputConsumed`, synthetic message |
| Tool dispatch | Framework finds decorated handler | Tool node branches on `call.name` |
| Destination state | `withState(...)` | Node update object |
| Exact response | `direct(...)` | `response` update plus `route: "end"` |
| Persistence | Framework session save | Application serialization and store write |

The direct version is more mechanically visible: every state update and route can be stepped
through locally. PicoFlow is more semantically compact: the application says what transition
means and delegates the execution protocol. That is the core trade-off repeated throughout the
larger comparison.

## Latency and model cost

For this turn the orchestration choice does not change the dominant model cost: both make two
serial model calls before returning the table. The direct graph does not become faster merely
because it has explicit nodes, and PicoFlow does not remove an inference merely because its
transition syntax is shorter.

PicoFlow may make an additional summary-model call when the configured explore memory crosses
its compaction threshold; that work does not occur in this comparison turn. The direct graph
never summarizes, trading lower immediate summarization cost for histories that grow without a
bound.

Measure model calls, tokens, tool latency, storage round trips, and p95 end-to-end latency per
user intent. Source lines are an ownership metric, not a runtime-performance benchmark.
