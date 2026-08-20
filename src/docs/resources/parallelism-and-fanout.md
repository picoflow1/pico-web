---
title: Parallelism and fan-out
eyebrow: Compare
lede: Both systems can run work concurrently; their main difference is whether concurrency is explicit helper-driven work or graph-scheduled work.
source: codex/pico-web/picoflow-langgraph.html, picoflow/src/picoflow/flow/flow.ts, picoflow/src/picoflow/flow/step.ts, pico-demo/src/myflow/basic-flow/basic-flow.ts
---

Concurrency is not a reason by itself to select either framework. The design question is where
the ownership of input, state updates, joins, and failure handling belongs.

<figure>
  <img src="/assets/img/parallel.png" alt="Diagram comparing PicoFlow's flow-level batch concurrency and nested step fan-out with LangGraph's topology-driven super-steps and dynamic Send fan-out." />
  <figcaption>PicoFlow makes the parent or step initiate and join concurrent work. LangGraph's scheduler can derive concurrent work from graph topology; concurrent writes to shared state need reducers.</figcaption>
</figure>

## PicoFlow: two scopes

`Flow.concurrentSteps()` batches independent flow executions through the application's own
endpoint and returns each result to the coordinating flow. It is appropriate when each item
needs its own flow request and configuration.

This helper is coordinator concurrency, not an internal graph branch. It slices items by
`batchSize`, calls the app through `SELF_URL`, and invokes callbacks with each response. Every
child is an independent flow request with its own session. Network routing, authentication,
timeouts, retry policy, and partial failures therefore matter even when parent and child run in
the same deployment.

`Step.runSteps()` fans out nested child steps within an active flow and aggregates their
responses. It is appropriate for bounded child work whose parent owns the result. Nested child
steps are intentionally restricted: they must not use tool-driven transitions such as `go`,
`stay`, or `direct`, because they execute inside the parent execution frame.

`runSteps()` uses `Promise.all`, rejects duplicate step classes in the same call, and fails the
whole aggregation when one child rejects. It does not provide per-child retries, cancellation,
or a persisted work queue. Child steps share the flow session and can mutate step state, so
parallel writers still need disjoint ownership or an intentional merge.

## LangGraph: scheduler-level branches

LangGraph can schedule multiple nodes in the same super-step through graph topology, and its
dynamic fan-out mechanisms can send work to downstream nodes. If branches update the same state
key, the graph state needs a reducer that defines the join.

Normal multiple outgoing edges schedule their destinations concurrently in the next
super-step. `Send` supports map/reduce-style dynamic fan-out where each destination receives a
different input. Reducers are not optional decoration in that design: they define whether
parallel results append, add, merge, replace, or conflict. See the current
[Graph API guide](https://docs.langchain.com/oss/javascript/langgraph/graph-api).

This makes parallelism visible in the graph itself, which is valuable when scheduling and joins
are central to the workflow. It also means state-channel and reducer choices are part of normal
graph authoring.

The direct hotel graph is sequential. Each agent routes to at most one tool node, and each tool
node routes to at most one next agent. Its append reducers have not been exercised under
parallel writes. LangGraph's capacity for parallel super-steps is therefore a framework
capability, not a benefit demonstrated by this particular implementation.

## Join and failure semantics

| Question | PicoFlow `concurrentSteps()` | PicoFlow `runSteps()` | LangGraph branch/`Send` |
| --- | --- | --- | --- |
| Unit of work | Independent flow HTTP request | Child step inside one flow | Graph node invocation |
| State ownership | Separate child session | Shared flow, separate step state | Shared or per-`Send` graph input |
| Join owner | Parent callbacks/application code | Parent receives `Promise.all` results | Scheduler plus state reducers |
| Durable progress | Whatever each child flow saves | Final parent session save | Checkpoints when configured |
| Partial failure policy | Parent callback/HTTP policy | `Promise.all` rejects | Graph retry/checkpoint/application policy |
| Dynamic fan-out | Input array | Explicit step request array | `Send` from routing logic |

## Backpressure and resource limits

None of the abstractions removes the need for limits. Bound concurrency by provider quotas,
database connections, tool capacity, and memory—not only CPU. Define what happens when one item
times out, whether successful siblings may commit, and how a caller observes partial progress.

For LLM work, parallelism can reduce wall-clock time while multiplying token spend and rate-
limit pressure. A deterministic tool fan-out and a model fan-out deserve different budgets.

## A useful rule

Use PicoFlow helpers when a parent stage owns a small, bounded aggregation or coordinates
independent flow requests. Use LangGraph fan-out when the graph runtime should own branching,
scheduling, and reduction. In both cases, make external effects idempotent: concurrent session
writes cannot undo an email, booking, or payment already sent to another system.
