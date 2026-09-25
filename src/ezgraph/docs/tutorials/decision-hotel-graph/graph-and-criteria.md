---
layout: layouts/ezgraph.njk
title: 2. Graph, state, and history spaces
description: Define DecisionHotelGraph's chat and decision models, its node-state registry, who writes each durable value, and why the graph uses three history spaces.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/
ezgraph: true
ezgraphDocument: true
---

# 2. Graph, state, and history spaces

Before any node runs, `DecisionHotelGraph` has already fixed three things: which models it may
call, which node owns each durable value, and which nodes share a conversation. This lesson reads
the two files that decide all three.

## The goal

- Configure a chat model and a decision model side by side in one `GraphDefinition`.
- Write a state registry in which every durable value has exactly one owner.
- Know which mechanism writes each value, and which nodes read it.
- Choose history spaces deliberately, knowing that decision nodes read their input from them.

## The graph definition

From `decision-hotel-graph.ts`:

```ts
export class DecisionHotelGraph extends BaseGraph<DecisionHotelGraphStateType> {
  static getGraphDefinition(): GraphDefinition {
    return {
      llmConfig: ModelCatalog.model("openai:gpt-4o", {
        retries: 2,
        temperature: 0,
      }),
      decisionConfig: {
        provider: "typesafe",
        model: "jev-latest",
        timeoutMs: 15_000,
        maxRetries: 2,
      },
      endNode: GRAPH_END_NODE,
      llmTimeoutMs: 60_000,
      initialHistorySpace: "hotel-intake",
      historySpaces: [
        [RouterDecisionNode, "hotel-intake"],
        [DateRangeNode, "hotel-intake"],
        [BudgetNode, "hotel-intake"],
        [RoomTypeNode, "hotel-intake"],
        [AmenityNode, "hotel-intake"],
        [DistanceNode, "hotel-intake"],
        [CriteriaReadinessDecisionNode, "hotel-intake"],
        [PresentNode, "hotel-present"],
        [PresentationDecisionNode, "hotel-present"],
        [TerminateSessionNode, "hotel-terminal"],
      ],
    };
  }
  // ...
}
```

| Field | Value | Who uses it |
| --- | --- | --- |
| `llmConfig` | `openai:gpt-4o`, two retries, `temperature: 0` | Every `ConversationNode` and `TerminateSessionNode`. `PresentNode` adds `forceToolCalls` on top. |
| `decisionConfig` | Jev (`typesafe` / `jev-latest`), 15-second attempts, two extra attempts | All three `DecisionNode`s. None overrides it with `getDecisionConfig()`. |
| `llmTimeoutMs` | 60 seconds | Each chat-model request. Decision calls use `decisionConfig.timeoutMs` instead. |
| `initialHistorySpace` | `hotel-intake` | A brand-new session's first message, before any node owns the turn |
| `historySpaces` | three spaces | Which conversation each node reads and appends to |

The two model configurations never mix. A decision node that returned a non-empty
`getLlmConfig()` would fail at compile time, and a conversational node never reads
`decisionConfig`. Credentials are not here either: the application registers the chat providers
and `DecisionProvider.create({ typesafe: { apiKey } })` in `app.module.ts`.

## A registry that breaks an import cycle

Above the class, the graph file runs one statement at module load:

```ts
CriteriaHelper.registerCriteriaNodes({
  dates: DateRangeNode,
  budget: BudgetNode,
  room_type: RoomTypeNode,
  amenities: AmenityNode,
  distance: DistanceNode,
});
```

The router, the readiness judge, and the search node all need to ask "which node owns the `budget`
criterion?" If `criteria-helper.ts` imported the five collector classes directly, it would create
a cycle: each collector imports `RouterDecisionNode`, and the router imports `CriteriaHelper`. The
graph file already imports every node, so it hands the mapping to the helper once, and
`CriteriaHelper.nextNode(field)` looks it up at run time.

<div class="callout warn"><span class="label">A side effect to know about</span><p>The mapping exists only after <code>decision-hotel-graph.ts</code> has been imported. A unit test that imports <code>RouterDecisionNode</code> on its own and drives it will fail with <code>Criteria node is not registered for field: …</code>. Import the graph, as the demo tests do, or register the mapping in the test.</p></div>

## Topology

```ts
protected buildGraph() {
  const graph = this.createStateGraph(DecisionHotelGraphState);
  graph.registerTurnNodes(
    RouterDecisionNode, DateRangeNode, BudgetNode, RoomTypeNode, AmenityNode,
    DistanceNode, CriteriaReadinessDecisionNode, SearchHotelsNode, PresentNode,
    PresentationDecisionNode, TerminateSessionNode,
  );
  graph.addEdge(TerminateSessionNode, END);
  return graph.compile();
}
```

`registerTurnNodes()` does two things. It adds every class to the graph, which is the allowlist
that `go()` and `directTo()` targets are checked against. It also adds each class to the START
branch that resumes a later turn from the persisted `currentNode`. The only fixed edge is
`TerminateSessionNode → END`. Every other transition is a builder returned at run time.

Registering all eleven nodes as turn nodes is the simplest correct choice, but only seven of them
can actually be the resume point: the router, the five collectors, and `PresentNode`. The
readiness judge, the search node, and the presentation judge always hand the turn to another node.
A stricter graph could call `graph.nodes(...)` for all eleven and `graph.registerTurns(...)` for
the resumable ones.

`compile()` also validates every node. For the three decision nodes that means resolving the
`typesafe` provider from the engine, so a missing provider registration fails at startup rather
than on a customer's first turn.

## The state registry

From `decision-hotel-graph.state.ts`:

```ts
export type DecisionHotelGraphNodes = {
  RouterDecisionNode?: NodeStateValue<{
    notice?: string | null;
    lastRoute?: string;
    lastDecision?: object;
  }>;
  DateRangeNode?: NodeStateValue<{ answered?: boolean; start?: string | null; end?: string | null }>;
  BudgetNode?: NodeStateValue<{ answered?: boolean; min?: number | null; max?: number | null }>;
  RoomTypeNode?: NodeStateValue<{ answered?: boolean; roomType?: "one bed" | "two beds" | "suite" | null }>;
  AmenityNode?: NodeStateValue<{ answered?: boolean; amenities?: string[] }>;
  DistanceNode?: NodeStateValue<{ answered?: boolean; airport?: number | null; cityCenter?: number | null }>;
  CriteriaReadinessDecisionNode?: NodeStateValue<{ review?: object; accepted?: boolean }>;
  PresentNode?: NodeStateValue<{
    hotelFound?: SearchHotelEntry[];
    criteria?: HotelCriteriaSnapshot;
    criteriaReviewAccepted?: boolean;
    draft?: string;
    selectedHotel?: string;
    confirmationNumber?: number;
  }>;
  PresentationDecisionNode?: NodeStateValue<{ review?: object; accepted?: boolean }>;
};

export const DecisionHotelGraphState = createGraphStateAnnotation(
  RouterDecisionNode.name,
  () => ({}) as DecisionHotelGraphNodes,
);
```

The first argument makes `RouterDecisionNode` the entry node of every new session. The decision
nodes appear in the registry like any other node: a `DecisionNode` has a state channel,
`saveState()`, and `graph.saveNodeState()` exactly as a `ConversationNode` does.

### `answered` separates "no preference" from "not asked"

Every collector channel has an `answered` flag, because the business values alone are ambiguous.
`{ min: null, max: null }` could mean the customer said "any budget" or that nobody has asked yet.
The collectors save `answered: true` together with `null` limits or an empty amenity list for an
explicit "no preference". `CriteriaHelper.validateCriteria()` treats only a missing `answered` as
unresolved.

## Who writes what

| Value | Owner | Written by | Read by |
| --- | --- | --- | --- |
| dates, budget, room type, amenities, distance | the five collectors | each collector's capture tool, with `saveState()` | `CriteriaHelper.readCriteria()` in the router, the readiness judge, and the search node |
| `notice` | `RouterDecisionNode` | `SearchHotelsNode`, with `go(RouterDecisionNode).withState({ notice })` | the router, which shows it once and clears it |
| `lastRoute`, `lastDecision` | `RouterDecisionNode` | the router's `onDecision()` | nothing; diagnostic only |
| `review`, `accepted` | `CriteriaReadinessDecisionNode` | its `onDecision()` | `SearchHotelsNode` copies `accepted` forward |
| `hotelFound`, `criteria`, `criteriaReviewAccepted` | `PresentNode` | `SearchHotelsNode`, with `go(PresentNode).withState(...)` | `PresentNode`'s prompt and `chosen_hotel`; the presentation judge's facts and fallback |
| `draft` | `PresentNode` | the `publish_hotel_draft` tool | the presentation judge |
| `review`, `accepted` | `PresentationDecisionNode` | its `onDecision()` | nothing; diagnostic only |
| `selectedHotel`, `confirmationNumber` | `PresentNode` | the `chosen_hotel` tool | the tests |

Two patterns are worth copying. First, nodes write *other* nodes' channels only through
`withState()` on a transition: the search node seeds `PresentNode` and sends a notice to the
router, but it never edits a collector's criteria. Second, several values are kept purely for
diagnosis. `lastDecision` and both `review` values store Jev's complete answers, including every
probability.

<div class="callout"><span class="label">Answers in node state are an application choice</span><p>EZGraph's own decision audit, <code>SessionDocument.decisions</code>, never stores prompts, questions, facts, or answers. This graph chooses to persist answers in node state, so they are saved in the session document like any other business state. That is useful for debugging a routing decision. If answers could reveal something sensitive about a customer, leave them out of node state.</p></div>

## History spaces

| Space | Nodes | Why |
| --- | --- | --- |
| `hotel-intake` | the router, the five collectors, the readiness judge | They are one conversation about criteria. The router and the readiness judge read `request` and `priorRequests` from this space, so they see exactly what the collectors saw. |
| `hotel-present` | `PresentNode`, `PresentationDecisionNode` | Result presentation and booking. Hotel lists and booking talk stay out of the criteria conversation. |
| `hotel-terminal` | `TerminateSessionNode` | A goodbye generated only when the customer asks to stop. |

History spaces matter more in a graph with decision nodes than in a purely conversational one. A
decision node's automatic input is "the newest human messages in *my* history space". Putting the
router in the same space as the collectors is what lets it classify the customer's latest message
no matter which collector was asking. Putting the presentation judge in `hotel-present` means its
`request` is a message the customer sent while looking at results, never a criteria answer.

A booking completes from `PresentNode` inside `hotel-present`; `hotel-terminal` is used only on the
`terminate_session` path.

## Why it is written this way

The state registry is the record of what the application knows; history is only what a node may
show a model. Keeping them apart is what makes an out-of-order correction safe. When a customer
changes their dates while the graph is asking about amenities, the date collector overwrites one
channel, and every later decision re-reads the snapshot. Nothing has to reconstruct the criteria
from the transcript.

## Common mistakes

- **Letting one node write another's business values directly.** Seed a target with
  `withState()` on the transition that enters it, or send it a message; do not reach into a
  collector's channel from the search node.
- **Using `null` alone to mean "no preference".** Without an `answered` flag, "any budget" and "not
  asked yet" look identical.
- **Putting a decision node in a history space it does not share with the conversation it
  judges.** Its `request` would be empty or stale.
- **Importing a node without the graph in a test.** The criteria-node mapping is registered by the
  graph module.
- **Expecting `decisionConfig` to hold credentials.** It selects a registered provider by ID; the
  key belongs to `DecisionProvider.create()` at the composition root.

## Next

Continue to [3. Anatomy of a decision node](/ezgraph/docs/tutorials/decision-hotel-graph/decision-node-anatomy/).
