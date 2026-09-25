---
layout: layouts/ezgraph.njk
title: QuoteGraph tutorial
description: Build a durable car-insurance quote with node-owned state, validated tools, catalog lookup, deterministic rating, code-owned revisions, session expiry, and two tiers of tests.
permalink: /ezgraph/docs/tutorials/quote-graph/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# QuoteGraph tutorial

`QuoteGraph` is a guided car-insurance quote, not a toy conversation. It collects a driver, a
catalogued vehicle, an insurance history, and coverage choices. It calculates three quote tiers in
code, answers "what if" questions without a second model call, and completes only when the
customer accepts a tier from the current quote.

It is the track to read for the core EZGraph contract: `ConversationNode`s whose tool handlers
validate input, write durable state, and return `go()`, `stay()`, `direct()`, or `finish()`. There
are no decision nodes here; for those, read the
[DecisionHotelGraph track](/ezgraph/docs/tutorials/decision-hotel-graph/).

The implementation lives in
[`ezgraph-demo/src/graphs/quote-graph/`](https://github.com/picoflowio/ezgraph-demo/tree/main/src/graphs/quote-graph),
and its tests live in `ezgraph-demo/test/quote-graph/`. The same application is also written in
plain LangGraph in `src/graphs/quote-langgraph/`; the
[QuoteGraph case study](/ezgraph/compare/langgraph/quotegraph-case-study/) compares the two.

## The node graph

<figure>
  <img src="/assets/ezgraph/img/quote-graph.svg" width="1200" height="780" alt="QuoteGraph: DriverNode to VehicleNode, which resolves against the VehicleCatalog, to HistoryNode in its own history space, to CoverageNode, which rates the quote with the RatingEngine and enters QuoteNode; QuoteNode adjusts with direct(), revises back to CoverageNode, or accepts with finish().">
  <figcaption>Every arrow is a builder returned by a tool handler. The yellow boxes are plain TypeScript modules with no model and no EZGraph imports.</figcaption>
</figure>

The shape is a pipeline with one loop at the end:

1. **Four collection stages move forward.** Each saves its validated facts and returns `go()` to
   the next stage, which runs in the same turn. A rejected tool call returns `stay()` and the
   model asks again.
2. **Coverage is the pricing boundary.** `CoverageNode` validates the selection against vehicle
   ownership, calls the rating engine, seeds `QuoteNode` with the tiers, and enters it.
3. **The quote loops until it is accepted.** `adjust_quote` re-rates and replies with code-written
   text through `direct()`. `revise_coverage` goes back to `CoverageNode` with the customer's
   words. `accept_quote` checks the tier against the current list and completes with `finish()`.

## The six registered nodes

| Node | History space | Owns | What it demonstrates |
| --- | --- | --- | --- |
| `DriverNode` | `quote-intake` | `driver` | Schema plus calendar, age, state-code, and licence rules; the entry node |
| `VehicleNode` | `quote-intake` | `resolvedVehicleId`, `vehicle` | Two tools, lookup before capture, trim disambiguation, a prompt that reacts to entry |
| `HistoryNode` | `quote-incidents` | `history` | An isolated history space; month-precision date rules |
| `CoverageNode` | `quote-intake` | `coverage` | A lender rule, deterministic rating, and seeding another node's state |
| `QuoteNode` | `quote-present` | `tiers`, `acceptedTier`, `referenceNumber` | `direct()` answers, a backward route with a forwarded request, `finish()` |
| `TerminateSessionNode` | `quote-terminal` | nothing | Ending the conversation at the customer's request |

## Supporting files

Only the graph, state, and node files import from `@picoflow/ezgraph`. The backend and prompt
modules are plain TypeScript that a unit test can call directly.

| File | Responsibility |
| --- | --- |
| `quote-graph.ts` | Graph definition, idle-session policy, and topology |
| `quote-graph.state.ts` | Domain types, the node-state registry, and the generated LangGraph annotation |
| `backend/quote-clock.ts` | "Today" (pinnable with `QUOTE_GRAPH_CURRENT_DATE`) and strict date arithmetic |
| `backend/vehicle-catalog.ts` | Loads `data/vehicles.json` and searches it by year, make, model, and trim |
| `backend/rating-engine.ts` | Coverage validation, the rating subject, the risk factor, premiums, and tiers |
| `data/vehicles.json` | Twelve ratable vehicles with trim, body style, risk group, and MSRP |
| `prompt/quote-prompt.ts` | Loads the prompt files, fills `{{PLACEHOLDER}}` values, and holds the shared end-chat instruction |
| `prompt/role.md` | Persona, tone, and the termination rule shared by every stage |
| `prompt/driver.md`, `vehicle.md`, `history.md`, `coverage.md`, `quote.md` | One stage specification per node |

## What this track does and does not cover

| Feature | In QuoteGraph? |
| --- | --- |
| `ConversationNode` tools with Zod schemas and `@Tool` handlers | yes, all five stages |
| `go()`, `stay()`, `direct()`, `finish()` | yes |
| `withMessage()` stage instructions and a forwarded customer request | yes |
| Writing another node's state with `graph.saveNodeState()` | yes, `CoverageNode` and `QuoteNode` |
| Separate history spaces | yes, four spaces |
| A per-node model configuration with `getLlmConfig()` | yes, `QuoteNode` |
| Session expiry with `onRestoreSessionDoc()` | yes |
| A pinnable business clock | yes |
| `directTo()` | no; see the [DecisionHotelGraph track](/ezgraph/docs/tutorials/decision-hotel-graph/) |
| Decision nodes and Jev | no; see the DecisionHotelGraph track |
| File attachments and JSON response mode | no |
| Schema versions and migrations | no; the graph uses the default schema version 1 |

## The ten lessons

1. [A fifteen-turn live replay](/ezgraph/docs/tutorials/quote-graph/live-replay/) — the recorded
   quote, then the tools and transitions behind every turn.
2. [Graph, state, and ownership](/ezgraph/docs/tutorials/quote-graph/graph-and-state/) — the graph
   definition, the typed state registry, and who writes each value.
3. [Anatomy of a conversation turn](/ezgraph/docs/tutorials/quote-graph/conversation-turn-anatomy/) —
   what the engine, the node, and the agent loop do between a customer message and a reply.
4. [Prompts and stage handoffs](/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/) —
   prompt files, filled values, and three ways to start the next stage well.
5. [Validated collection](/ezgraph/docs/tutorials/quote-graph/validated-tools/) — schemas as the
   interface and code as the policy, in the driver and history stages.
6. [Catalog lookup and disambiguation](/ezgraph/docs/tutorials/quote-graph/vehicle-catalog/) —
   resolve a vehicle before capturing how it is used.
7. [Time, sessions, and history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/) —
   a pinnable clock, idle expiry, and four separate conversations.
8. [Deterministic rating](/ezgraph/docs/tutorials/quote-graph/deterministic-rating/) — coverage
   rules, the risk factor, and a worked premium from the replay.
9. [Revisions, direct responses, and acceptance](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/) —
   the quote loop: adjust, revise, and accept.
10. [Testing the whole quote](/ezgraph/docs/tutorials/quote-graph/testing/) — unit, graph, and
    session-policy tests, then the live semantic evaluation.

## Running it

```bash
cd ezgraph-demo
npm run test:quote-graph
npm run test2:quote-graph
```

The first script runs the deterministic suite with a scripted chat model; the provider-backed E2E
file it also matches is skipped. The second sets `USE_ENV=1 KEEP_SESSION=1`, runs the fifteen-turn
semantic scenario against the configured model provider, and keeps the session for inspection.

Both tiers pin `QUOTE_GRAPH_CURRENT_DATE` to `2027-06-01`, so ages, incident windows, start dates,
and premiums are identical on every run.

## Next

Start with [1. A fifteen-turn live replay](/ezgraph/docs/tutorials/quote-graph/live-replay/).
