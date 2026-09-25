---
layout: layouts/ezgraph.njk
title: 2. Graph, state, and ownership
description: Read QuoteGraph's graph definition and topology, its typed node-state registry, and a table of who writes and reads every durable value.
permalink: /ezgraph/docs/tutorials/quote-graph/graph-and-state/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 2. Graph, state, and ownership

`QuoteGraph` has no shared "current quote" object that every stage edits. Each accepted fact lives
in the state channel of the node that validated it, and the registry of those channels is the only
state shape the graph has. This lesson reads the two files that define the graph and its state.

## The goal

- Read a complete `GraphDefinition` and know what each field controls.
- Register a topology in which every transition is a runtime choice.
- Declare domain types once and build the node-state registry from them.
- Know which node writes each value, by which mechanism, and who reads it.

## The graph definition

From `quote-graph.ts`:

```ts
const DEFAULT_IDLE_MS = 30 * 60_000;

export class QuoteGraph extends BaseGraph<QuoteGraphStateType> {
  static getGraphDefinition(): GraphDefinition {
    return {
      llmConfig: ModelCatalog.model("openai:gpt-5.4", {
        retries: 3,
        reasoningEffort: "low",
      }),
      endNode: GRAPH_END_NODE,
      initialHistorySpace: "quote-intake",
      historySpaces: [
        [DriverNode, "quote-intake"],
        [VehicleNode, "quote-intake"],
        [HistoryNode, "quote-incidents"],
        [CoverageNode, "quote-intake"],
        [QuoteNode, "quote-present"],
        [TerminateSessionNode, "quote-terminal"],
      ],
    };
  }

  constructor(llmGateway: LlmGateway) {
    super(llmGateway, QuoteGraph.getGraphDefinition());
  }
  // onRestoreSessionDoc() and buildGraph() below
}
```

| Field | Value | Effect |
| --- | --- | --- |
| `llmConfig` | `openai:gpt-5.4`, three retries, `reasoningEffort: "low"` | The default model for every node. `ModelCatalog.model()` checks the parameters against the model's catalog entry, so a parameter the model does not accept is a type error. |
| `endNode` | `GRAPH_END_NODE` (`"end"`) | The `currentNode` value of a completed session |
| `initialHistorySpace` | `quote-intake` | Where a new session's first message goes |
| `historySpaces` | four spaces | Which conversation each node reads and appends to; see [lesson 7](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/) |

Everything else uses the framework defaults: eight model-and-tool rounds per node invocation, no
per-request timeout, an internal `"Start"` message to seed an empty history, and two nudges
after an empty model reply. `GraphEngine` constructs the graph and passes it a gateway for this
model; the graph never sees provider credentials.

<div class="callout"><span class="label">A stale source comment</span><p>The class comment says model authentication uses “the local Codex OAuth session”. That is the separate <code>openai-auth</code> provider. This graph selects <code>openai:gpt-5.4</code>, which goes through the application's <code>openai</code> provider and its <code>OPENAI_API_KEY</code>, as registered in <code>app.module.ts</code>.</p></div>

## Topology

```ts
protected buildGraph() {
  const graph = this.createStateGraph(QuoteGraphState);
  graph.registerTurnNodes(
    DriverNode, VehicleNode, HistoryNode, CoverageNode, QuoteNode, TerminateSessionNode,
  );
  graph.addEdge(TerminateSessionNode, END);
  return graph.compile();
}
```

`registerTurnNodes()` adds each class to the graph and to the START branch that resumes a later
turn at the persisted `currentNode`. Registration is also an allowlist: a handler can only
`go()` to a registered class. The one fixed edge connects `TerminateSessionNode` to `END`. Forward
moves, the backward move from `QuoteNode` to `CoverageNode`, and completion are all builders a
handler returns at run time.

`compile()` validates every node before the graph can serve a turn. Each `@Tool` handler must
match a tool some node defines, and no tool may be defined twice. `ConversationNode` inherits a
`terminate_session` handler, which is why `TerminateSessionNode`, the node that defines that tool,
must be registered even though no forward edge leads to it.

## Domain types first

`quote-graph.state.ts` starts with the business vocabulary, independent of EZGraph:

```ts
export type DriverProfile = {
  fullName: string;
  dateOfBirth: string;        // YYYY-MM-DD
  licenseState: string;       // two-letter U.S. state code, uppercase
  licenseStatus: "valid" | "permit";
  yearsLicensed: number;
};

export type VehicleUse = {
  vehicleId: string;          // catalog ID resolved during the vehicle stage
  ownership: "own" | "finance" | "lease";
  annualMileage: number;
  parking: "garage" | "driveway" | "street";
};

export type InsuranceHistory = {
  currentlyInsured: boolean;
  coverageLapse: boolean;
  incidents: { type: IncidentType; date: string }[];   // YYYY-MM, last five years
};

export type CoverageSelection = {
  liability: "state-minimum" | "standard" | "premium";
  collisionDeductible: 250 | 500 | 1000 | null;        // null = no collision coverage
  comprehensiveDeductible: 250 | 500 | 1000 | null;
  extras: ("rental" | "roadside")[];
  startDate: string;          // YYYY-MM-DD, today through +60 days
};

export type QuoteTier = {
  tier: "saver" | "selected" | "shield";
  coverage: CoverageSelection;
  monthlyPremium: number;
};
```

The types encode decisions the rest of the code relies on. `licenseStatus` has no `"suspended"`:
the driver tool's schema accepts it so the handler can refuse it politely, but a saved driver can
never be suspended. `null` deductibles mean "no coverage", which is how the lender rule is
expressed.

## The state registry

```ts
export type QuoteGraphNodes = {
  DriverNode?: NodeStateValue<{ driver?: DriverProfile }>;
  VehicleNode?: NodeStateValue<{ resolvedVehicleId?: string; vehicle?: VehicleUse }>;
  HistoryNode?: NodeStateValue<{ history?: InsuranceHistory }>;
  CoverageNode?: NodeStateValue<{ coverage?: CoverageSelection }>;
  QuoteNode?: NodeStateValue<{
    tiers?: QuoteTier[];
    acceptedTier?: QuoteTierName;
    referenceNumber?: string;
  }>;
};

/** Domain state owned by one quote node, excluding framework metadata. */
export type QuoteGraphNodeState<NodeName extends keyof QuoteGraphNodes> = Omit<
  NonNullable<QuoteGraphNodes[NodeName]>,
  "model"
>;

export const QuoteGraphState = createGraphStateAnnotation(
  DriverNode.name,
  () => ({}) as QuoteGraphNodes,
);

export type QuoteGraphStateType = typeof QuoteGraphState.State;
```

- The first argument to `createGraphStateAnnotation()` makes `DriverNode` the entry node of every
  new session.
- `NodeStateValue<...>` adds framework metadata to each channel, such as the `model` a node used
  when it overrides the graph default.
- `QuoteGraphNodeState<"VehicleNode">` strips that metadata for handler code. Nodes extend
  `ConversationNode<QuoteGraphStateType>` with a single generic, so where a handler needs the exact
  channel type it casts once: `this.getState() as QuoteGraphNodeState<"VehicleNode">`.

## Who writes what

| Value | Owner | Written by | Read by |
| --- | --- | --- | --- |
| `driver` | `DriverNode` | `capture_driver`, with `saveState()` | `buildRatingSubject()`; `VehicleNode`'s entry prompt |
| `resolvedVehicleId` | `VehicleNode` | `resolve_vehicle`, when exactly one vehicle matches | `VehicleNode`'s prompt and `capture_vehicle_use` |
| `vehicle` | `VehicleNode` | `capture_vehicle_use` | `CoverageNode`'s prompt and handler; `buildRatingSubject()` |
| `history` | `HistoryNode` | `capture_history` | `buildRatingSubject()` |
| `coverage` | `CoverageNode` | `select_coverage`; **also `adjust_quote` in `QuoteNode`**, with `graph.saveNodeState()` | `adjust_quote`, as the base for the next change |
| `tiers` | `QuoteNode` | `select_coverage` in `CoverageNode`, with `graph.saveNodeState()`; `adjust_quote` | `QuoteNode`'s prompt; `accept_quote` |
| `acceptedTier`, `referenceNumber` | `QuoteNode` | `accept_quote` | the tests |

Two cross-node writes stand out, and both happen inside a tool handler rather than on a transition:

- `CoverageNode` seeds `QuoteNode.tiers` before it returns `go(QuoteNode)`. That is the classic
  hand-off: the target starts with exactly the list it may present. `go(QuoteNode).withState({
  tiers })` would express the same thing on the transition itself.
- `QuoteNode` writes `CoverageNode.coverage` on every adjustment. The customer's coverage really
  has changed, and a later `revise_coverage` should start from it. But it means two nodes write one
  value, so the registry's "one owner" is a convention rather than a guarantee.

<div class="callout"><span class="label">When two nodes write one value</span><p>Shared writes are easy to miss in review. If you keep them, name them in a comment at both call sites, as a table like the one above does. The alternative is to keep an adjusted selection in <code>QuoteNode</code>'s own channel and have <code>CoverageNode</code> read it when the customer revises. That is more code, but each value then has a single writer.</p></div>

## Why it is written this way

When `DriverNode` saves a validated driver, no other stage has to infer from the transcript which
name or birth date was accepted. The rating engine reads committed channels, tests assert them
directly, and a customer's correction to coverage cannot silently change their driver record.
Domain types in the state file give every one of those readers the same vocabulary.

## Common mistakes

- **One shared mutable "quote" object.** It makes every stage responsible for every field; keep one
  channel per stage.
- **Forgetting `TerminateSessionNode`.** A graph with a `ConversationNode` fails to compile without
  it.
- **Casting state on every line.** Cast once to `QuoteGraphNodeState<...>` at the top of a handler.
- **Cross-node writes without a note.** Document every place a node writes another node's channel.
- **Credentials in the graph.** The graph names a model; the application registers providers and keys.

## Next

Continue to [3. Anatomy of a conversation turn](/ezgraph/docs/tutorials/quote-graph/conversation-turn-anatomy/).
