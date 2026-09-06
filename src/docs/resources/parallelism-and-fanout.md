---
title: Parallelism and fan-out
eyebrow: Compare
lede: Contrast LangGraph's graph-wide supersteps with PicoFlow's parent-owned runSteps() barriers, including state visibility, nested work, and failure recovery.
source: picoflow/src/picoflow/flow/flow.ts, picoflow/src/picoflow/flow/step.ts, pico-demo/src/myflow/basic-flow/basic-flow.ts
---

**LangGraph coordinates graph nodes through supersteps. PicoFlow's `runSteps()` coordinates
children through explicit, nested fork/join calls owned by a parent Step.** Both use barriers
and controlled state merging; the main difference is who schedules work and how far each
barrier extends.

Concurrency alone does not decide which framework fits. Consider who owns inputs, when state
becomes visible, and what must survive a failure. The LangGraph comparison below concerns its
Graph API; its Functional API offers another authoring model, discussed below.

<figure>
  <img src="/assets/img/parallel.png" alt="Diagram comparing PicoFlow's flow-level batch concurrency and nested step fan-out with LangGraph's topology-driven super-steps and dynamic Send fan-out." />
  <figcaption>PicoFlow makes the parent or Step initiate and join concurrent work. LangGraph derives graph-node scheduling from topology and channel activity. Both provide reducers for compatible concurrent state updates.</figcaption>
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
responses. It is appropriate for bounded child work whose parent owns the result. Parallel child
Steps are intentionally restricted: they must not use tool-driven transitions such as `go`,
`stay`, or `direct`, because they execute inside the parent execution frame. A tool in such a
child may instead return `directResult(json)`: it stops that child after the tool call and
delivers the JSON value as the branch's `output`, with no second model call or cursor change.

`runSteps()` creates a fresh Step instance and private memory/state view per invocation, then
publishes validated state at an explicit join. The default `retain-successes` policy keeps
fulfilled state when a sibling fails; `atomic` makes application-state publication all-or-
nothing. Repeated Step classes use stable branch keys and Step-owned reducers. Bounded
concurrency and cooperative cancellation are built in, but this remains an in-process join,
not a persisted work queue.

## LangGraph: scheduler-level branches

LangGraph's Pregel runtime advances through three phases: select active nodes, execute them
concurrently, then apply their channel updates. Nodes in one superstep do not observe each
other's channel updates during execution. Those updates become available in the next
superstep. See the [Pregel runtime guide](https://docs.langchain.com/oss/javascript/langgraph/pregel).

Normal multiple outgoing edges schedule their destinations concurrently in the next
superstep. `Send` supports dynamic fan-out with a different input for each invocation. When
multiple nodes write the same state key in a superstep, its update contract must handle those
writes; a reducer can define how to combine them. See the
[Graph API guide](https://docs.langchain.com/oss/javascript/langgraph/graph-api).

This makes parallelism visible in the graph itself, which is valuable when scheduling and joins
are central to the workflow. It also means state-channel and reducer choices are part of normal
graph authoring.

The direct hotel graph is sequential. Each agent routes to at most one tool node, and each tool
node routes to at most one next agent. Its append reducers have not been exercised under
parallel writes. LangGraph's capacity for parallel super-steps is therefore a framework
capability, not a benefit demonstrated by this particular implementation.

## Who schedules the next operation?

| Execution question | LangGraph Graph API | PicoFlow `runSteps()` |
| --- | --- | --- |
| Who starts parallel work? | Runtime selects active nodes from topology and channel activity | Calling Step supplies an explicit request array |
| Where is the barrier? | Between supersteps of that graph | At one caller's `await runSteps(...)` |
| What happens after it? | Runtime selects the next active nodes | Caller continues its own code |
| How are dependent child operations expressed? | Separate graph nodes, or work encapsulated inside a node/subgraph | Sequential child calls or nested `runSteps()` inside a worker |

PicoFlow's join publishes selected child state and returns a `ParallelBatchResult` containing
`branches`, `fulfilled`, `rejected`, and publication metadata. The caller can inspect the
results, apply business policy, and call more Steps. Publication does not automatically
activate another Step. Parallel workers cannot change the durable Flow cursor; the top-level
owner retains that responsibility.

### Example: branches with different durations

Consider two independent sequences, ignoring scheduling, model, and storage overhead:

```text
Branch A: A1 (1 second)  -> A2 (1 second)
Branch B: B1 (10 seconds) -> B2 (1 second)
```

The following timing is a worked consequence of the execution models, not a benchmark. In
the flat LangGraph version, all four operations are separate nodes in the same graph. In the
PicoFlow version, the outer `runSteps()` launches two coordinator workers, each of which runs
its own sequence. Assume enough concurrency to start both branches immediately.

| Event | Flat LangGraph graph | PicoFlow with two coordinator workers |
| --- | --- | --- |
| At 0 seconds | A1 and B1 start in one superstep | A1 and B1 start in their respective workers |
| At 1 second | A1 finishes; A2 waits for the superstep barrier | A1 finishes; its coordinator starts A2 |
| At 2 seconds | B1 is still running | A finishes; B continues |
| At 10 seconds | B1 finishes; the next superstep starts A2 and B2 | B1 finishes; its coordinator starts B2 |
| At 11 seconds | A2 and B2 finish | B finishes; the outer caller resumes |

Both finish the illustrated work at 11 seconds. The difference is **when A's dependent work
can proceed**. Even in PicoFlow, putting A1 and B1 in one `runSteps()` and awaiting that batch
before starting A2 would make A2 wait for B1.

LangGraph can encapsulate a sequence inside a node or subgraph, changing where the outer
barrier applies. The example compares two decompositions, not a universal performance limit.
Its [Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api) also
supports ordinary control flow and asynchronous tasks on the same runtime. Procedural
orchestration is therefore available in both frameworks.

## State visibility and nested joins

PicoFlow creates a fresh worker and private state/memory view for every parallel invocation.
Workers may change their own Step state; shared Flow context and other Steps' state are
read-only. The runtime collects state-field updates and validates them at the join.

Suppose the outer caller starts B and C, and B later calls `runSteps()` for D and E:

| Boundary | What becomes visible? |
| --- | --- |
| B changes its own state before the inner fork | D and E inherit B's updated view |
| D and E execute | Each sees its own changes, but not its sibling's in-flight changes |
| D/E join successfully | Their selected state becomes visible to B; C retains its fork view |
| B finishes successfully and the outer join accepts its updates | B's and its descendants' selected state reaches canonical session state |
| B fails after its inner join | B's state and its descendants' updates are discarded |

Each caller owns the next operation after its join. Snapshot isolation and reducers govern
state publication at these local barriers; PicoFlow does not schedule a graph-wide frontier.

`saveState()` proposes replacement values. Competing replacements of the same Step field fail
with a conflict; declaring a reducer does not silently turn replacements into contributions.
Use `contributeState()` with a Step-owned reduced channel for values that should combine.
Contributions are reduced in request-path order, rather than completion order. Branch results
are also returned in request order.

See [Nested execution](/docs/guides/nested-execution/) for worker contracts, memory isolation,
and cancellation, and the [Step reference](/docs/reference/step/) for the API.

## Join and failure semantics

| Question | PicoFlow `concurrentSteps()` | PicoFlow `runSteps()` | LangGraph branch/`Send` |
| --- | --- | --- | --- |
| Unit of work | Independent flow HTTP request | Child step inside one flow | Graph node invocation |
| State ownership | Separate child session | Private invocation drafts; canonical session state at join | Shared or per-`Send` graph input |
| Join owner | Parent callbacks/application code | Explicit calling Step plus Step-owned reducers | Scheduler plus state reducers |
| Durable progress | Whatever each child flow saves | Outer turn save or optional root-join checkpoint | Checkpoints when configured |
| Partial failure policy | Parent callback/HTTP policy | `retain-successes` (default) or `atomic` | Graph retry/checkpoint/application policy |
| Dynamic fan-out | Input array | Explicit step request array | `Send` from routing logic |

### A failed branch and a process crash are different

In PicoFlow, an ordinary branch error appears in `batch.rejected`. The default
`retain-successes` policy publishes successful siblings' state. With `atomic`, a branch
failure suppresses application-state publication for that batch. Invalid shared mutation,
write conflicts, and reducer failures instead invalidate the barrier and throw. These policies
govern application state; diagnostic and token accounting can still record attempted work.

In LangGraph, an unhandled node failure fails the superstep without applying its state
updates. With a checkpointer, successful task results can be saved as pending writes and reused
on resume; failing nodes can have retry policies. Catching errors inside a node gives the
application another way to represent partial success. See
[parallel execution and exception handling](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api).

PicoFlow's default join updates canonical state in memory; the normal outer turn saves it.
`{ checkpoint: "root-join" }` requests a session save after a root join applies state.
Nested joins publish into their caller's private scope and do not save independently. The
current runtime has no per-child durable task ledger that automatically skips completed
children after a process crash. A root-join checkpoint preserves published state, but does not
persist an executable continuation of the parent's call stack.

Choose the recovery boundary deliberately: saving a completed business stage and recovering
individual tasks within an interrupted stage are different requirements. Neither framework's
state transaction reverses an external API side effect.

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
