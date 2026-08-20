---
title: 1. Designing a support case
eyebrow: SupportFlow tutorial
lede: A support case changes jobs several times—verification, return intake, approval, billing, and closure. SupportFlow makes each job a step and reserves policy decisions for deterministic code.
source: pico-demo/src/myflow/support-flow/support-flow.ts, pico-demo/src/myflow/support-flow/support-types.ts
---

SupportFlow is not one large support-agent prompt. It is a case coordinator with
specialists. The distinction matters because the work changes shape as the
conversation progresses: verifying identity is not collecting a return reason;
explaining a precomputed approval request is not validating charges; and none of
those tasks should decide a refund or invent a billing outcome.

## The goal

- Split a customer-support journey at the points where instructions, data, and
  authority change.
- Read `defineSteps()` as a registry of possible destinations, not a linear
  script.
- Give conversational work to `Step` and irreversible business decisions to
  `LogicStep`.
- Choose an owner for each durable fact in the case.

## The journey and its seams

The demo supports one narrow domain: an existing Northwind Outfitters order.
Within that scope, its customer journey has seven distinct jobs:

```text
1. Verify an order and understand the request             -> TriageStep
2. Collect a return item and reason                       -> ReturnsStep
3. Apply windows, fees, and authority rules               -> AdjudicateStep
4. Ask for approval of a review-required refund           -> ApprovalStep
5. Collect a billing dispute                              -> BillingStep
6. Create a factual billing ticket                        -> EscalateStep
7. End a case only after an outcome is recorded           -> TerminateSessionStep
```

The third and sixth jobs are not model turns. Their input is already structured
and their output affects money or a durable case record, so they are `LogicStep`s.
The others use a model to collect facts or explain results, but their tool handlers
still validate what the model supplies.

## The flow class

From `pico-demo/src/myflow/support-flow/support-flow.ts`:

```ts
export class SupportFlow extends Flow {
  constructor() {
    super();
    this.getMemory()
      .setSummaryModel({ provider: "openai", name: "gpt-4o" })
      .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
      .enableSummary("support-triage");
  }

  protected configModel() {
    return { provider: "openai", name: "gpt-4o" } as const;
  }

  protected defineSteps(): Step[] {
    return [
      new TriageStep(this).useMemory("support-triage").useModel({
        provider: "openai", name: "gpt-4o", params: { temperature: 0.3 },
      }),
      new ReturnsStep(this).useMemory("support-returns").useModel({
        provider: "openai", name: "gpt-5.1", params: { reasoning: { effort: "low" } },
      }),
      new AdjudicateStep(this),
      new ApprovalStep(this).useMemory("support-approval").useModel({
        provider: "openai", name: "gpt-5.1", params: { reasoning: { effort: "low" } },
      }),
      new BillingStep(this).useMemory("support-billing"),
      new EscalateStep(this).useMemory("support-billing"),
      new TerminateSessionStep(this).useMemory("support-terminal"),
    ];
  }
}
```

The first array entry is the initial cursor, so a new session begins at
`TriageStep`. The array order does not constrain later transitions: a returns
request can visit `ReturnsStep`, then `AdjudicateStep`, then either return to
returns, move to approval, or go back to triage. Every edge is explicit in the
step that owns the decision to cross it.

## The case graph

```text
                     +---------------+
                     |  TriageStep   |
                     | verify / route|
                     +---------------+
                       |           |
                 returns|           |billing
                       v           v
              +-------------+ +-------------+
              | ReturnsStep | | BillingStep |
              +-------------+ +-------------+
                       |           |
                       v           v
              +----------------+ +--------------+
              | AdjudicateStep | | EscalateStep |
              |   LogicStep    | |  LogicStep   |
              +----------------+ +--------------+
                | deny  | review/auto   |
                v       v               |
          ReturnsStep ApprovalStep ------+
                        |        |
                   decline    confirm
                        |        |
                        v        v
                  ReturnsStep TriageStep -- close_case --> terminal
```

The two loops are intentional. A return can be denied and corrected without
starting a new case, while a declined approval returns to the returns specialist
instead of committing a refund. Both a successful refund and a billing ticket
converge on triage, where the customer can start another concern or close the
case with a recap.

## State has an owner

The types in `support-types.ts` reveal the ownership model:

| State | Owning step | Why it belongs there |
| --- | --- | --- |
| `order`, `refunds`, `tickets` | `TriageStep` | They describe the case as a whole and are needed when it closes. |
| `returnedLineIds`, `lastDenial` | `ReturnsStep` | They keep return-specific facts and prevent a duplicate return. |
| `request`, `decision`, `adjudication` | `AdjudicateStep` | They record the policy decision that followed one return request. |
| `pending`, `decidedAt` | `ApprovalStep` | A quote exists only while it waits for a customer decision. |
| `dispute` | `BillingStep` | It is the validated input to escalation. |
| `ticket` | `EscalateStep` | It is the deterministic record just created from that dispute. |

Steps can read another owner’s state with `flow.getStepState(...)` and can prime
another owner with `flow.saveStepState(...)`. That is better than duplicating the
whole case in every prompt: the facts stay durable and attributable, while each
specialist receives only the state it needs.

## Step boundaries are authority boundaries

`ReturnsStep` may recognize a customer’s item and reason; it cannot declare the
item eligible. `ApprovalStep` may explain the exact breakdown; it cannot change
the amount. `BillingStep` may collect a dispute; it cannot promise a credit.
Those boundaries are implemented in the code, not merely requested in the
prompt, which makes them survive a model’s occasional bad judgment.

Next: [2. Verifying and routing requests](/docs/tutorials/support-flow/verify-and-route/).
