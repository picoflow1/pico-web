---
layout: layouts/ezgraph.njk
title: DecisionHotelGraph tutorial
description: Build a durable hotel search and booking graph with Jev decision nodes, deterministic validation, grounded presentation, safe fallbacks, and a two-tier test strategy.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/
ezgraph: true
ezgraphDocument: true
---

# DecisionHotelGraph tutorial

`DecisionHotelGraph` is a multi-turn Portland hotel search and booking conversation. It is the
EZGraph port of PicoFlow's `DecisionHotelFlow`, and it is the track to read if you want to put a
**decision model** at the boundaries of a conversational application.

Three of its nodes are `DecisionNode`s backed by TypeSafe's
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), a non-generative model that
answers typed questions with probabilities and never writes prose. Five `ConversationNode`s
collect criteria with a chat model. One `GraphNode` searches and prices a local catalog without
any model at all. Application code decides what every answer means.

The implementation lives in
[`ezgraph-demo/src/graphs/decision-hotel-graph/`](https://github.com/picoflowio/ezgraph-demo/tree/main/src/graphs/decision-hotel-graph),
and its tests live in `ezgraph-demo/test/decision-hotel-graph/`.

## The node graph

<figure>
  <img src="/assets/ezgraph/img/decision-hotel-graph.svg" width="1200" height="760" alt="DecisionHotelGraph: RouterDecisionNode routes to five criterion collectors that return to it; an exact search goes through CriteriaReadinessDecisionNode to SearchHotelsNode; no matches return to the router with a notice; results enter PresentNode, which sends drafts to PresentationDecisionNode and books with finish().">
  <figcaption>Every arrow is a builder returned by application code: go(), directTo(), or finish(). Jev only ever picks a declared label.</figcaption>
</figure>

Three loops shape the whole conversation:

1. **Collect and return.** A collector saves its criterion and returns `go(RouterDecisionNode)`.
   The router runs again in the same turn and decides what to ask next. A collector that hears a
   request for a different criterion calls `reroute_request` and returns to the router without
   saving anything.
2. **Search and recover.** A search runs only after the router sees the literal word "search",
   deterministic validation passes, and the readiness judge agrees. An empty result returns to the
   router with a saved notice.
3. **Draft and review.** `PresentNode` never shows its own draft directly. It publishes the draft
   to `PresentationDecisionNode`, which hands back either that draft or a code-rendered list built
   from the saved search results.

## The eleven registered nodes

| Node | Kind | History space | Owns | What it demonstrates |
| --- | --- | --- | --- | --- |
| `RouterDecisionNode` | `DecisionNode` | `hotel-intake` | `notice`, `lastRoute`, `lastDecision` | Two choice questions, facts, a literal-search guard, forwarding a real request |
| `DateRangeNode` | `ConversationNode` | `hotel-intake` | `answered`, `start`, `end` | Calendar validation, and defining the shared `reroute_request` tool |
| `BudgetNode` | `ConversationNode` | `hotel-intake` | `answered`, `min`, `max` | Range validation with `null` meaning "no limit" |
| `RoomTypeNode` | `ConversationNode` | `hotel-intake` | `answered`, `roomType` | A Zod enum as the whole validation |
| `AmenityNode` | `ConversationNode` | `hotel-intake` | `answered`, `amenities` | Two capture tools, one for an explicit "no preference" |
| `DistanceNode` | `ConversationNode` | `hotel-intake` | `answered`, `airport`, `cityCenter` | Optional limits and negative-value rejection |
| `CriteriaReadinessDecisionNode` | `DecisionNode` | `hotel-intake` | `review`, `accepted` | A judge that cannot override deterministic validation |
| `SearchHotelsNode` | `GraphNode` | none (no model) | nothing | A model-free node that seeds the next node's state |
| `PresentNode` | `ConversationNode` | `hotel-present` | `hotelFound`, `criteria`, `criteriaReviewAccepted`, `draft`, `selectedHotel`, `confirmationNumber` | Forced tool calls, booking against a result list, a backward route |
| `PresentationDecisionNode` | `DecisionNode` | `hotel-present` | `review`, `accepted` | A grounding judge with a deterministic fallback rendering |
| `TerminateSessionNode` | framework | `hotel-terminal` | nothing | Ending the conversation at the customer's request |

## Supporting files

None of these files is a node. Apart from the graph and state files, the only framework import is
one type in `criteria-helper.ts`; the search and prompt modules are plain TypeScript.

| File | Responsibility |
| --- | --- |
| `decision-hotel-graph.ts` | Graph definition (chat model, `decisionConfig`, history spaces) and topology |
| `decision-hotel-graph.state.ts` | The node-state registry and generated LangGraph annotation |
| `criteria-helper.ts` | Reads the five collector channels into one snapshot, validates it, renders summaries and results, and maps each criterion to its node |
| `data/hotel-search.ts` | Loads and validates `hotels.json` with Zod, filters by criteria, and prices every night |
| `data/hotels.json` | Thirty-two Portland-area Hilton hotels with amenities, room types, a base price `level`, and distances |
| `prompt/hotel-prompts.ts` | Loads the nine prompt files and fills `{{PLACEHOLDER}}` values |
| `prompt/router.md`, `criteria-judge.md`, `presentation-judge.md` | Shared guidance for the three decision nodes |
| `prompt/date-range.md`, `budget.md`, `room-type.md`, `amenities.md`, `distance.md`, `present.md` | System prompts for the six conversational nodes |

## What this track does and does not cover

| Feature | In DecisionHotelGraph? |
| --- | --- |
| `DecisionNode` with Choice, Score, and Noul questions | yes, three nodes |
| `getPrompt()` guidance and `getDecisionFacts()` input | yes, all three decision nodes |
| Per-node `onDecisionError()` fallbacks | yes, all three decision nodes |
| `go()`, `directTo()`, `finish()`, `withState()`, `withMessage()` | yes |
| Shared and separate history spaces | yes, three spaces |
| A model-free `GraphNode` | yes, `SearchHotelsNode` |
| Forced tool calls with `forceToolCalls` | yes, `PresentNode` |
| Decision usage accounting and the sanitized audit log | yes |
| Deterministic tests with a hand-written decision adapter | yes, 23 turns |
| Graph-wide `BaseGraph.onDecisionError()` | no; every node handles its own failures |
| Per-node `getDecisionConfig()` overrides | no; all three nodes use the graph default |
| `direct()` | no; the graph uses `directTo()` throughout |
| Session expiry with `onRestoreSessionDoc()` | no; see the [QuoteGraph track](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/) |
| File attachments and JSON response mode | no |

## The ten lessons

1. [A sixteen-turn live replay](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/) — the
   recorded journey, then the node path and decision calls behind every turn.
2. [Graph, state, and history spaces](/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/) —
   the graph definition, the state registry, who writes what, and why three history spaces.
3. [Anatomy of a decision node](/ezgraph/docs/tutorials/decision-hotel-graph/decision-node-anatomy/) —
   exactly what happens between `defineQuestions()` and `onDecision()`.
4. [Questions, prompts, and thresholds](/ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/) —
   choosing question types, writing judge prompts, and where probabilities become policy.
5. [The router's policy](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/) — every
   branch of `RouterDecisionNode.onDecision()`, and forwarding a request.
6. [Criteria collectors and corrections](/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/) —
   five small conversational nodes, one shared reroute tool, and one criteria snapshot.
7. [Readiness and deterministic search](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/) —
   a judge that cannot override validation, and a search node with no model.
8. [Grounded presentation and booking](/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/) —
   draft, review, fallback rendering, and booking against the saved results.
9. [Fallbacks, usage, and cost](/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-cost/) —
   what fails over, what fails the turn, and where 22 decision calls came from.
10. [Testing decision graphs](/ezgraph/docs/tutorials/decision-hotel-graph/testing/) — the 23-turn
    deterministic contract, the catalog test, and the live semantic evaluation.

## Running it

```bash
cd ezgraph-demo
npm run test:decision-hotel-graph
npm run test2:decision-hotel-graph
```

The first script runs the deterministic suite with a scripted chat model and a hand-written decision
adapter; no credentials are needed. The second sets `USE_ENV=1 KEEP_SESSION=1` and runs the
sixteen-turn semantic scenario live. It is skipped unless `TYPESAFE_API_KEY` and `OPENAI_API_KEY`
are also set.

The deterministic suite pins `HOTEL_GRAPH_CURRENT_DATE` to `2026-01-15`; the live scenario pins it to
`2027-07-15`. Either way, dates, prices, and date validation are reproducible across runs.

## Next

Start with [1. A sixteen-turn live replay](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/).
