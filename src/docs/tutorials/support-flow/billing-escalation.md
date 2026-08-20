---
title: 5. Billing disputes and escalation
eyebrow: SupportFlow tutorial
lede: BillingStep collects a factual charge dispute but derives its amount from the ledger. EscalateStep then creates the ticket as deterministic work before control returns to triage.
source: pico-demo/src/myflow/support-flow/billing-step.ts, pico-demo/src/myflow/support-flow/escalate-step.ts, pico-demo/src/myflow/support-flow/backend/order-book.ts
---

Refunds and billing disputes have different authority. A return can result in a
defined policy outcome; a suspected bad charge needs a record for the billing
team to review. SupportFlow therefore never promises a credit, reversal, or
timeline in the billing path. It captures facts, validates them, and creates a
ticket.

## The goal

- Give the model a bounded set of ledger facts, not permission to invent an
  amount or outcome.
- Recompute sensitive values from the source of truth in a tool handler.
- Use response-driven recognition only when a message contains known charge IDs.
- Create the durable ticket in `LogicStep`, with no second model tool call.

## The billing prompt is a view of the verified order

`BillingStep` starts only after triage has verified an order. It builds the
prompt from a small order summary, the full charge list, and the duplicate-charge
subset:

```ts
getPrompt(): string {
  const order = requireOrder(this.flow);
  const source = OrderBook.find(order.orderId)!;
  return `${supportRole}\n\n${billingInstructions
    .replace("{{ORDER}}", JSON.stringify({
      orderId: order.orderId, placedAt: order.placedAt, paymentMethod: order.paymentMethod,
    }))
    .replace("{{CHARGES}}", JSON.stringify(source.charges))
    .replace("{{DUPLICATES}}", JSON.stringify(OrderBook.duplicateCharges(source)))}`;
}
```

The instructions tell the model to use ledger charge IDs, ask for at most one
missing fact, and avoid promises. The important property is not the wording,
though: the handler has access to the same order book and refuses unrecognized
charges.

## The handler corrects an untrusted total

The tool schema includes `amountInDispute` so a model can describe its intent,
but the value is not trusted:

```ts
@Tool
protected async open_dispute(args: {
  chargeIds: string[]; description: string; amountInDispute: number;
}): Promise<ToolResponseType> {
  const order = OrderBook.find(requireOrder(this.flow).orderId)!;
  const ledger = new Map(order.charges.map((charge) => [charge.chargeId.toUpperCase(), charge]));
  const ids = [...new Set(args.chargeIds.map((id) => id.trim().toUpperCase()))];
  const unknown = ids.filter((id) => !ledger.has(id));
  if (unknown.length) return stay(`These charges are not on order ${order.orderId}: ${unknown.join(", ")}.`);

  const amountInDispute = round(ids.reduce(
    (sum, id) => sum + (ledger.get(id)?.amount ?? 0), 0,
  ));
  const dispute = { orderId: order.orderId, chargeIds: ids,
    description: args.description.trim(), amountInDispute };
  const response = this.routeToEscalation(dispute);
  return round(args.amountInDispute) === amountInDispute
    ? response.withToolFeedback("Dispute accepted.")
    : response.withToolFeedback(`The disputed total was corrected to ${GenReceipt.formatCurrency(amountInDispute)} from the order ledger.`);
}
```

The selected IDs are normalized and deduplicated. The total is the sum of the
local ledger entries, rounded to cents; a made-up or mis-added model amount is
replaced, with feedback that explains the correction. The route writes the
validated `dispute` in billing state and passes the same object to
`EscalateStep`.

## A narrow response-driven path

The step also recognizes a clear charge reference directly from the latest
customer message:

```ts
public override async onResponse(llmResult: string | object) {
  const dispute = this.inferDispute();
  if (dispute) return this.routeToEscalation(dispute);
  return super.onResponse(llmResult);
}
```

`inferDispute()` accepts only text containing one or more `CH-<digits>` IDs,
looks every ID up in the ledger, and calculates the same derived amount. A
vague “the charge looks wrong” remains in the conversational step so the model
can ask which charge is in dispute. A precise “CH-88301 is wrong” can move
straight into escalation.

## Ticket creation is not delegated back to the model

`EscalateStep` is a `LogicStep`, so its `runLogic()` executes in the same
workflow progression as the route:

```ts
async runLogic(): Promise<LogicResponseType> {
  const dispute = this.getState<BillingDispute>("dispute");
  const order = OrderBook.find(dispute!.orderId)!;
  const charges = order.charges.filter((charge) =>
    dispute!.chargeIds.includes(charge.chargeId.toUpperCase()));
  const duplicate = charges.length > 1 &&
    new Set(charges.map((charge) => charge.amount)).size < charges.length;

  const ticket: EscalationTicket = {
    ticketId: `ESC-${Math.floor(10000 + Math.random() * 90000)}`,
    category: duplicate ? "duplicate_charge" : "wrong_amount",
    customerImpact: dispute!.amountInDispute > 250 ? "high" :
      dispute!.amountInDispute >= 50 ? "medium" : "low",
    amountInDispute: dispute!.amountInDispute,
    // summary, requested remedy, and openedAt are built from the same facts
  };
  this.saveState({ ticket });
  const tickets = this.flow.getStepState<EscalationTicket[]>(TriageStep, "tickets") ?? [];
  return go(TriageStep).withState({ tickets: [...tickets, ticket] });
}
```

The ticket category, impact, amount, and charge facts derive from the validated
ledger selection. The ticket is appended to triage-owned case state before the
hub receives control. Therefore the next triage prompt can truthfully provide
the ticket ID and say the billing team will review it—without claiming the
customer will receive a credit.

Next: [6. Memory and durable case state](/docs/tutorials/support-flow/memory-and-case-state/).
