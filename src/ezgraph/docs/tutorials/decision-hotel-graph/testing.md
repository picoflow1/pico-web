---
layout: layouts/ezgraph.njk
title: 10. Testing decision graphs
description: Test DecisionHotelGraph with a 23-turn deterministic contract, a hand-written decision adapter, a catalog test, focused scriptedDecisions cases, and a live semantic evaluation.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/testing/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 10. Testing decision graphs

A graph with a chat model and a decision model has two sources of variation, and neither belongs
in a routine test run. `ezgraph-demo` tests `DecisionHotelGraph` in two tiers. The deterministic
tier replaces both models with code and drives real engine turns. The live tier calls the real
providers and grades each reply semantically. This lesson reads both, and adds a third, smaller
kind of test you will want for your own graphs.

## The goal

- Drive real `GraphEngine` turns with a scripted chat model and a scripted decision provider.
- Write a decision adapter whose answers depend on the facts it receives.
- Simulate provider outages at chosen points in a conversation.
- Write a focused test for one decision boundary with `scriptedDecisions()`.
- Know what the live evaluation proves, and what it does not.

## The two tiers

| Script | Runs | Needs |
| --- | --- | --- |
| `npm run test:decision-hotel-graph` | `decision-hotel-graph.spec.ts` (23 turns), `hotel-search.spec.ts`; the E2E file is skipped | nothing |
| `npm run test2:decision-hotel-graph` | `decision-hotel-graph.e2e.spec.ts` with `USE_ENV=1 KEEP_SESSION=1` | `TYPESAFE_API_KEY` and `OPENAI_API_KEY`; otherwise skipped |

## The deterministic contract

`decision-hotel-graph.spec.ts` runs 23 turns through `createTurnHarness()`, which drives
`GraphEngine.run()` against an in-memory session store. Every turn goes through the same lease,
restore, invoke, and persist path as production.

```ts
test('DecisionHotelGraph completes the 23-turn correction, fallback, review, and booking contract', async () => {
  process.env.HOTEL_GRAPH_CURRENT_DATE = '2026-01-15T00:00:00.000Z';
  let currentInput = '';
  // ...
  const gateway = new HotelGateway(() => currentInput, () => presentationReviews);
  const decisions: DecisionProviderAdapter = { id: 'typesafe', async decide(request) { /* below */ } };
  const harness = createTurnHarness<DecisionHotelGraphStateType>({
    graph: DecisionHotelGraph, gateway, decisions, sessionId: 'decision-hotel-contract',
  });
  for (const scenario of turns) {
    currentInput = scenario.input;
    const turn = await harness.send(scenario.input);
    assert.equal(turn.status, 200, `${scenario.label}: ${turn.response}`);
    assert.equal(turn.completed, scenario.completed === true, scenario.label);
    assert.equal(turn.currentNode, scenario.activeNode, scenario.label);
    // optional `includes` / `excludes` checks on turn.response
  }
  // final state assertions
});
```

Each turn asserts the HTTP-style status, the completion flag, and the node the conversation will
resume in. That last assertion is the strongest one: it proves which branch every router, judge,
and collector took, without matching any wording.

### A chat model that reads the prompt

`HotelGateway` extends `ScriptedGateway` and overrides `agent()`. Instead of a fixed queue, it looks
at the system prompt to see which node is asking, and at the customer's latest message to decide
what to do:

```ts
if (systemPrompt.includes('minimum and maximum hotel budget')) {
  if (feedback) value = new AIMessage(feedback);
  else if (/minimum 800.*maximum 500/i.test(human)) value = tool('capture_budget', { min: 800, max: 500 });
  else {
    const maximum = human.match(/(?:maximum|max(?:imum)? budget)\D*(\d+)/i);
    value = maximum
      ? tool('capture_budget', { min: null, max: Number(maximum[1]) })
      : new AIMessage('What nightly budget range should I use?');
  }
}
```

When the handler returns `stay(feedback)`, the gateway replies with the feedback as text, which is
how a real model would pass the correction on. For `PresentNode`, the first draft is
deliberately invented ("Invented Waterfront Palace — total $1"); later drafts are built from the
`hotelFound` JSON in the prompt.

### A decision provider that reads the facts

The decision side is a plain object implementing `DecisionProviderAdapter`. Its `id` is
`'typesafe'`, the provider the graph's `decisionConfig` names, so the graph resolves it at
registration as it would the real adapter. It tells the three nodes apart by their question keys,
and it decides from the facts the node sent:

```ts
async decide(request: DecisionRequest): Promise<DecisionResult> {
  const state = request.state as Record<string, any>;
  if ('destination' in request.questions) {
    if (state.notice) throw new Error('simulated router outage during notice');
    const criteria = state.criteria as Record<string, any>;
    const unresolved = state.unresolved as string[];
    // ... pick a route and a delivery from currentInput, criteria, and unresolved ...
    return {
      model: 'jev-fixture',
      answers: {
        destination: choice(route, ['dates', 'budget', 'room_type', 'amenities', 'distance', 'review', 'search', 'exit', 'unclear']),
        request_delivery: choice(delivery, ['apply_request', 'prompt_next', 'none']),
      },
      usage: { inputTokens: 20 },
    };
  }
  if ('outcome' in request.questions) {
    criteriaReviews += 1;
    if (criteriaReviews === 2) throw new Error('simulated criteria judge outage');
    const outcome = criteriaReviews === 1 ? 'budget' : 'ready';
    // ...
  }
  presentationReviews += 1;
  if (presentationReviews === 2) throw new Error('simulated presentation judge outage');
  const accepted = presentationReviews > 1;
  // grounded 0.99 when accepted, 0.1 otherwise; both scores 2
}
```

Three techniques are worth borrowing:

- **Answers come from facts, not from the turn number.** The router fake reads `criteria` and
  `unresolved` exactly as Jev would. If `getDecisionFacts()` stopped sending them, the test would
  fail. The facts are part of the contract.
- **Outages are placed by counters.** The second readiness review and the second presentation
  review throw, and the router throws whenever a notice is pending. Each decision node's
  `onDecisionError()` therefore runs at least once, at a known point. A plain `Error` is not retried,
  because the adapter defines no `shouldRetry()`, so outages add no delay.
- **Valid answers are built by helpers.** `choice(label, labels)` sets a probability for *every*
  label, and `score(value)` fills the legend and probabilities for all three levels. The runner
  validates fake answers exactly as it validates Jev's, so a sloppy fixture fails the same way a
  bad provider response would.

### What the 23 turns prove

| Turns | Behavior |
| --- | --- |
| 1 | an unrelated question stays at the router with the "I can update…" text |
| 2–5 | dates start collection; impossible and past dates are rejected; valid dates move on |
| 6–8 | an inverted budget is rejected; a valid budget and room type are saved |
| 9 | a date correction during amenities is applied, and the amenity question returns |
| 10–12 | amenities saved; a negative distance rejected; "distance does not matter" saved |
| 13 | review shows the criteria |
| 14–15 | the readiness judge asks to confirm the budget; the customer reaffirms it |
| 16 | the readiness judge is down, so validation alone allows the search; the first presentation invents a hotel, the judge rejects it, and the response must not contain "Invented Waterfront Palace" |
| 17–19 | a stricter budget; an empty search; the notice is shown through the router's fallback |
| 20 | the presentation judge is down, so the grounded list is shown |
| 21–22 | another revision; the draft is accepted |
| 23 | booking hotel 1 completes the graph |

After the last turn the test checks the saved document: every criterion channel holds the expected
values, both judges saved `accepted: true`, a hotel and a six-digit confirmation number are saved,
there are at least 12 decision calls, at least one audit entry has outcome `fallback`, and no audit
entry contains `state`, `answers`, or `questions`.

## The catalog test

`hotel-search.spec.ts` calls `searchHotels()` directly with a hand-built snapshot: a suite from
August 3 to August 9, 2027, with no other limits. It checks that more than four hotels match, that a
known hotel is present, and that every result has an address, seven nightly prices, and a positive
total. No graph, model, or provider is involved. (The seven prices are the checkout-night behavior
described in [lesson 7](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/).)

## Focused tests with scriptedDecisions()

The contract test is a long story, which makes it good at catching regressions and poor at pinning
down one rule. For a single boundary, queue answers or failures with `scriptedDecisions()`. This test
checks the router's fallback on a brand-new session:

```ts
import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnHarness, scriptedDecisions, scriptedGateway } from "@picoflow/ezgraph/testing";
import { DecisionHotelGraph } from "../../src/graphs/decision-hotel-graph/decision-hotel-graph.js";
import type { DecisionHotelGraphStateType } from "../../src/graphs/decision-hotel-graph/decision-hotel-graph.state.js";

test("a router outage on the first turn asks for dates without a model call", async () => {
  process.env.HOTEL_GRAPH_CURRENT_DATE = "2027-07-15T00:00:00.000Z";
  const decisions = scriptedDecisions().fail("simulated Jev outage");
  const gateway = scriptedGateway(); // nothing queued: no chat-model call is allowed
  const harness = createTurnHarness<DecisionHotelGraphStateType>({
    graph: DecisionHotelGraph,
    gateway,
    decisions,
  });

  const turn = await harness.send("Hi");

  assert.equal(turn.currentNode, "DateRangeNode");
  assert.equal(turn.response, "What are your Portland check-in and checkout dates?");
  assert.equal(gateway.calls.length, 0);
  assert.equal((decisions.calls[0]!.request.state as { request: string }).request, "Hi");
  assert.equal(turn.document?.decisions?.[0]?.outcome, "fallback");
  assert.equal(turn.document?.decisions?.[0]?.failure, "provider");
  await harness.close();
});
```

It is not part of the demo, but it passes against it. `decisions.calls` records each exact request,
so a focused test can also assert the facts and the prepended prompt. An empty `scriptedGateway()`
turns any unexpected chat-model call into a failure. `scriptedDecisions()` retries only errors named
`ScriptedTransientError`, so you can test the retry path deliberately too.

## The live evaluation

`decision-hotel-graph.e2e.spec.ts` boots the real Nest application with Fastify and sends each of
the 16 scenario turns to `POST /ai/run`, carrying the session ID between turns. The real Jev adapter
and the real `gpt-4o` run behind it. It pins `HOTEL_GRAPH_CURRENT_DATE` to `2027-07-15`. The session
store is in memory unless `USE_ENV=1` lets `.env` choose it, and the `test2` script always sets
`USE_ENV=1`.

For every turn it asserts the `completed` flag, then asks a separate judge model whether the reply
matches that turn's `expectedResponse` in `decision-hotel-graph.scenario.json`. The judge is
`gpt-4o` via `OPENAI_API_KEY` by default. A turn fails below a score of 0.75. The judge's system
prompt is explicit about what does *not* matter, which keeps it from failing on wording:

```text
Accept concise responses that ask for the correct next criterion without acknowledging or repeating
the prior answer; persisted state is checked separately, so omission of an acknowledgement is never
a failure by itself.
```

After the last turn it checks the completed session: status `completed`, `currentNode` `end`, and
the exact saved criteria. It then writes `test/.tmp/decision-hotel-graph/live.json` with the
transcript, `decisionUsage`, and chat `tokens`; the live replay in
[lesson 1](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/) comes from such a run. A
failed judgment writes `semantic-failure.json` instead. With `KEEP_SESSION=1` the session is left
in the store for inspection; otherwise it is deleted.

## What each tier cannot prove

| Tier | Proves | Cannot prove |
| --- | --- | --- |
| deterministic | every branch, fallback, state write, and the audit's privacy, on every run | that Jev or `gpt-4o` actually choose those branches |
| live | that real models complete a realistic journey and replies read correctly | routing accuracy in general; one passing run is one sample, and a skipped run is not evidence |

Neither tier measures the judges' own accuracy. Calibrating the thresholds in
[lesson 4](/ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/) needs a labeled set of
real cases, scored separately.

## Why it is written this way

Decision nodes make routing testable in a way a prompt-driven router is not: the answer is a
typed value, so a test can supply it. That turns every branch and every fallback into an ordinary
assertion. The live tier then checks what code cannot: that the real models, given the real
prompts, behave like the fakes assume.

## Common mistakes

- **Fixtures with missing probabilities.** Every Choice label and Score level needs one; the runner
  rejects anything else and your test hits the fallback instead of the branch you meant.
- **A fake adapter with the wrong `id`.** It must match `decisionConfig.provider`, or the graph fails
  at registration.
- **Asserting wording instead of `currentNode`.** The resume node is the stable signal; wording is
  the live judge's job.
- **Only testing the happy path.** Put an outage at each decision node, as the contract test does.
- **Reading a skipped live test as a pass.** Without both keys it is skipped, which proves nothing.

## Next

Return to the [DecisionHotelGraph overview](/ezgraph/docs/tutorials/decision-hotel-graph/), read the
[developer guide's decision-node reference](/ezgraph/docs/developer-guide/#decision-nodes-with-jev),
or see the same boundaries in [QuoteGraph](/ezgraph/docs/tutorials/quote-graph/).
