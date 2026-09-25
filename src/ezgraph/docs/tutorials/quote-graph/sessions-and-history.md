---
layout: layouts/ezgraph.njk
title: 4. Session lifetime and history spaces
description: Give a quote bounded session lifetime and isolate collection, incidents, presentation, and termination histories.
permalink: /ezgraph/docs/tutorials/quote-graph/sessions-and-history/
ezgraph: true
ezgraphDocument: true
---

# 4. Session lifetime and history spaces

## The goal

Preserve a useful in-progress quote without treating an old rate as indefinitely valid.

## Give each stage the right conversational memory

`QuoteGraph.getGraphDefinition()` assigns a history space to each node:

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

Driver, vehicle, and coverage share the intake conversation. Incident collection and quote
presentation get separate histories so the prompt does not carry unrelated conversational
detail into a sensitive incident discussion or a tier explanation.

## Reset a stale quote

`QuoteGraph` overrides `onRestoreSessionDoc()`, which the engine calls with the persisted session
document before the next turn runs:

```ts
protected override async onRestoreSessionDoc(
  sessionDoc: SessionDocument<QuoteGraphStateType>,
): Promise<SessionDocument<QuoteGraphStateType> | null> {
  if (this.idleMs(sessionDoc) >= readMs("QUOTE_GRAPH_IDLE_MS", DEFAULT_IDLE_MS)) {
    return null;
  }
  return sessionDoc;
}
```

Returning `null` starts a new run rather than resuming a quote whose inputs and pricing window
are no longer valid. The default idle window is 30 minutes; `QUOTE_GRAPH_IDLE_MS` may override it
for a deployment, but the policy remains graph-owned rather than prompt-owned.

## Why it is written this way

History is model context; node state is the operational record. Separating them means a shorter
prompt history cannot erase durable driver, coverage, or accepted-tier facts. Expiry likewise
changes session behavior explicitly rather than relying on the model to notice an old message.

## Next

Continue to [5. Deterministic rating](/ezgraph/docs/tutorials/quote-graph/deterministic-rating/).
