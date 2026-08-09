---
title: 7. Testing a support case
eyebrow: SupportFlow tutorial
lede: The SupportFlow suite tests policy and ledger services without a model, then replays a nine-turn case through a real FlowEngine when live credentials are available.
source: picoflow-demo/test/support-flow/support-flow.spec.ts, picoflow-demo/test/support-flow/support-flow.scenario.json, picoflow-demo/src/myflow/support-flow/backend/policy-engine.ts
---

The support flow has two very different kinds of behavior to test. Return
eligibility, refund arithmetic, and duplicate-charge detection should be
deterministic unit tests. Routing and customer-facing communication require a
real flow run and, in this demo, a model-based judgment outside the source shown
here. The suite keeps those concerns separate.

## The goal

- Test policy and ledger behavior without network calls or a model.
- Make live end-to-end tests opt in only when their configuration is available.
- Replay one coherent case using a single session ID across every turn.
- Assert persisted business state after the terminal response, not only text.

## Run the suite

From `picoflow-demo`:

```bash
npm run test:support-flow
```

The deterministic checks always run. The live scenario runs only when
`OPENAI_API_KEY` and `PICOFLOW_KEY` are set and
`RUN_LIVE_SUPPORT_FLOW_TEST` is not `0`; otherwise Node reports that scenario
as skipped. To run only the deterministic portion explicitly:

```bash
RUN_LIVE_SUPPORT_FLOW_TEST=0 npm run test:support-flow
```

The test fixes the policy clock when it is absent:

```ts
process.env.SUPPORT_FLOW_CURRENT_DATE ??= "2027-07-15T00:00:00.000Z";
```

That turns return-window tests into stable assertions instead of a function of
the day the suite happens to run.

## Test deterministic services first

The suite verifies the policy decisions directly, before starting an engine:

```ts
const order = OrderBook.find("NW-100412")!;
const result = PolicyEngine.adjudicate(order, ["L1"], "too_large");
assert.equal(result.decision, "review");
assert.equal(result.quote?.netRefund, 289);
assert.match(GenReceipt.quoteTable(result.quote!), /\$289\.00/);
```

The remaining service tests assert that line `L2` is automatically approved
for $136, that an expired return is denied with the correct 60-day reason, and
that duplicate ledger charges produce the expected IDs and derived total. None
of these expectations is delegated to an LLM. If a policy rule regresses, the
suite tells you without a network call, prompt change, or non-deterministic
model response in the way.

## The scenario is a complete case, not isolated prompts

`support-flow.scenario.json` contains nine turns under one `flowName`:

| Turns | Purpose | Expected durable effect |
| --- | --- | --- |
| 1–2 | Ask for identity, then verify `NW-100412` | Triage owns the verified order. |
| 3–5 | Start a jacket return, receive a $289 approval offer, then decline it | No refund and no RMA are created. |
| 6 | Return the base layers | One $136 refund and a six-digit RMA are recorded. |
| 7–8 | Identify `CH-88301` as wrong and submit it | One five-digit `ESC` ticket records $439.95. |
| 9 | End the conversation | Terminal step recaps the refund and ticket. |

Every scenario turn says whether the response should complete the session. The
assistant’s response is expected to satisfy its described behavior—especially
the negative rules: do not issue an RMA before confirmation, do not promise a
billing credit, and do not claim a case is closed before an outcome exists.

## One session carries the entire case

The live test creates an in-memory engine and retains the returned session ID:

```ts
const engine = await FlowEngine.create({
  flows: [SupportFlow],
  sessionStore: new MemorySessionStore(),
  providers: ModelProvider.createBuiltinAdapters({
    openai: { apiKey: process.env.OPENAI_API_KEY },
  }),
});

let sessionId: string | undefined;
const send = async (userMessage: string) => {
  const response = await engine.run({
    flowName: "SupportFlow", userMessage, sessionId,
  });
  assert.equal(response.success, true, response.message);
  sessionId = response.session;
  return response;
};
```

Passing the same ID is essential. Each turn sees the current cursor, the
specialist state, and the triage outcomes established by prior turns. The test
checks `response.completed` against the scenario after every send, then fetches
the final session document to inspect what actually committed.

## Assert the durable result

At the end of the successful scenario, the suite checks more than prose:

```ts
assert.equal(completed?.runStatus, "completed");
assert.equal(completed?.flow.currentStep, "TerminateSessionStep");
assert.equal((triage?.state as any)?.refunds?.length, 1);
assert.equal((triage?.state as any)?.refunds?.[0]?.netRefund, 136);
assert.match((triage?.state as any)?.refunds?.[0]?.rma ?? "", /^RMA-\d{6}$/);
assert.deepEqual((returns?.state as any)?.returnedLineIds, ["L2"]);
assert.equal((billing?.state as any)?.dispute?.amountInDispute, 439.95);
assert.match(tickets[0]?.ticketId ?? "", /^ESC-\d{5}$/);
```

This is the key workflow-testing rule: score conversational quality if it is
useful, but also assert the state transition that makes the response true. A
well-worded confirmation is not enough if the refund is missing; a plausible
billing reply is not enough if no ticket was recorded.

The SupportFlow track is now complete. Revisit the [track overview](/docs/tutorials/support-flow/)
for the full graph and a map of each lesson.
