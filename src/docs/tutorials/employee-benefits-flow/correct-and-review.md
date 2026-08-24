---
title: 6. Correct, review, and submit
eyebrow: EmployeeBenefitsFlow tutorial
lede: Preserve valid work, isolate the correction, and turn final submission into an explicit deterministic boundary.
source: pico-demo/src/myflow/employee-benefits-flow/step/health-account-step.ts, pico-demo/src/myflow/employee-benefits-flow/step/beneficiary-step.ts, pico-demo/src/myflow/employee-benefits-flow/step/enrollment-review-step.ts, pico-demo/src/myflow/employee-benefits-flow/step/commit-enrollment-step.ts
---

Complex enrollment is full of recoverable mistakes. A contribution may exceed a limit, a beneficiary allocation may total 90 percent, or a user may revise an election after seeing the review. Those are normal branches, not reasons to discard the session or ask the model to reconstruct the whole application.

## Correct within the owning stage

The account stage validates each annual HSA or healthcare FSA election against the selected medical plan and the demo rules. If the user enters an invalid amount, it returns the validation result and stays in the account stage. The user can correct the number without repeating medical-plan selection.

Beneficiary collection follows the same pattern. An allocation below 100 percent does not require a specific repair strategy: the user may add a beneficiary or adjust existing percentages. The only invariant is the completed total.

| Correction | Owner | Recovery rule |
| --- | --- | --- |
| HSA contribution exceeds the limit | Health account stage | Explain the maximum and request a corrected annual election. |
| HSA selected with a non-compatible medical plan | Health account stage | Explain the compatibility rule; collect a compatible account choice or waiver. |
| Beneficiaries total less than or more than 100% | Beneficiary stage | Keep the stage active until the saved allocation totals exactly 100%. |
| Dependent-care FSA exceeds its cap | Dependent-care stage | Explain the fictional cap and request a corrected election or waiver. |
| A review change affects payroll cost | Review stage and policy | Recompute the application view from state before final confirmation. |

## Review from state, not remembered prose

The review stage calls the policy layer to read the enrollment application. It can show the selected medical plan, account elections, ancillary elections, beneficiaries, dependent-care election, payroll total, and pending evidence-of-insurability requirement. It does not create a second source of truth by re-summarizing values from chat history.

A targeted review change—such as changing the healthcare contribution—updates the relevant saved state and regenerates the review. That lets the user see the consequence of a correction before granting final confirmation.

## Commit only after confirmation

`CommitEnrollmentStep` is a `LogicStep`, not an LLM step. It creates a deterministic fictional enrollment record with its final status and effective date, then transitions to session termination. The stage does not infer consent from a vague prior message, and it does not allow the model to invent an enrollment ID or final price.

This boundary is especially valuable for a real benefits workflow. The submit action should be idempotent, auditable, authorized, and tied to the exact application the user reviewed. The demo illustrates the separation of responsibilities, not a production approval process.

Next: [render exact plan facts directly from code](/docs/tutorials/employee-benefits-flow/direct-plan-tables/).
