---
layout: layouts/ezgraph.njk
title: Attachments and testing | EZGraph
description: Handle temporary file attachments and verify graphs with deterministic tests and opt-in provider evaluation.
permalink: /ezgraph/docs/developer-guide/attachments-and-testing/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Attachments and testing

Handle temporary file attachments and verify graphs with deterministic tests and opt-in provider evaluation.

## File attachments

`ToolResponse` supports model-visible attachment messages and cleanup. A file
tool can remain in the same agent loop without reviving the old result type.

```ts
return stay(JSON.stringify({ attached: true, fileName: name, fileId: upload.fileId }))
  .withCleanup(upload.cleanup)
  .withMessages([
    new HumanMessage({ content: [
      { type: "text", text: "Analyze the attached file and submit the extraction." },
      upload.contentPart,
    ] }),
  ]);
```

## Test in two tiers

Keep deterministic graph tests separate from opt-in provider evaluation.
The example below uses the router from [Decision nodes with Jev](/ezgraph/docs/developer-guide/decision-nodes/#declare-questions-then-route-in-code).

```json
{
  "test:quote-graph": "node --import tsx --test test/quote-graph/*.spec.ts",
  "test2:quote-graph": "USE_ENV=1 KEEP_SESSION=1 node --import tsx --test test/quote-graph/quote-graph.e2e.spec.ts",
  "test:decision-hotel-graph": "node --import tsx --test test/decision-hotel-graph/*.spec.ts",
  "test2:decision-hotel-graph": "USE_ENV=1 KEEP_SESSION=1 node --import tsx --test test/decision-hotel-graph/decision-hotel-graph.e2e.spec.ts"
}
```

`USE_ENV=1` is the single live-provider switch. `KEEP_SESSION=1` retains the
session only when a replay needs inspection. Assertions about durable state
belong in deterministic tests; semantic judges and provider calls remain
explicitly opt-in.

The deterministic tier runs real `GraphEngine` turns against an in-memory
session store. Import the helpers from `@picoflow/ezgraph/testing`.
`scriptedGateway()` dictates chat-model output. `scriptedDecisions()` queues
Jev answers or failures, so no TypeSafe key is needed:

```ts
import {
  createTurnHarness,
  scriptedDecisions,
  scriptedGateway,
} from "@picoflow/ezgraph/testing";

const decisions = scriptedDecisions()
  .answers({
    destination: {
      type: "choice",
      choice: "review",
      confidence: 0.97,
      probabilities: { dates: 0.01, budget: 0.01, review: 0.97, search: 0.01, exit: 0, unclear: 0 },
    },
  })
  .fail(new Error("simulated Jev outage")); // exercises onDecisionError()

// HotelGraph registers the RouterDecisionNode from the decision-node example.
const harness = createTurnHarness<HotelStateType>({
  graph: HotelGraph,
  gateway: scriptedGateway(),
  decisions,
});

const review = await harness.send("show my criteria");
assert.equal(review.currentNode, "RouterDecisionNode");

const outage = await harness.send("search");
assert.equal(outage.currentNode, "DateRangeNode"); // deterministic fallback
assert.ok(decisions.drained);

const sent = decisions.calls[0]!.request.state as { request: string };
assert.equal(sent.request, "show my criteria");
```

Scripted answers pass the same validation as live ones, so every declared
label needs a probability. `decisions.calls` records each exact request, and
`decisions.drained` confirms that every queued answer was used. A test can also
pass a hand-written `DecisionProviderAdapter` that derives answers from
`request.state`, which is how the demo's 23-turn hotel contract works.

For conversational error policy, script invocation failures with
`scriptedGateway().fail(...)`, empty responses with `.empty()`, and rejected
candidates with `.text(...)` or `.callsTool(...)`. Verify node-to-graph
precedence, retry counts, blocked responses, and cancellation. Also test failure
after a successful tool: the durable state and tool feedback should survive
handled recovery, and completed handlers should execute only once.

For temporary model recovery, assert the gateway's recorded model sequence:
primary, alternate, alternate for a tool follow-up, then primary on a new turn.
Verify that alternate calls receive `params.retries: 0`, completed tools are
not replayed, and an alternate failure can return a fixed reply. Include
fallback after an empty or rejected primary candidate and cancellation during
the alternate call. These are deterministic checks; they do not verify a live
provider's availability or answer quality.

See the [QuoteGraph walkthrough](/ezgraph/quote-graph/) for a complete guided
application, the [DecisionHotelGraph tutorial](/ezgraph/docs/tutorials/decision-hotel-graph/)
for decision nodes backed by Jev, and the [tutorial](/ezgraph/tutorial/) for a
small runnable graph.
