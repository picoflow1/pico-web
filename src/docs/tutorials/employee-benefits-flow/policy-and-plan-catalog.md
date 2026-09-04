---
title: 4. Deterministic eligibility, plans, and limits
eyebrow: EmployeeBenefitsFlow tutorial
lede: Make the policy layer the single source of truth for every factual enrollment decision.
source: pico-demo/src/myflow/employee-benefits-flow/backend/benefits-policy.ts, pico-demo/src/myflow/employee-benefits-flow/plan-evaluation-step.ts
---

`BenefitsPolicy` contains the fictional employee directory, enrollment-window rules, medical and ancillary plan catalog, provider directory, contribution limits, pricing, and submitted-record construction. Its job is not to sound friendly; its job is to return a repeatable answer from structured inputs.

That makes these decisions deterministic:

| Decision | Policy operation | Why it belongs in code |
| --- | --- | --- |
| Can this employee enroll now? | Eligibility and enrollment-window evaluation | It must be traceable and testable. |
| Which medical plans can this household select? | Plan evaluation | Premiums, deductibles, networks, and HSA eligibility are facts. |
| Is the provider in network? | Provider lookup | A conversational guess is unsafe. |
| Is this HSA, healthcare FSA, or dependent-care election valid? | Account and dependent-care validation | Compatibility and caps require exact arithmetic. |
| What is the payroll total and final record? | Pricing and enrollment submission | A result must be reproducible across retries. |

## Evaluate before conversation resumes

The plan-evaluation stage is a `LogicStep`. It runs after intake is complete, before the medical-plan conversation begins:

```ts
const evaluation = BenefitsPolicy.evaluateMedicalPlans({
  request,
  eligibility,
  household,
  preferences,
});

return this.goto(MedicalPlanStep).withState({ evaluation, needsPresentation: true });
```

The `needsPresentation` flag is a useful handoff: policy has already decided the available options; the next step knows to present the authoritative comparison before collecting a choice.

## Model corrections as ordinary outcomes

The policy does not merely return success or throw an error. It returns validation results the stage can turn into a clear correction path. The demo, for example, rejects an annual HSA election above its fictional family limit, validates that a dependent-care election does not exceed its fictional $5,000 cap, and keeps beneficiary collection active until the allocations total exactly 100 percent.

The numbers and catalog in this tutorial are demo fixtures, not benefits guidance. In production, integrate approved plan documents, eligibility and payroll systems, authorization, audit trails, and the employer's rules. The architectural rule remains the same: one policy authority, invoked from narrow flow stages.

Next: [scope the conversation with memory namespaces and expiry](/docs/tutorials/employee-benefits-flow/memory-and-expiry/).
