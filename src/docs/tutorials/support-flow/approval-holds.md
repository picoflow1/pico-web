---
title: 4. Approval holds and session restoration
eyebrow: SupportFlow tutorial
lede: A review-required refund is a temporary offer, not a completed transaction. ApprovalStep presents the computed quote, commits only explicit consent, and the flow invalidates a hold that has aged out.
source: pico-demo/src/myflow/support-flow/approval-step.ts, pico-demo/src/myflow/support-flow/support-flow.ts, pico-demo/src/myflow/support-flow/gen-receipt.ts
---

Some return requests are eligible but need the customer to approve an exact
amount. SupportFlow treats that as a stateful hold: `AdjudicateStep` writes a
fixed `PendingRefund` to `ApprovalStep`; the approval step presents it without
editing it; one explicit tool call either commits or abandons it.

## The goal

- Carry a policy-computed quote into a conversational approval step without
  asking the model to calculate it again.
- Separate an ambiguous answer from a committed confirmation.
- Atomically update the case and return-specific state when a refund commits.
- Use `onRestoreSessionDoc()` to expire a hold before an old customer can accept it.

## The approval prompt contains the exact immutable offer

The destination state is established by the `review` branch in
`AdjudicateStep`. `ApprovalStep.getPrompt()` refuses to run without it:

```ts
getPrompt(): string {
  const pending = this.getState<PendingRefund>("pending");
  if (!pending) throw new Error("ApprovalStep requires a pending refund.");

  return `${supportRole}\n\n${approvalInstructions
    .replace("{{PENDING}}", JSON.stringify({
      orderId: pending.request.orderId,
      lineIds: pending.request.lineIds,
      reason: pending.request.reason,
      reasons: pending.reasons,
    }))
    .replace("{{BREAKDOWN}}", GenReceipt.quoteTable(pending.quote))}`;
}
```

`GenReceipt.quoteTable()` builds the markdown table from the `RefundQuote`:
each selected line, items subtotal, any restocking fee, any shipping refund,
and the net refund to the recorded payment method. It does not receive a model
argument. The generated prompt tells the model to present every value exactly
as supplied and to ask for an unambiguous yes or no.

## The only two actions

```ts
defineTool(): ToolType[] {
  return [
    { name: "confirm_refund",
      description: "Commit the exact pending refund after clear customer confirmation.",
      schema: z.object({ confirmed: z.boolean() }) },
    { name: "decline_refund",
      description: "Abandon the pending refund and return to the returns specialist.",
      schema: z.object({ declined: z.boolean() }) },
  ];
}
```

The booleans do not make model output authoritative. The confirmation handler
guards the only irreversible branch:

```ts
@Tool
protected async confirm_refund(args: { confirmed: boolean }) {
  if (!args.confirmed) {
    return stay("Only an explicit confirmation commits this refund.");
  }
  const pending = requirePending(this);
  const refund: RefundRecord = {
    rma: generateRma(),
    orderId: pending.request.orderId,
    lineIds: pending.request.lineIds,
    netRefund: pending.quote.netRefund,
    refundTarget: pending.quote.refundTarget,
    authority: "customer_confirmed",
  };
  // persist refund and returned lines, remove the pending hold, then go to triage
}
```

“Maybe,” a request to change items, and “hold off” are all prompt-directed to
the decline path or another clarification; `confirmed: false` keeps the cursor
on approval and supplies corrective tool feedback. A handler never turns a
non-confirmation into a refund merely because it reached the tool.

## A confirmation updates every affected owner

On success, the handler appends the refund to triage state and the selected
lines to returns state before clearing its own temporary state:

```ts
const triage = this.flow.getStepState<RefundRecord[]>(TriageStep, "refunds") ?? [];
const returned = this.flow.getStepState<string[]>(ReturnsStep, "returnedLineIds") ?? [];

this.flow.saveStepState(TriageStep, { refunds: [...triage, refund] });
this.flow.saveStepState(ReturnsStep, {
  returnedLineIds: [...returned, ...pending.request.lineIds],
});
this.removeState("pending");
this.saveState({ decidedAt: new Date().toISOString() });
return go(TriageStep);
```

The case hub owns the refund because it will use it in later turns and in the
closing recap. The returns step owns `returnedLineIds` because it must refuse a
second request for the same item. `pending` is removed so the approval cannot
be confirmed twice. `decidedAt` is an audit marker for this approval step.

Declining performs the symmetric cleanup—remove `pending`, save `decidedAt`,
and return to `ReturnsStep` with an empty denial list. The customer can choose
a different item without being told that their valid declined offer was a
policy denial.

## Expiring an old hold at restore time

An approval request is sensitive to time. The flow overrides session restore:

```ts
protected async onRestoreSessionDoc(session: SessionType): Promise<SessionType | null> {
  const restored = await super.onRestoreSessionDoc(session);
  if (!restored) return null;

  const idleMs = Date.now() - restored.saveOn.getTime();
  if (idleMs >= readMs("SUPPORT_FLOW_IDLE_MS", DEFAULT_IDLE_MS)) return null;
  if (restored.flow.currentStep !== ApprovalStep.id ||
      idleMs < readMs("SUPPORT_FLOW_APPROVAL_HOLD_MS", DEFAULT_APPROVAL_HOLD_MS)) {
    return restored;
  }

  const approval = restored.flow.steps.find((step) => step.name === ApprovalStep.id);
  if (approval) {
    const { pending: _pending, ...released } = approval.state as Record<string, unknown>;
    approval.state = released;
  }
  restored.flow.currentStep = TriageStep.id;
  return restored;
}
```

The global idle timeout defaults to 30 minutes. If it has elapsed, returning
`null` tells the engine to discard the session and begin a new case. The
approval-specific timeout defaults to 10 minutes. Between ten and thirty
minutes, the flow preserves the case but removes the quoted offer and resets
the cursor to triage. The customer can begin another request, but cannot accept
a stale amount.

Both settings are configurable through `SUPPORT_FLOW_IDLE_MS` and
`SUPPORT_FLOW_APPROVAL_HOLD_MS`; only positive, finite values override the
defaults. The restore hook reads the persisted document before the next model
turn, which is the correct point to enforce a time-dependent business rule.

Next: [5. Billing disputes and escalation](/docs/tutorials/support-flow/billing-escalation/).
