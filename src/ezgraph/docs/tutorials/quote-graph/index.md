---
layout: layouts/ezgraph.njk
title: QuoteGraph tutorial
description: Build a durable car-insurance quote with node-owned state, validated tools, deterministic rating, corrections, and semantic evaluation.
permalink: /ezgraph/docs/tutorials/quote-graph/
ezgraph: true
ezgraphDocument: true
---

# QuoteGraph tutorial

`QuoteGraph` is a guided car-insurance quote, not a toy conversation. It collects a driver,
a catalogued vehicle, insurance history, and coverage choices; produces deterministic quote
tiers; supports a coverage revision; and completes only after the customer accepts a current
tier. The implementation lives in
[ezgraph-demo](https://github.com/picoflowio/ezgraph-demo/tree/main/src/graphs/quote-graph).

## What this tutorial covers

```text
DriverNode → VehicleNode → HistoryNode → CoverageNode → QuoteNode ──accept_quote──→ finish()
                                              ↑              │
                                              └── revise_coverage

Any conversational node ──terminate_session──→ TerminateSessionNode → END
```

Every conversational node owns the durable facts it validates. `CoverageNode` calls the
deterministic rating engine and seeds `QuoteNode` with its result; the model never calculates
a premium or invents an accepted tier. Accepting a tier completes the graph directly with
`finish(...)`; `TerminateSessionNode` handles only a customer's request to stop.

| Node | Owns | Demonstrates |
| --- | --- | --- |
| `DriverNode` | identity and licence facts | schema plus calendar, age, and licence validation |
| `VehicleNode` | resolved catalog ID and vehicle use | lookup before capture and trim disambiguation |
| `HistoryNode` | current insurance and recent incidents | an isolated incident-history space |
| `CoverageNode` | chosen coverage | deterministic pricing and atomic target state |
| `QuoteNode` | current tiers and acceptance | code-rendered revisions, a backward route, and completion |

## The seven lessons

1. [A fifteen-turn live replay](/ezgraph/docs/tutorials/quote-graph/live-replay/) — the
   complete recorded quote, including corrections, repricing, and acceptance.
2. [Graph and state ownership](/ezgraph/docs/tutorials/quote-graph/graph-and-state/) — register
   the graph and make node channels explicit.
3. [Validated collection and catalog lookup](/ezgraph/docs/tutorials/quote-graph/validated-tools/) —
   use schemas as an interface, then enforce the real business rule in code.
4. [Session lifetime and history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/) —
   isolate the incident and presentation conversations, and expire an old quote safely.
5. [Deterministic rating](/ezgraph/docs/tutorials/quote-graph/deterministic-rating/) — keep
   pricing and coverage constraints out of model prose.
6. [Revisions, direct responses, and acceptance](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/) —
   recalculate, go back, or finish only from current state.
7. [Testing the whole quote](/ezgraph/docs/tutorials/quote-graph/testing/) — distinguish unit
   coverage from the credential-conditional semantic conversation.

## Running it

```bash
cd ezgraph-demo
npm run test:quote-graph
npm run test2:quote-graph
```

The first command runs the deterministic suite with scripted model replies; the provider-backed
E2E file it also matches is skipped without `USE_ENV=1`. The second script sets
`USE_ENV=1 KEEP_SESSION=1`, runs the fifteen-turn semantic scenario against the configured
model provider, and retains its session for inspection.

## Next

Start with [1. A fifteen-turn live replay](/ezgraph/docs/tutorials/quote-graph/live-replay/).
