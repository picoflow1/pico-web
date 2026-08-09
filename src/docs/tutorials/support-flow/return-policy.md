---
title: 3. Deterministic return policy
eyebrow: SupportFlow tutorial
lede: ReturnsStep uses a model to collect an item and a reason. AdjudicateStep uses deterministic code to apply the return window, restocking fee, refund amount, and approval threshold.
source: picoflow-demo/src/myflow/support-flow/returns-step.ts, picoflow-demo/src/myflow/support-flow/adjudicate-step.ts, picoflow-demo/src/myflow/support-flow/backend/policy-engine.ts
---

Returns are a useful boundary for an agent workflow. Conversation is needed to
turn “the rain jacket is too big” into a line item and a recognized reason, but
the result—eligible, denied, or requires approval—must not depend on model
judgment. SupportFlow separates those jobs into `ReturnsStep` and
`AdjudicateStep`.

## The goal

- Collect constrained return facts with a tool while validating them against the
  verified order.
- Use `onResponse()` for a narrow deterministic fast path over the latest text.
- Hand a structured request into `LogicStep` with `go(...).withState(...)`.
- Keep policy, arithmetic, and refund authority out of prompts.

## The conversational contract

The return tool accepts only known reason codes and one or more line IDs:

```ts
{ name: "request_return",
  description: "Submit selected order line IDs and a return reason for deterministic adjudication.",
  schema: z.object({
    lineIds: z.array(z.string().min(1)).min(1),
    reason: z.enum([
      "damaged", "wrong_item", "too_small", "too_large",
      "not_as_described", "no_longer_needed",
    ]),
    note: z.string().optional(),
  }),
}
```

The step's prompt receives a filtered view of the verified order: it omits
non-returnable and already-returned lines, includes category-specific return
windows, and receives the last policy denial if one exists. It tells the model
to ask for at most one missing fact, never quote a refund, and call the tool as
soon as the item and reason are known.

The handler independently verifies the line IDs. It normalizes them, rejects
unknown IDs, and rejects IDs already recorded in `returnedLineIds`. A valid
request is then only a small data object:

```ts
const request: ReturnRequest = {
  orderId: order.orderId,
  lineIds: selected,
  reason: args.reason,
  ...(args.note?.trim() ? { note: args.note.trim() } : {}),
};
return this.routeToAdjudication(request);
```

## A controlled response-driven shortcut

Customers do not always wait for a tool call. If their latest message plainly
names an item and a supported reason, `onResponse()` recognizes it before the
ordinary response handling continues:

```ts
public override async onResponse(llmResult: string | object) {
  const request = this.inferReturnRequest();
  if (request) return this.routeToAdjudication(request);

  const selected = this.inferSelectedLineIds();
  if (selected.length > 0) this.saveState({ pendingLineIds: selected });
  return super.onResponse(llmResult);
}
```

`inferSelectedLineIds()` first looks for an explicit line ID, then matches an
item name when at least two words of that name appear, and finally reuses a
previously selected item. `inferReason()` maps a small set of phrases—such as
“too big” or “changed my mind”—to the same six reason codes the tool accepts.
If either side is missing, it does not adjudicate; it saves the selection and
lets the model ask for the one missing detail.

This is deliberately a narrow parser, not a second language model. It makes a
clear utterance efficient without broadening the authority boundary.

## Crossing into deterministic policy

Both the tool and the fast path call the same method:

```ts
private routeToAdjudication(request: ReturnRequest): ToolResponseType {
  this.removeState("pendingLineIds");
  this.saveState({ lastDenial: [] });
  return go(AdjudicateStep).withState({ request });
}
```

The request is attached to the destination step’s state. No model turn occurs
in `AdjudicateStep`; the runner invokes `runLogic()` immediately:

```ts
async runLogic(): Promise<LogicResponseType> {
  const request = this.getState<ReturnRequest>("request");
  if (!request) throw new Error("AdjudicateStep requires a return request.");

  const order = OrderBook.find(request.orderId);
  const returned = this.flow.getStepState<string[]>(ReturnsStep, "returnedLineIds") ?? [];
  const adjudication = PolicyEngine.adjudicate(order!, request.lineIds, request.reason, returned);
  this.saveState({ decision: adjudication.decision, adjudication });

  if (adjudication.decision === "deny") {
    return go(ReturnsStep).withState({ lastDenial: adjudication.reasons });
  }
  if (adjudication.decision === "review") {
    return go(ApprovalStep).withState({ pending: { request, quote: adjudication.quote!, reasons: adjudication.reasons } });
  }
  // auto: persist the refund and returned lines, then return to triage
}
```

The decision has three paths. A denial returns to `ReturnsStep` with the exact
reasons the next prompt must explain. A review path transfers the immutable
quote to approval. An automatic approval creates an RMA, adds the refund to
triage state, records the returned lines on the returns step, and goes back to
triage.

## The policy engine owns the money

`PolicyEngine.adjudicate()` starts with the order and selected line IDs, then
applies rules in a fixed order:

| Rule | Result |
| --- | --- |
| Order has not been delivered, a line is final sale, already returned, or past its category window | `deny` with one or more reasons |
| Eligible lines; refund is at most $250 after fees | `auto` with a quote |
| Eligible lines; refund is above $250 or has a review reason | `review` with a quote and reasons |

`quote()` calculates the line subtotal, a 15% fee for opened electronics, and
shipping reimbursement for damaged or wrong-item returns. It also formats the
refund target from the verified order’s payment method. The model sees the
result later, but cannot change it.

<div class="callout callout--note"><span class="callout__title">Two sources of protection</span><p>The prompt says not to promise eligibility or money. The handler and policy engine enforce that rule even if the model ignores the prompt: only the engine decides the route, quote, and committed refund.</p></div>

Next: [4. Approval holds and session restoration](/docs/tutorials/support-flow/approval-holds/).
