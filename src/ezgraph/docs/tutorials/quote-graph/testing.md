---
layout: layouts/ezgraph.njk
title: 10. Testing the whole quote
description: Test QuoteGraph's rating engine, a scripted eight-turn quote, a refused licence, and the idle policy without a provider, then run the fifteen-turn live semantic evaluation.
permalink: /ezgraph/docs/tutorials/quote-graph/testing/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 10. Testing the whole quote

Because QuoteGraph keeps prices, rules, and state transitions in code, most of what matters can
be tested without calling a model. `ezgraph-demo` does that in `quote-graph.spec.ts`, and keeps one
provider-backed evaluation for what code cannot check: that the real model actually runs the
conversation the fakes assume. This lesson reads both, and shows how a new graph test could use
EZGraph's turn harness.

## The goal

- Unit-test pure business modules directly.
- Drive a multi-stage conversation with a scripted chat model and assert state after every turn.
- Test a graph-owned session policy with a hand-built document.
- Know what the live evaluation checks, and how it tolerates harmless variation.

## The two tiers

| Script | Runs | Needs |
| --- | --- | --- |
| `npm run test:quote-graph` | `quote-graph.spec.ts` (seven tests); the E2E file is skipped | nothing |
| `npm run test2:quote-graph` | `quote-graph.e2e.spec.ts` with `USE_ENV=1 KEEP_SESSION=1` | working model-provider credentials |

`test:quote-graph` matches `test/quote-graph/*.spec.ts`, which includes the E2E file. It skips
itself unless `USE_ENV=1` is set, so the first script is always provider-free.

## Unit tests for the rating engine

```ts
describe("RatingEngine", () => {
  it("computes a deterministic risk factor and premium", () => {
    const factor = RatingEngine.riskFactor(subject, QUOTE_DATE);
    // 1.0 (age 34) × 1.06 (risk group 2) × 1.15 (one violation) × 0.95 (insured)
    assert.ok(Math.abs(factor - 1.15805) < 1e-9);
    assert.equal(RatingEngine.monthlyPremium(subject, selectedCoverage, QUOTE_DATE), 140.43);
  });

  it("orders the tiers saver < selected < shield", () => { /* ... */ });

  it("rejects liability-only coverage on a financed vehicle", () => {
    const error = validateCoverageSelection(
      { ...selectedCoverage, collisionDeductible: null, comprehensiveDeductible: null },
      "finance",
      QUOTE_DATE,
    );
    assert.match(String(error), /lender/i);
  });
});
```

The subject is the replay's customer, so these tests pin the exact numbers shown in the live
transcript. No graph, model, or session is involved; the engine is a plain module. That is the
payoff of keeping it free of EZGraph imports.

## The scripted quote

The graph test plays the whole quote in eight turns, with a hand-written gateway standing in for
the model:

```ts
async function invoke(
  graph: QuoteGraph,
  state: QuoteGraphStateType | undefined,
  input: string,
): Promise<QuoteGraphStateType> {
  return graph.graph.invoke({
    ...graph.prepareInput(state, new HumanMessage(input)),
    inputConsumed: false,
    response: "",
  });
}
```

`QuoteScriptedGateway` implements the five-method `LlmGateway` interface; four methods throw
because the graph never uses them. Its `agent()` method decides what to do from the tools it was
offered, which identifies the stage, and from the newest human message and tool result:

```ts
if (names.has("resolve_vehicle")) {
  if (lastTool?.needsTrim) {
    return result(new AIMessage("That Camry comes in LE, SE, and XSE trims — which one is yours?"), activeConfig);
  }
  if (lastTool?.accepted === true && lastTool.vehicle) {
    return result(toolCall("use", "capture_vehicle_use", {
      vehicleId: (lastTool.vehicle as { id: string }).id,
      ownership: "finance", annualMileage: 12000, parking: "driveway",
    }), activeConfig);
  }
  // ...
}
```

Reading the previous tool result is what lets one scripted gateway exercise the real handlers.
`needsTrim` comes from `resolve_vehicle` itself, so if the handler stopped reporting candidates, the
test would fail.

| Turn | Customer | Asserts |
| --- | --- | --- |
| 1 | name, birth date, licence | `VehicleNode` is current; the driver is saved; the reply asks about the vehicle |
| 2 | "a 2019 Toyota Camry" | still `VehicleNode`; the reply lists LE, SE, and XSE; nothing resolved yet |
| 3 | SE, financed, 12,000 miles, driveway | `HistoryNode`; the saved vehicle use equals the expected record |
| 4 | insured, one ticket in March 2026 | `CoverageNode`; the saved history equals the expected record |
| 5 | liability only | still `CoverageNode`; the reply mentions the lender; coverage is not saved |
| 6 | $500 deductibles and rental | `QuoteNode`; coverage saved; tiers equal `RatingEngine.quoteTiers()` for that coverage |
| 7 | "What if I raise both deductibles to $1000?" | coverage and tiers updated; the reply contains the new selected premium |
| 8 | "Let's accept the selected option." | completed; `currentNode` is `end`; accepted tier and a `QT-` reference saved; the reply shows the adjusted premium |

Turn 5 tests the lender rule through the real handler: the fake model submits liability-only, the
handler refuses, and the fake relays the refusal. Turns 6 and 7 compare saved tiers with a fresh call
to the engine, so the graph test and the unit tests cannot disagree about prices.

A second test sends a suspended licence and asserts the turn ends in `DriverNode` with no driver
saved and "suspended" in the reply.

<div class="callout"><span class="label">This test bypasses the engine</span><p><code>invoke()</code> calls the compiled LangGraph directly. That tests nodes, tools, state, and transitions, but skips everything <code>GraphEngine.run()</code> adds: the session lease, the restore hook, persistence, per-step checkpoints, and the saved document. For new tests, EZGraph's <code>createTurnHarness()</code> runs real engine turns against an in-memory store. The DecisionHotelGraph tests use it.</p></div>

Here is the first turn written with the harness. It is not part of the demo, but it passes against
it:

```ts
import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnHarness, scriptedGateway } from "@picoflow/ezgraph/testing";
import { QuoteGraph } from "../../src/graphs/quote-graph/quote-graph.js";
import type { QuoteGraphStateType } from "../../src/graphs/quote-graph/quote-graph.state.js";

test("a valid driver is saved and the vehicle stage replies in the same turn", async () => {
  process.env.QUOTE_GRAPH_CURRENT_DATE = "2027-06-01T00:00:00.000Z";
  const gateway = scriptedGateway()
    .callsTool("capture_driver", {
      fullName: "Jamie Rivera",
      dateOfBirth: "1993-04-12",
      licenseState: "or",
      licenseStatus: "valid",
      yearsLicensed: 10,
    })
    .text("Thanks, Jamie. What's the vehicle's year, make, and model?");
  const harness = createTurnHarness<QuoteGraphStateType>({ graph: QuoteGraph, gateway });

  const turn = await harness.send("Jamie Rivera, born 1993-04-12, valid Oregon license, 10 years.");

  assert.equal(turn.status, 200);
  assert.equal(turn.currentNode, "VehicleNode");
  assert.equal(turn.state?.nodes.DriverNode?.driver?.licenseState, "OR");
  assert.match(gateway.calls[1]!.systemPrompt, /This stage has just started/);
  assert.ok(gateway.drained);
  await harness.close();
});
```

It checks things the direct-invoke test cannot. The driver is in the *persisted* document, with the
state code uppercased by the handler. The second model call, `VehicleNode`'s, received the one-time
entry cue from [lesson 4](/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/). And
`gateway.drained` proves no unexpected model call was made.

## The session policy

```ts
it("keeps a quote session inside the idle window", async () => {
  const graph = new QuoteGraph(new QuoteScriptedGateway());
  const restored = await graph.restoreSessionDoc(quoteSession(60_000));
  assert.ok(restored);
  assert.equal(restored.graph.currentNode, "CoverageNode");
});

it("starts a new run after the idle window", async () => {
  const graph = new QuoteGraph(new QuoteScriptedGateway());
  assert.equal(await graph.restoreSessionDoc(quoteSession(45 * 60_000)), null);
});
```

`quoteSession(idleMs)` builds a `SessionDocument` whose `modifiedAt` is `idleMs` in the past. Calling
the public `restoreSessionDoc()` runs the same graph-ID check, migration path, and
`onRestoreSessionDoc()` the engine uses, without an engine or a store. The document's other fields
are placeholders; only `modifiedAt` and the graph ID matter to this policy.

## The live evaluation

`quote-graph.e2e.spec.ts` boots the real Nest application with Fastify and posts each of the 15
scenario turns to `POST /ai/run`, carrying the session ID between turns. The session store is in
memory unless `USE_ENV=1` lets `.env` choose it, and the `test2` script always sets `USE_ENV=1`.
It pins `QUOTE_GRAPH_CURRENT_DATE` to `2027-06-01` unless you set it yourself.

Each turn must return HTTP 200, keep the same session ID, and match the scenario's `completed`
flag. A judge model then grades the reply against the turn's `expectedResponse` in
`quote-graph.scenario.json`, for example:

```json
{
  "label": "lender rule blocks liability-only",
  "input": "Can I skip collision and comprehensive entirely?",
  "expectedResponse": "The assistant must explain that a financed vehicle cannot be liability-only because the lender requires both collision and comprehensive coverage…"
}
```

The judge is `gpt-4o` through `OPENAI_API_KEY`, or `openai-auth:gpt-5.4` when no key is set. A turn
passes at a score of 0.75. The judge's instructions are explicit about harmless variation, which is
what keeps a live test from failing on wording:

```text
The assistant may batch its questions differently than expected: accept responses that ask for only
part of the expected next details, and accept responses that ask for several related details of the
current stage in a single message, as long as they ask for a correct next missing item and nothing
wrong.
```

The judge also accepts quote presentations "even if tier naming or ordering differs slightly",
which is why the "Selected" / "Your selection" mismatch from
[lesson 9](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/) does not fail the run.

After the last turn the test checks the completed session: status `completed`, `currentNode` `end`,
the saved driver, vehicle use, history, coverage with $1000 deductibles, the accepted tier, and a
`QT-` reference. It writes the transcript to `test/.tmp/quote-graph/live.json`, which is where the
[live replay](/ezgraph/docs/tutorials/quote-graph/live-replay/) comes from, or
`semantic-failure.json` if a judgment fails. With `KEEP_SESSION=1` the session is kept in the store;
otherwise it is deleted.

## What each tier cannot prove

| Tier | Proves | Cannot prove |
| --- | --- | --- |
| unit | the engine's numbers and rules, on every run | anything about the conversation |
| scripted graph | every tool, rule, transition, and state write the script reaches | that a real model calls the tools the way the script does |
| live | that a real model completes a realistic quote and the replies read correctly | general reliability; one run is one sample, and a skipped run is not evidence |

## Why it is written this way

The deterministic tier is fast and exact, so it runs on every change and pins every number and
state write. The live tier is slow, costs money, and varies, so it is opt-in and judged
semantically, with its tolerances written down. Keeping prices in a pure module means the most
important assertions, the premiums, need neither tier's machinery at all.

## Common mistakes

- **Testing prices through the conversation.** Unit-test the engine, and compare graph results with
  it.
- **A scripted model that ignores tool results.** Branch on the last tool result, so the real
  handlers' outputs drive the script.
- **Unpinned dates.** Ages and windows drift; set the clock in every tier.
- **Calling the compiled graph directly for engine behavior.** Leases, restore, and persistence need
  `createTurnHarness()`.
- **A judge with no stated tolerances.** Write down what variation is acceptable, or the live test
  will fail on wording.

## Next

Return to the [QuoteGraph overview](/ezgraph/docs/tutorials/quote-graph/), continue with the
[DecisionHotelGraph track](/ezgraph/docs/tutorials/decision-hotel-graph/), or read the
[QuoteGraph case study](/ezgraph/compare/langgraph/quotegraph-case-study/) comparing this graph
with the plain LangGraph version.
