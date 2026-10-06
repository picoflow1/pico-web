---
layout: layouts/ezgraph.njk
title: 7. Time, sessions, and history spaces
description: Pin QuoteGraph's business clock, expire idle sessions, choose history spaces, and persist shared runtime context.
permalink: /ezgraph/docs/tutorials/quote-graph/sessions-and-history/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 7. Time, sessions, and history spaces

A quote depends on time: the driver's age, which incidents fall inside five years, which start
dates are allowed, and whether a rate from yesterday is still valid. It also spans many turns, so
it matters what each stage remembers. This lesson covers a single business clock, an
idle-session policy, four history spaces, and shared runtime context.

## The goal

- Route every notion of "today" through one function you can pin.
- Expire a stale session from graph code, before the next turn runs.
- Give each stage the conversation it needs, and no more.
- Know which facts live in history and which in node state.
- Persist runtime metadata shared by coverage calculation and quote acceptance.

## Initialize the session store in AppModule

QuoteGraph uses the session store configured by its application.
[ezgraph-demo's `app.module.ts`](https://github.com/picoflowio/ezgraph-demo/blob/main/src/app.module.ts)
registers the graphs and model providers, reads database settings through
`ConfigService`, and supplies inline MongoDB and Cosmos SDK client factories as
`sessionClients` to `GraphEngine.create()`. Only the factory selected by
`SESSION_STORE` runs. For example, `SESSION_STORE=cosmos` uses the Cosmos factory
without requiring a MongoDB connection.

The application chooses key, service-principal, or other SDK authentication.
EZGraph handles session persistence through the selected client and releases
owned clients when the engine closes. See
[application-owned database initialization](/ezgraph/docs/developer-guide/state-context-and-history/#application-owned-database-initialization)
for the `app.module.ts` example, configuration, and cleanup rules.

## One clock

```ts
/** `QUOTE_GRAPH_CURRENT_DATE` pins "today" so prompts, validation, and tests stay reproducible. */
export function quoteNow(): Date {
  const configured = process.env.QUOTE_GRAPH_CURRENT_DATE;
  if (configured) {
    const pinned = new Date(configured);
    if (!Number.isNaN(pinned.getTime())) return pinned;
  }
  return new Date();
}
```

Every date decision in the graph calls `quoteNow()`:

| Where | Uses today for |
| --- | --- |
| `DriverNode` | the prompt's `{{CURRENT_DATE}}`; rejecting a future birth date; the age limits |
| `HistoryNode` | the prompt's `{{CURRENT_DATE}}`; rejecting future incidents and those older than 60 months |
| `CoverageNode` | the prompt's `{{CURRENT_DATE}}`; the start date window of today through 60 days |
| `RatingEngine` | the driver's age factor, whenever a quote is calculated or adjusted |

Both test tiers set `QUOTE_GRAPH_CURRENT_DATE=2027-06-01T00:00:00.000Z`. A birthday in April 1993
then always gives an age of 34, and a speeding ticket from March 2026 is always 15 months old.
Without the pin, the test's premium assertion of $140.43 would drift as the driver ages.

<div class="callout warn"><span class="label">A typo falls back to the real date</span><p>If <code>QUOTE_GRAPH_CURRENT_DATE</code> is set but cannot be parsed, <code>quoteNow()</code> quietly returns the real current time. A misspelled pin in CI shows up only as tests that start failing on some later date. Throwing on an unparsable value would surface the mistake at once. Note also that the prompts format today as a UTC date, which can differ from a U.S. customer's local date late in the evening.</p></div>

## Expiring an idle quote

```ts
const DEFAULT_IDLE_MS = 30 * 60_000;

/** Idle quote sessions start over; rates are not held indefinitely. */
protected override async onRestoreSessionDoc(
  sessionDoc: SessionDocument<QuoteGraphStateType>,
): Promise<SessionDocument<QuoteGraphStateType> | null> {
  if (this.idleMs(sessionDoc) >= readMs("QUOTE_GRAPH_IDLE_MS", DEFAULT_IDLE_MS)) {
    return null;
  }
  return sessionDoc;
}

function readMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
```

`GraphEngine` calls the graph's restore hook on every turn, after taking the session lease and
before hydrating state. `BaseGraph.restoreSessionDoc()` first checks that the document belongs to
this graph, applies any schema migrations, and then calls `onRestoreSessionDoc()`. The hook can
return the document unchanged, return a modified document, or return `null` to start a fresh run
under the same session ID.

`idleMs()` measures time since the document's `modifiedAt`. After 30 minutes, the default, or
`QUOTE_GRAPH_IDLE_MS` if set, the customer's next message starts a new quote at `DriverNode`. An
old quote's inputs and pricing window are never silently resumed.

Two consequences are easy to miss:

- **Completed sessions expire too.** The engine checks for completion *after* the restore hook.
  Within 30 minutes of accepting a quote, another message gets "This conversation is already
  complete." After that, the same session ID starts a brand-new quote. For a quote that is often
  what you want; for an audit trail, check `sessionDoc.status` in the hook first.
- **The policy is code, not prompt.** No model is asked to notice that the conversation is old.
  The hook runs before any node, and a unit test can call it with a hand-built document, as
  `quote-graph.spec.ts` does for 60 seconds, kept, and 45 minutes, reset.

## Four history spaces

```ts
historySpaces: [
  [DriverNode, "quote-intake"],
  [VehicleNode, "quote-intake"],
  [HistoryNode, "quote-incidents"],
  [CoverageNode, "quote-intake"],
  [QuoteNode, "quote-present"],
  [TerminateSessionNode, "quote-terminal"],
],
```

| Space | Nodes | Starts with | Why |
| --- | --- | --- | --- |
| `quote-intake` | Driver, Vehicle, Coverage | the customer's first message | One continuous conversation about the customer and their car. Coverage can see that the car was described as financed. |
| `quote-incidents` | History | "Collect the driving and insurance history." | Accidents and tickets are discussed apart from everything else, and they do not appear in later prompts. |
| `quote-present` | Quote | "Present the quote tiers." | Tier explanations and what-ifs get a short, focused context instead of the whole intake. |
| `quote-terminal` | TerminateSessionNode | the internal end-of-chat message | A brief goodbye with no earlier context. |

Each node's agent loop reads only its own space and appends only to it. Before appending
input, `prepareInput()` resolves the node that will handle the turn:

- A new session uses the state schema's initial `DriverNode` cursor, so the first
  customer message goes directly into `quote-intake`.
- A restored session uses its saved `currentNode`. A reply while `HistoryNode` is
  active goes into `quote-incidents`; a reply while `QuoteNode` is active goes into
  `quote-present`.
- A session reset by the idle policy starts again at `DriverNode`, with the new
  message in a fresh `quote-intake` history.

An unmapped node uses `"default"`. The initial node's mapping controls the first
message, and registration order does
not affect it. Splitting spaces shortens every prompt after intake and keeps
unrelated detail out of it.

The trade-off is that a stage cannot see what was said in another space. If the customer mentions
"I had a fender-bender last spring" while giving their name, that sentence stays in
`quote-intake`, and `HistoryNode` will ask about incidents from scratch. That is acceptable here,
because it asks every customer anyway. When a stage genuinely needs earlier words, forward them
with `withMessage()`, as `revise_coverage` does in
[lesson 9](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/).

## Shared runtime context

QuoteGraph stores cross-stage runtime metadata in `graph.context`. After a valid
coverage selection, `CoverageNode` records when it calculated the quote:

```ts
this.graph.saveContext({
  rating: {
    calculatedAt: now.toISOString(),
    businessDate: now.toISOString().slice(0, 10),
  },
});
```

`QuoteNode.adjustQuote()` replaces the `rating` branch after recalculation.
`QuoteNode.acceptQuote()` reads it across the stage boundary and records the
acceptance event:

```ts
this.graph.saveContext({
  acceptance: {
    acceptedAt: quoteNow().toISOString(),
    rating: this.graph.getContext().rating ?? null,
  },
});
```

The completed session preserves both branches under `graph.context`. An unrelated
branch such as `request` is preserved when either branch is written. The getter
returns a read-only snapshot, and saves become durable with the successful node's
checkpoint. Resumed turns reload this context alongside node state and histories.
An idle-session reset starts with a fresh `{}`.

Driver details, selected coverage, premiums, and the accepted tier continue to
live in their existing node channels. Runtime context is a separate JSON record
and is not automatically included in model prompts. See the developer guide's
[context contract](/ezgraph/docs/developer-guide/state-context-and-history/#graph-wide-runtime-context).

## History is context; state is the record

Nothing in QuoteGraph reads business facts back out of history. The driver, vehicle, incidents,
coverage, and tiers are read from node state, by the rating engine, by prompts through filled
values, and by tools. History can be split, shortened, or discarded without losing a fact, and a
fact that has not passed a handler's validation cannot be treated as accepted just because it
appears in the transcript.

## Why it is written this way

A single clock and a code-owned expiry policy make time behave like any other input: explicit,
testable, and the same for every stage. Separate history spaces treat model context as a cost and
a risk to be managed, not a log to keep appending to. The durable record is somewhere else
entirely.

## Common mistakes

- **Calling `new Date()` in business rules.** Every rule should read the same pinnable clock.
- **Asking the model to notice stale sessions.** Decide in `onRestoreSessionDoc()`, before any node
  runs.
- **Forgetting completed sessions in a restore policy.** Decide whether they should expire too.
- **One history for everything.** Long, mixed histories cost tokens and invite answers from the
  wrong stage.
- **Reading facts back from history.** If a fact matters, a handler should have saved it to state.

## Next

Continue to [8. Deterministic rating](/ezgraph/docs/tutorials/quote-graph/deterministic-rating/).
