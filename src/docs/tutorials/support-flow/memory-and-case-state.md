---
title: 6. Memory and durable case state
eyebrow: SupportFlow tutorial
lede: SupportFlow gives each specialist a separate conversation history while keeping the verified order and committed outcomes in step-owned durable state. Only the long-running triage history is summarized.
source: picoflow-demo/src/myflow/support-flow/support-flow.ts, picoflow-demo/src/myflow/support-flow/triage-step.ts, picoflow-demo/src/myflow/support-flow/returns-step.ts, picoflow-demo/src/myflow/support-flow/approval-step.ts
---

A customer-support case can last a while and can enter several specialist
stages. If every stage shared one transcript, a returns agent would inherit
every billing detail and a billing agent would need to rediscover which earlier
messages were relevant. If nothing crossed a step boundary, specialists would
not know the verified order or the case outcomes. SupportFlow uses separate
mechanisms for those two concerns: memory namespaces for conversation history
and step state for durable facts.

## The goal

- Assign a memory namespace based on who needs to remember the conversation.
- Enable compaction only on the one namespace that can accumulate many turns.
- Read and write data across step boundaries without copying it into history.
- Distinguish a temporary in-progress value from a committed case outcome.

## Four histories, one case

The registrations declare the conversation partitions:

```ts
new TriageStep(this).useMemory("support-triage").useModel({
  provider: "openai", name: "gpt-4o", params: { temperature: 0.3 },
}),
new ReturnsStep(this).useMemory("support-returns").useModel({
  provider: "openai", name: "gpt-5.1", params: { reasoning: { effort: "low" } },
}),
new ApprovalStep(this).useMemory("support-approval").useModel({
  provider: "openai", name: "gpt-5.1", params: { reasoning: { effort: "low" } },
}),
new BillingStep(this).useMemory("support-billing"),
new EscalateStep(this).useMemory("support-billing"),
new TerminateSessionStep(this).useMemory("support-terminal"),
```

`TriageStep` is the only stage expected to resume several times: it verifies an
order, receives a return outcome, receives a billing outcome, and may answer
another question before closing. Returns, approval, and billing each get their
own short, task-specific history. `EscalateStep` shares billing’s namespace but
is a `LogicStep`, so it does not make a model call; the shared name retains the
meaning of that branch without creating an unnecessary new history.

## Compaction is opt-in and scoped

The constructor opts in only the triage namespace:

```ts
this.getMemory()
  .setSummaryModel({ provider: "openai", name: "gpt-4o" })
  .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
  .enableSummary("support-triage");
```

The summary model writes a compressed account once that namespace reaches eight
messages, keeping the four newest raw messages. The other namespaces are not
summarized. That is a good fit for this flow: the hub benefits from remembering
previous case outcomes across a long conversation, while each specialist has a
short closed task and receives the exact current facts through its prompt.

The namespace passed to `enableSummary()` must exactly match the namespace used
by `.useMemory(...)`. Configuring a summary model by itself does not compact any
history; the flow has to opt a namespace in.

## Conversation history is not the database

The hub keeps the case-wide records in its own state:

```ts
const order = this.getState<VerifiedOrder>("order") ?? null;
const caseState = {
  refunds: this.getState<RefundRecord[]>("refunds") ?? [],
  tickets: this.getState<EscalationTicket[]>("tickets") ?? [],
};
```

Those values are injected into its prompt on every turn. Neither a memory
summary nor the exact wording of a prior model response is authoritative. If
the customer returns after a long idle period and asks “what did we do?”, the
hub can use the stored RMA and ticket records rather than relying on a summary
to reproduce an amount or identifier.

Specialists read the facts they need from their owners. For example, returns
loads the verified order from triage:

```ts
function requireOrder(flow: Flow): VerifiedOrder {
  const order = flow.getStepState<VerifiedOrder>(TriageStep, "order");
  if (!order) throw new Error("ReturnsStep requires a verified order from TriageStep.");
  return order;
}
```

This is a deliberate invariant: reaching the returns specialist without prior
verification is a programming error, not an invitation to make the model ask
again. The triage router separately guards that route, so a normal customer
cannot create this state.

## State moves across boundaries by ownership

The main updates in a confirmed refund show the pattern:

```ts
const refunds = this.flow.getStepState<RefundRecord[]>(TriageStep, "refunds") ?? [];
const returned = this.flow.getStepState<string[]>(ReturnsStep, "returnedLineIds") ?? [];

this.flow.saveStepState(TriageStep, { refunds: [...refunds, refund] });
this.flow.saveStepState(ReturnsStep, {
  returnedLineIds: [...returned, ...pending.request.lineIds],
});
this.removeState("pending");
```

| Kind of value | Where it lives | Lifecycle |
| --- | --- | --- |
| Verified order, refunds, tickets | Triage state | Lasts for the case and appears in the closing recap. |
| Returned lines and last denial | Returns state | Persists to prevent duplicate processing and explain a correction. |
| Pending line selection | Returns state | Removed once the request moves to policy. |
| Pending quote | Approval state | Removed on decline, confirmation, or an expired approval hold. |
| Validated dispute | Billing state | Used by escalation and retained for the final test assertions. |

The code never makes a refund durable by merely saying it in the transcript.
It appears in `TriageStep.refunds` only after the auto-approval logic or explicit
customer confirmation. That is also why `close_case` can reliably distinguish
an active conversation from a resolved case.

## A forwarded message is different from shared memory

When triage routes a request, it carries `this.getLastMessage()` with
`.withMessage(...)`. That gives the next specialist the immediate customer
request, but it does not merge histories. The returns specialist can therefore
recognize the item the customer just named, while its future model calls remain
free of unrelated triage and billing turns. Durable order and case facts still
arrive from state, where they can be validated and attributed.

Next: [7. Testing a support case](/docs/tutorials/support-flow/testing/).
