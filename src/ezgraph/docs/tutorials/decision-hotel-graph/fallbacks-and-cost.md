---
layout: layouts/ezgraph.njk
title: 9. Fallbacks, usage, and cost
description: Decide which decision failures fall back and which fail the turn, compare three per-node fallbacks, and account for the decision calls and tokens behind the live replay.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-cost/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 9. Fallbacks, usage, and cost

A decision model is a network dependency. It can time out, return something invalid, or be
misconfigured, and each of those needs a different response. It also costs money on every call,
and a graph that routes through a decision node on every step makes a lot of calls. This lesson
covers both sides of that dependency.

## The goal

- Know which failures are retried, which fall back, and which fail the turn.
- Write a fallback that matches the responsibility of its node.
- Decide deliberately whether each boundary fails open or fails closed.
- Read `decisionUsage` and the decision audit, and find where the calls go.

## How a failure is classified

`DecisionRunner` sorts every failure into one of four paths:

| Failure | Retried? | Then |
| --- | --- | --- |
| timeout (15 seconds per attempt here) | yes, up to `maxRetries: 2` | `onDecisionError()` with `failure: "timeout"` |
| an error the adapter marks transient; for Jev: HTTP 408, 429, or 5xx, and connection or timeout errors | yes, up to `maxRetries: 2` | `onDecisionError()` with `failure: "provider"` |
| any other provider error | no | `onDecisionError()` with `failure: "provider"` |
| an answer that fails validation | no | `onDecisionError()` with `failure: "validation"` |
| configuration: a missing `TYPESAFE_API_KEY`, a missing `@langchain/typesafe` package, HTTP 401 or 403 | no | the turn fails; no fallback runs (an unregistered provider fails even earlier, at startup) |
| the caller cancels the turn | no | the turn fails; no fallback runs |
| an exception thrown by `onDecision()` or `onDecisionError()` | no | the turn fails |

Retries wait 250 ms between attempts, and the TypeSafe SDK's own retries are disabled so the bound
is exact. With this graph's settings, a decision that keeps timing out takes about 45 seconds
(three 15-second attempts) before its fallback runs. Pick `timeoutMs` and `maxRetries` with that
product in mind.

Configuration errors deliberately skip every fallback. A wrong key is not an outage; hiding it
behind a friendly fallback would make a broken deployment look healthy.

## Who handles a fallback

The node's `onDecisionError(context)` runs first. If it returns `null`, the graph's
`BaseGraph.onDecisionError(context)` runs. If that also returns `null`, the original error is
rethrown. All three decision nodes in this graph return a response, so the graph-wide hook is
never reached. `context` carries `nodeId`, `provider`, `model`, `failure`, `attempts`, `error`, and
the invocation's `state`.

## Three fallbacks, three policies

### The router: ask the next deterministic question

```ts
protected override onDecisionError(
  context: DecisionErrorContext<DecisionHotelGraphStateType>,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  const notice = context.state.nodes.RouterDecisionNode?.notice;
  if (notice) {
    return directTo(RouterDecisionNode, notice).withState({ notice: null });
  }
  const issues = CriteriaHelper.validateCriteria(CriteriaHelper.readCriteria(context.state));
  return issues.length
    ? directTo(CriteriaHelper.nextNode(issues[0]!), CriteriaHelper.criteriaPrompt(issues[0]!.field))
    : directTo(
        RouterDecisionNode,
        "Your saved criteria are ready. Say “search” to find hotels, or tell me what to revise.",
      );
}
```

Without Jev, the router cannot know what the customer meant, but it knows what the graph still
needs. It shows a pending notice, clearing it with `withState()` on its own `directTo()`, or asks
for the first missing criterion, or invites a search. It never forwards a message to a collector
and never searches, because both of those depend on understanding the message.

### The readiness judge: fall back to validation

```ts
protected override onDecisionError(
  context: DecisionErrorContext<DecisionHotelGraphStateType>,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  const issues = CriteriaHelper.validateCriteria(CriteriaHelper.readCriteria(context.state));
  return issues.length
    ? directTo(CriteriaHelper.nextNode(issues[0]!), CriteriaHelper.criteriaPrompt(issues[0]!.field))
    : go(SearchHotelsNode);
}
```

When the semantic review is unavailable, the judge lets deterministic validation decide alone, and
a valid record is searched without a faithfulness check.

### The presentation judge: show the grounded list

```ts
protected override onDecisionError(
  context: DecisionErrorContext<DecisionHotelGraphStateType>,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  return directTo(
    PresentNode,
    CriteriaHelper.renderHotelResults(context.state.nodes.PresentNode?.hotelFound ?? []),
  );
}
```

When the grounding review is unavailable, the model's draft is never shown. The customer gets the
code-rendered list, exactly as if the draft had been rejected.

### Open or closed?

| Node | If Jev is unavailable… | Policy | Why that is acceptable here |
| --- | --- | --- | --- |
| router | asks the next missing question | degrades | the customer can still finish, one question at a time |
| readiness judge | searches if validation passes | **fails open** | a search is read-only, and the customer sees the criteria in the results |
| presentation judge | shows the code-rendered list | **fails closed** | the fallback is always correct, so there is nothing to lose |

The readiness choice is the one to question for your own application. If the step behind the
judge had a real side effect, such as charging a card, failing open would be wrong; the fallback
should ask the customer to confirm the summary instead. Write down the policy for each boundary,
and make the fallback implement it.

## Usage and audit

Every decision call is counted in `state.decisionUsage`, persisted as
`SessionDocument.decisionUsage`, separately from the chat model's `tokens`:

```ts
{ calls: 22, inputTokens: …, outputTokens: …, totalTokens: 30693 }
```

A response is counted even when it then fails validation, because the provider was paid for it.
Each call also appends one entry to `SessionDocument.decisions`, with the node, provider,
configured and actual model, outcome (`success`, `fallback`, `decision_handler_failed`, or
`fallback_handler_failed`), failure category, attempts, duration, request ID, and usage. Prompts,
questions, facts, and answers are never written there. The deterministic test asserts both
properties: at least one `fallback` outcome, and no entry containing `state`, `answers`, or
`questions`.

## Where 22 decision calls went

The live replay's final session recorded **22 decision calls and 30,693 decision tokens**, against
**11,473 chat-model tokens**, for 16 customer turns. The node path of every turn, shown in
[lesson 1](/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/#under-the-hood), accounts for
all 22:

| Node | Calls | Why |
| --- | --- | --- |
| `RouterDecisionNode` | 17 | 6 at the start of a turn, 2 after a reroute or revision, 8 after a collector saved a value, 1 on the empty-search notice |
| `CriteriaReadinessDecisionNode` | 3 | one per "search" |
| `PresentationDecisionNode` | 2 | one per result set presented |

Decision calls averaged about 1,400 tokens each. Three changes would cut the count or the size,
each with a trade-off:

- **The notice call** (1 of 22) is pure waste; see [lesson 5](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/).
- **The post-capture router calls** (8 of 22) mostly conclude "ask the next unresolved field",
  which `CriteriaHelper` already knows. Replacing them with a deterministic next-question step
  would remove them. The price is that the router would no longer catch a second request in the
  same message, such as "maximum 700, and I need a suite".
- **The router's prompt** repeats the criteria once per question on top of the facts; see
  [lesson 4](/ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/). Shrinking it
  reduces tokens per call without changing the call count.

## Why it is written this way

Each decision node knows what its judgment protects, so each owns its failure. A single graph-wide
fallback would have to guess whether it was standing in for a router, a gate, or a reviewer. The
accounting is separate from chat tokens because the two are priced and tuned differently. In a routing-heavy graph like this one,
decision tokens outnumbered chat tokens by more than two to one.

## Common mistakes

- **Falling back on configuration errors.** A missing key should fail loudly; EZGraph does not
  route it to your fallback.
- **A fallback that calls another model.** Use deterministic state; the fallback runs precisely
  when a model is unavailable.
- **Failing open by accident.** Decide per boundary whether an outage should permit or block the
  next step.
- **Ignoring worst-case latency.** Timeout × attempts is how long the customer waits before the
  fallback.
- **Counting only chat tokens.** Check `decisionUsage` too; here it was the larger number.

## Next

Continue to [10. Testing decision graphs](/ezgraph/docs/tutorials/decision-hotel-graph/testing/).
