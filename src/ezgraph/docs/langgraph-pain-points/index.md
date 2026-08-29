---
layout: layouts/ezgraph.njk
title: LangGraph pain points and the EZGraph application layer
description: A reproducible comparison of direct LangGraph application code and EZGraph's conversational application layer.
permalink: /ezgraph/docs/langgraph-pain-points/
ezgraph: true
ezgraphDocument: true
---

# The conversational application layer above LangGraph

EZGraph runs on LangGraph. The comparison here is not “LangGraph versus a different runtime”; it is the cost of writing a guided conversational application directly on the graph runtime versus using a shared application contract above it.

The measured application is Sequoia Auto Insurance quoting. Both implementations collect a driver, vehicle, history, and coverage; validate tool calls; rate in deterministic code; allow quote adjustments; accept a tier; maintain three history spaces; expire idle sessions; and offer termination. The domain backend, prompts, catalog, and clock helpers are shared by behavior and independently normalize to the same size.

## Results, recounted from the current source

The site count is generated against the current [ezgraph-demo](https://github.com/picoflowio/ezgraph-demo) checkout by `scripts/ezgraph-compare-metrics.mjs`. It removes blank lines, comment-only lines, and imports from the application files. Framework source is excluded on both sides.

| Scope | EZGraph `quote-graph` | Direct LangGraph `quote-langgraph` | Reduction |
| --- | ---: | ---: | ---: |
| **Framework-facing graph code** | **617** | **1,283** | **51.9%** |
| Shared domain backend | 287 | 287 | 0% — identical |
| NestJS controller | 47 | 74 | 36.5% |
| Graph code + controller | 664 | 1,357 | 51.1% |
| Raw graph code + controller | 924 | 1,588 | 41.8% |

The headline delta is **666 normalized lines**. It is one application, not a universal performance or productivity claim.

### Source-artifact breakdown

These are additive source files, so the arithmetic is independently checkable:

| Artifact | Direct LangGraph | EZGraph | Delta |
| --- | ---: | ---: | ---: |
| Main graph and all stage implementations | 980 | 551 | −429 |
| State definition and reducers | 83 | 66 | −17 |
| Session store: memory, SQLite, MongoDB, serialization | 177 | 0 | −177 |
| Standalone domain type module | 43 | 0 — types live with node state | −43 |
| **Total** | **1,283** | **617** | **−666** |

| EZGraph file | Normalized lines | Direct LangGraph file | Normalized lines |
| --- | ---: | --- | ---: |
| `quote-graph.ts` | 49 | `quote-langgraph.ts` | 980 |
| `quote-graph.state.ts` | 66 | `quote-langgraph.state.ts` | 83 |
| `nodes/driver.node.ts` | 81 | `quote-session-store.ts` | 177 |
| `nodes/vehicle.node.ts` | 110 | `quote-types.ts` | 43 |
| `nodes/history.node.ts` | 79 | | |
| `nodes/coverage.node.ts` | 71 | | |
| `nodes/quote.node.ts` | 161 | | |

## The current EZGraph contract

State starts with a typed registry that names the durable channel owned by each node. The graph converts that registry into its annotated LangGraph state.

```ts
export type SupportGraphNodes = {
  VerifyNode?: NodeStateValue<{ order?: Order }>;
  ReturnNode?: NodeStateValue<{ selectedLines?: ReturnLine[]; reason?: string }>;
  ApprovalNode?: NodeStateValue<{ refund?: Refund }>;
};
```

A node validates input and writes the fact where it becomes true:

```ts
this.saveState({ selectedLines, reason });
```

The reducer replaces that node channel. A handler then makes the next outcome explicit:

```ts
if (!reason) return stay("Ask the customer for a return reason.");
if (needsApproval(refund)) return go(ApprovalNode).withState({ refund });
return direct(renderApprovedRefund(refund));
```

There is no turn-context object, context-creation hook, synthetic tool result, outcome builder, or automatic outcome-router configuration. A normal `ConversationNode<GraphState>` uses the graph-state generic only.

| Return | Meaning |
| --- | --- |
| `stay(feedback)` | Keep the model in the current node; usually validation feedback. |
| `go(TargetNode)` | Move to a registered node in the current invocation. Use `.withState()` for an atomic target-state update. |
| `direct(content)` | Return an exact code-owned customer response: a price table, policy decision, ticket ID, or confirmation. |
| `finish(content)` | Complete the conversation with an exact final response. |

Use `withMessages()` for real messages or attachments and `withCleanup()` when cleanup belongs to the tool result.

## Repeated patterns, counted

The direct-LangGraph counts below are exact `ripgrep` counts in the current source tree. The EZGraph values are the current QuoteGraph implementation.

| Pattern | Direct LangGraph | EZGraph |
| --- | ---: | ---: |
| Manual `Schema.parse(call.args)` blocks | 8 | 0 |
| Tool-name dispatch comparisons | 14 | 0 |
| `terminate_session` handling sites in application graph code | 7 | 0 — built-in termination node |
| Explicit `route:` state writes | 16 | 0 |
| Hand-written reducer helpers / channels | 2 helpers × 17 channels | 0 |
| Hand-written session store implementations | 3 | 0 |
| Domain tool declarations | 8 | 8 |
| Explicit next-stage returns | state-route writes | 5 `go()` responses |
| Validation retry returns | ad hoc branches | 8 `stay()` responses |
| Code-owned terminal/presentation responses | ad hoc graph branches | 1 `direct()`, 1 `finish()` |

## Modularity: adding a sixth stage

| Addition | Direct LangGraph | EZGraph |
| --- | --- | --- |
| Add a `Discounts` stage between coverage and quote | 14 coordinated edits: stage union, history map, schema, tool wrapper, stage tools, model binding, agent, dispatch, nodes, routes, phase, and channels | 5 edits: node file, node-state registry key, history-space entry, node registration, and the upstream `go(QuoteNode)` target |

In EZGraph, prompt, tool schema, validation, durable state, and response behavior live together in the node; only the registry and graph topology are shared edit points.

## Reproduce the measurement

From the PicoFlow website checkout, with the sibling demo checkout present:

```bash
node scripts/ezgraph-compare-metrics.mjs
```

For the repeated-pattern counts:

```bash
cd ../ezgraph-demo
rg -c 'Schema\.parse\(call\.args\)' src/graphs/quote-langgraph/quote-langgraph.ts
rg -c 'call\.name ===|call\.name !==' src/graphs/quote-langgraph/quote-langgraph.ts
rg -c 'route: "' src/graphs/quote-langgraph/quote-langgraph.ts
rg -c '@Tool\(' src/graphs/quote-graph/nodes/*.ts
```

## Where direct LangGraph remains the right choice

Direct LangGraph is a strong choice when the work requires its lowest-level control: native mid-execution interrupts, custom state semantics outside this conversational contract, deeply bespoke graph scheduling, or a permissive dependency. EZGraph is deliberately narrower. It is useful when durable guided customer conversations are the recurring application shape.

Continue with the [small tutorial](/ezgraph/tutorial/), the [QuoteGraph walkthrough](/ezgraph/quote-graph/), or the [developer guide](/ezgraph/docs/developer-guide/).
