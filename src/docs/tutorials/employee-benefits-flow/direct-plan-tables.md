---
title: 7. Exact plan tables and response fallback
eyebrow: EmployeeBenefitsFlow tutorial
lede: Use code-rendered responses when a plan comparison, limit, or review must be complete and exact.
source: pico-demo/src/myflow/employee-benefits-flow/backend/benefits-presenter.ts, pico-demo/src/myflow/employee-benefits-flow/medical-plan-step.ts, pico-demo/src/myflow/employee-benefits-flow/dependent-care-step.ts
---

Friendly model prose is useful for questions and transitions, but it is a poor place to reproduce a plan table exactly. The demo has a `BenefitsPresenter` that turns deterministic policy results into authoritative Markdown for medical comparisons, dental options, life coverage explanations, dependent-care FSA information, and the enrollment review.

The medical comparison includes the terms an employee needs to distinguish the fictional HDHP and PPO choices: per-paycheck and annual payroll cost, deductible, out-of-pocket maximum, prescriptions, network coverage, and HSA eligibility plus employer funding. Those values come from the policy result, not from prompt text or model memory.

## Present exact facts at entry

The plan-evaluation logic stage transitions with `needsPresentation: true`. On entry to medical-plan selection, the step uses that flag to return the direct comparison before asking for an election. If the model later responds without presenting the required table, the step's response fallback can render it directly instead.

```ts
if (state.needsPresentation) {
  return BenefitsPresenter.medicalPlanComparison(state.evaluation);
}
```

This is not an attempt to remove the model from the experience. The model still answers conversational questions and routes tool calls. It simply cannot omit or alter the factual table that decision requires.

## Apply the pattern to sensitive explanations

The dependent-care stage likewise uses a direct explanation at entry and as a fallback. Its response distinguishes the fictional dependent-care FSA from a healthcare FSA, names the fictional $5,000 annual limit, and then asks the user to elect an annual amount or waive it. The user receives the required disclosure even if the preceding model response would otherwise drift into a generic answer.

Use direct presentation when all of these are true:

1. The content is derived from structured policy data.
2. Omission of one field would change the user's decision or violate a requirement.
3. The facts can be rendered from code without an LLM.

For exploratory explanations or normal conversational transitions, model text remains appropriate. The point is not “always bypass the model”; it is to make the factual boundary explicit.

## Test both policy and language boundaries

The scenario's semantic checks look for the comparison's required terms and the dependent-care distinction. Deterministic tests separately assert policy behavior such as eligibility, provider lookup, contribution validation, record creation, and pricing. Together they catch two different failures: a correct policy result that was not communicated, and polished language that did not produce a correct state change.

Return to the [EmployeeBenefitsFlow overview](/docs/tutorials/employee-benefits-flow/) or read [the twenty-two-turn live replay](/docs/tutorials/employee-benefits-flow/twenty-two-turn-scenario/).
