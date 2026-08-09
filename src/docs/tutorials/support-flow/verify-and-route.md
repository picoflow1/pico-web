---
title: 2. Verifying and routing requests
eyebrow: SupportFlow tutorial
lede: TriageStep is the durable hub. It verifies an order before exposing its details, carries the customer’s original request into a specialist step, and closes only a case with recorded outcomes.
source: picoflow-demo/src/myflow/support-flow/triage-step.ts, picoflow-demo/src/myflow/support-flow/backend/order-book.ts, picoflow-demo/src/myflow/support-flow/prompt/support-prompt.ts
---

Every SupportFlow session starts at `TriageStep`. Its system prompt receives the
verified order, prior refunds, and prior tickets on every turn. Until an order is
verified, it asks only for an order number and the email or ZIP that proves the
customer may discuss it.

## The goal

- Use a small Zod tool schema to collect verification facts without treating it
  as authorization.
- Keep the cursor at triage with `stay(...)` after either a success or failure.
- Move the customer’s original request across a boundary with `.withMessage(...)`.
- Build a terminal recap from committed state rather than model memory.

## The hub prompt is rebuilt from state

`getPrompt()` reads only triage-owned state and interpolates it into the shared
support instructions:

```ts
getPrompt(): string {
  const order = this.getState<VerifiedOrder>("order") ?? null;
  const caseState = {
    refunds: this.getState<RefundRecord[]>("refunds") ?? [],
    tickets: this.getState<EscalationTicket[]>("tickets") ?? [],
  };
  return `${supportRole}\n\n${triageInstructions
    .replace("{{TODAY}}", new Date().toISOString().slice(0, 10))
    .replace("{{ORDER}}", JSON.stringify(order))
    .replace("{{CASE}}", JSON.stringify(caseState))}`;
}
```

This matters after a specialist returns. A newly committed refund or ticket is
not buried in a previous message and left for the model to remember; the next
triage prompt contains the durable record explicitly.

## A schema describes the call, not the business rule

The three tools define the only actions the hub can take:

```ts
defineTool(): ToolType[] {
  return [
    { name: "verify_order", description: "Verify an order with its email address or ZIP code.",
      schema: z.object({ orderId: z.string().min(1), secret: z.string().min(1) }) },
    { name: "route_request", description: "Route a verified request to a support specialist.",
      schema: z.object({ department: z.enum(["returns", "billing"]) }) },
    { name: "close_case", description: "Close a case with committed outcomes.",
      schema: z.object({ summary: z.string().min(1) }) },
  ];
}
```

Zod ensures that both verification strings are present, but it cannot establish
that they match an order. `OrderBook.verify()` performs that lookup and compares
the normalized candidate to the order’s email or postal code. The handler then
stores a deliberately reduced `VerifiedOrder`, not the entire backing record.

```ts
const order = OrderBook.verify(args.orderId, args.secret);
if (!order) {
  this.saveState({
    verifyAttempts: (this.getState<number>("verifyAttempts") ?? 0) + 1,
  });
  return stay("That order number and email or ZIP code do not match. Ask the customer to check both.");
}

const verified = summarizeOrder(order);
this.saveState({ order: verified, verifyAttempts: 0 });
return stay(JSON.stringify({ accepted: true, order: verified }));
```

Both branches return `stay(...)`. Successful verification is not a route: the
next model call stays at the hub, sees the newly saved order, and can answer a
shipping question or select the appropriate specialist. A failed attempt adds a
counter for auditing but never reveals whether the order number itself exists.

## Route only after verification

The router rechecks the prerequisite even though the prompt says to verify first:

```ts
@Tool
protected async route_request(args: { department: "returns" | "billing" }) {
  if (!this.getState<VerifiedOrder>("order")) {
    return stay("Verify the order before routing the request.");
  }
  const request = this.getLastMessage();
  const target = args.department === "returns" ? go(ReturnsStep) : go(BillingStep);
  return request ? target.withMessage(request) : target;
}
```

`withMessage(request)` is important. The target step has an isolated memory
namespace, so its model would otherwise begin with no evidence of why it was
entered. Forwarding the customer’s actual words lets `ReturnsStep` recognize
“return the rain jacket” and ask only for a reason; it lets `BillingStep` retain
the charge wording. It is a real user message, not a synthetic instruction.

## Closing is guarded too

The `close_case` handler does not trust a model’s assertion that work is done:

```ts
const refunds = this.getState<RefundRecord[]>("refunds") ?? [];
const tickets = this.getState<EscalationTicket[]>("tickets") ?? [];
if (!refunds.length && !tickets.length) {
  return stay("Nothing has been committed on this case yet.");
}

const outcomes = [
  ...refunds.map((refund) =>
    `- RMA ${refund.rma}: ${GenReceipt.formatCurrency(refund.netRefund)} refunded to ${refund.refundTarget}.`),
  ...tickets.map((ticket) =>
    `- Ticket ${ticket.ticketId} (${ticket.category}) is with the billing team.`),
];
return go(TerminateSessionStep).withPrompt(
  `${args.summary.trim()}\n${outcomes.join("\n")}\nThank you for shopping with Northwind Outfitters.`,
);
```

Only a committed `RefundRecord` or `EscalationTicket` unlocks termination. The
model supplies a short summary, but the RMA, amount, payment destination, and
ticket category come from saved state. The terminal step receives the completed
recap through `.withPrompt(...)`.

`TriageStep` also exposes `terminate_session` for an explicit end-of-chat
request. It goes directly to the terminal step, unlike `close_case`, because a
customer can always stop talking even if nothing has been resolved.

Next: [3. Deterministic return policy](/docs/tutorials/support-flow/return-policy/).
