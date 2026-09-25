---
layout: layouts/ezgraph.njk
title: 7. Testing the whole quote
description: Test deterministic quote behavior separately from the credential-conditional fifteen-turn semantic evaluation.
permalink: /ezgraph/docs/tutorials/quote-graph/testing/
ezgraph: true
ezgraphDocument: true
---

# 7. Testing the whole quote

## The goal

Verify the state and policy contract without confusing a skipped provider evaluation for test
evidence.

## Deterministic coverage first

`test/quote-graph/quote-graph.spec.ts` exercises node tools, state writes, graph transitions,
idle restoration, vehicle catalog behavior, rating rules, quote adjustment, and acceptance. It
does not need a model provider to establish those contracts.

## Then run the semantic scenario

`quote-graph.scenario.json` defines a fifteen-turn conversation: driver collection, trim
disambiguation, vehicle use, insurance history, a lender rule that blocks liability-only
coverage, tier presentation, a deductible what-if, and final acceptance. The E2E evaluator logs
each input, response preview, semantic-judge result, and final persisted state check.

```bash
npm run test:quote-graph
USE_ENV=1 KEEP_SESSION=1 npm run test2:quote-graph
```

The live command is conditional on configured credentials. It is evidence only when it actually
runs and completes; a skipped test is not a successful provider evaluation.

## Next

Return to the [QuoteGraph tutorial overview](/ezgraph/docs/tutorials/quote-graph/) or explore
[DecisionHotelGraph](/ezgraph/docs/tutorials/decision-hotel-graph/).
