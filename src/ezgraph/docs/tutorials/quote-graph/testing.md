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

`test/quote-graph/quote-graph.spec.ts` covers the rating engine's determinism, tier ordering,
and lender rule; a scripted full quote through driver capture, trim disambiguation, vehicle use,
history, coverage, adjustment, and acceptance; a rejected suspended licence; and the idle-window
restore policy. Model replies come from a scripted gateway, so no provider is needed to
establish those contracts.

## Then run the semantic scenario

`quote-graph.scenario.json` defines a fifteen-turn conversation: driver collection, trim
disambiguation, vehicle use, insurance history, a lender rule that blocks liability-only
coverage, tier presentation, a deductible what-if, and final acceptance. The E2E evaluator logs
each input, response preview, semantic-judge result, and final persisted state check.

```bash
npm run test:quote-graph   # deterministic; the E2E file is skipped
npm run test2:quote-graph  # sets USE_ENV=1 KEEP_SESSION=1
```

The E2E test is skipped unless `USE_ENV=1` is set; with it set, it needs working provider
credentials and uses the configured session store. It is evidence only when it actually runs and
completes; a skipped test is not a successful provider evaluation.

## Next

Return to the [QuoteGraph tutorial overview](/ezgraph/docs/tutorials/quote-graph/) or explore
[DecisionHotelGraph](/ezgraph/docs/tutorials/decision-hotel-graph/).
