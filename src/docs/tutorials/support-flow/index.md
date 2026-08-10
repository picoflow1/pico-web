---
title: Track overview
eyebrow: SupportFlow tutorial
lede: A durable post-purchase support case that verifies an order, routes the request to a specialist, applies policy without an LLM decision, and closes with a factual recap.
source: picoflow-demo/src/myflow/support-flow/support-flow.ts, picoflow-demo/src/myflow/support-flow/triage-step.ts, picoflow-demo/src/myflow/support-flow/backend/policy-engine.ts
---

`SupportFlow` is the stateful-conversation track. It models a narrow but realistic
post-purchase support case: first verify the customer’s order, then route either a
return or billing concern to the appropriate specialist. Deterministic steps apply
return policy, compute the exact refund, or create a billing ticket; the model never
gets to invent eligibility, money, or an outcome.

The implementation lives in `picoflow-demo/src/myflow/support-flow/`, and its
turn-by-turn scenario lives in `picoflow-demo/test/support-flow/`. Browse the
[SupportFlow source on GitHub](https://github.com/picoflowio/pico-demo/tree/main/src/myflow/support-flow).

## What SupportFlow is

A `Flow` subclass with four important pieces of configuration:

- `configModel()` sets the OpenAI `gpt-4o` default for ordinary conversational
  steps.
- `defineSteps()` registers five conversational steps, two `LogicStep`s, and
  `TerminateSessionStep`.
- The constructor enables summary memory for the triage namespace after eight
  messages, preserving four recent messages verbatim.
- `onRestoreSessionDoc()` rejects sessions idle for 30 minutes and releases a
  pending approval back to triage after its 10-minute hold expires.

The first registered step, `TriageStep`, is the initial step. It is the case hub:
it verifies an order, sends return and billing work to specialists, and eventually
closes the case.

## The graph

```text
POST /ai/run (flowName: SupportFlow)
              |
              v
       +----------------+
       |   TriageStep   | -- verify_order --> stays at triage
       +----------------+
          |         |
  route returns   route billing
          |         |
          v         v
 +-------------+ +-------------+
 | ReturnsStep | | BillingStep |
 +-------------+ +-------------+
          |         |
          v         v
 +----------------+ +--------------+
 | AdjudicateStep | | EscalateStep |
 |  LogicStep     | |  LogicStep   |
 +----------------+ +--------------+
   | deny | auto/review     |
   |      |                 |
   v      v                 v
Returns  ApprovalStep ----> TriageStep -- close_case --> TerminateSessionStep
             |
       confirm or decline
             v
      TriageStep or ReturnsStep
```

There are two purposeful hub-and-spoke loops. A return is collected by
`ReturnsStep`, adjudicated without an LLM turn, and then either denied, committed
automatically, or held in `ApprovalStep` for explicit customer confirmation.
Billing follows a separate spoke: `BillingStep` validates the charge IDs and
`EscalateStep` creates the ticket in code before returning to the hub.

## The seven registered steps

| Step | Memory namespace / model | Responsibility |
| --- | --- | --- |
| `TriageStep` | `support-triage`; `gpt-4o`, temperature 0.3 | Verifies the order, routes the request, and closes a case only after an outcome is recorded. |
| `ReturnsStep` | `support-returns`; `gpt-5.1`, low reasoning effort | Collects a return item and reason without quoting eligibility or a refund. |
| `AdjudicateStep` | default namespace; `LogicStep` | Runs `PolicyEngine` against the order catalogue and chooses deny, auto-approve, or review. |
| `ApprovalStep` | `support-approval`; `gpt-5.1`, low reasoning effort | Presents the computed quote and commits it only after an unambiguous confirmation. |
| `BillingStep` | `support-billing`; flow default model | Validates disputed charge IDs and recomputes their amount from the ledger. |
| `EscalateStep` | `support-billing`; `LogicStep` | Creates a durable ticket from the validated dispute before returning to triage. |
| `TerminateSessionStep` | `support-terminal` | Ends the session after `close_case` creates a recap. |

`TriageStep` owns the verified order and the case outcomes. The specialist steps
read that state with `flow.getStepState(...)`, while their own namespaces preserve
the context unique to a return, approval, or billing request. This separation lets
the flow carry a long-running case without giving every specialist every prior turn.

## Where the decisions happen

The conversational steps use tools for bounded data collection. Their tool schemas
accept only an order ID and verification secret, a known return reason, or known
charge IDs. The handlers then recheck that input against the local order book.

`PolicyEngine.adjudicate()` is the policy boundary. It rejects undelivered, final
sale, already-returned, and expired-window items; it computes shipping refunds and
electronics restocking fees; and it requires confirmation whenever a refund exceeds
the $250 auto-approval limit. `AdjudicateStep` turns that result into a route rather
than asking a model to decide it.

The same pattern protects billing. `BillingStep` ignores the model-provided disputed
amount and recomputes it from the selected ledger entries. `EscalateStep` then creates
the ticket in a `LogicStep`, so an accepted dispute cannot be lost because the model
failed to emit a second tool call.

<div class="callout callout--info"><span class="callout__title">A model can explain, but not decide</span><p>The prompts explicitly prohibit calculating, estimating, negotiating, or promising money, eligibility, or timing. The deterministic services calculate outcomes; the model gathers the facts and communicates the recorded result.</p></div>

## Session and approval lifecycle

The custom restore hook is part of the workflow, not just cleanup. A stale session
returns `null`, so the engine starts a new case after 30 minutes of inactivity. A
session paused in `ApprovalStep` is more restrictive: after 10 minutes, the hook
removes its pending quote and puts the cursor back at `TriageStep`. An old approval
therefore cannot be confirmed after the hold has expired.

The support track also demonstrates why durable state belongs in the flow instead
of in prompt text. Refunds and tickets are stored under triage state, returned line
IDs under the returns step, and the short-lived pending quote under approval state.
The closing step can then produce a factual recap from those committed records.

## Running it

From the demo application:

```bash
npm run test:support-flow
```

The scenario verifies an order, routes a return through an approval hold, records
an auto-approved refund, opens a billing ticket, and closes the case with both
identifiers in the recap. It also asserts the guardrails: no RMA before confirmation,
no invented credit for a billing dispute, and no closing a case with no committed
outcome.

## The seven lessons

1. [Designing a support case](/docs/tutorials/support-flow/case-shape/) — why triage,
   returns, approval, billing, and deterministic workers are separate steps.
2. [Verifying and routing requests](/docs/tutorials/support-flow/verify-and-route/) —
   bounded tools at the hub, `stay()`, forwarding the customer’s request, and a
   truthful terminal recap.
3. [Deterministic return policy](/docs/tutorials/support-flow/return-policy/) —
   collecting a request in a conversational step and deciding it in a `LogicStep`.
4. [Approval holds and session restoration](/docs/tutorials/support-flow/approval-holds/)
   — committing an exact quote only after consent and expiring an old hold safely.
5. [Billing disputes and escalation](/docs/tutorials/support-flow/billing-escalation/)
   — recomputing ledger totals and creating a ticket without another model call.
6. [Memory and durable case state](/docs/tutorials/support-flow/memory-and-case-state/)
   — namespace isolation, triage-owned outcomes, and summary compaction.
7. [Testing a support case](/docs/tutorials/support-flow/testing/) — deterministic
   policy tests plus the nine-turn live scenario.

## Next

Start with [1. Designing a support case](/docs/tutorials/support-flow/case-shape/).
