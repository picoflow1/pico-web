---
title: 2. Designing an enrollment journey
eyebrow: EmployeeBenefitsFlow tutorial
lede: Break a complex enrollment into stages with one clear responsibility and explicit state handoffs.
source: pico-demo/src/myflow/employee-benefits-flow/employee-benefits-flow.ts, pico-demo/src/myflow/employee-benefits-flow/step
---

Enrollment is not one form with a chat skin. It is a sequence of decisions whose prerequisites matter: there is no meaningful plan comparison before eligibility and household tier, and there must be no submission before a complete review.

The flow uses 13 stages:

```text
Eligibility → Household → Preferences → Plan evaluation → Medical plan
                                                ↓
Benefits ineligible                         Health account → Ancillary benefits
                                                               ↓
Beneficiaries → Dependent-care FSA → Review → Commit → End
```

`Eligibility`, `Household`, and `Preferences` collect the facts needed to make a recommendation. `PlanEvaluation` is a `LogicStep`: it has no model conversation and deterministically turns those facts into a plan evaluation. The later stages collect elections, then `CommitEnrollment` is another `LogicStep` that creates the final result.

| Stage | Owns | Does not own |
| --- | --- | --- |
| Eligibility | Employee identifier, plan year, enrollment event, eligibility result | Benefit prices or tax limits |
| Household | Coverage tier and eligible dependents | Medical-plan recommendation |
| Preferences | Broad, non-diagnostic priorities | Any eligibility decision |
| Plan evaluation | Deterministic comparison input | User-facing wording |
| Medical through dependent care | One election domain per stage | Final submission |
| Review | A read-only application view and targeted corrections | Repricing or record creation |
| Commit | The submitted enrollment record | Further collection |

## Keep transitions meaningful

Each state has a reason to exist. The medical plan stage may answer a network question or show a comparison without accepting a plan selection. The health-account stage can reject an incompatible HSA or a contribution above the demo limit and remain active. The beneficiary stage remains active until its allocations total 100 percent.

This makes a correction a normal transition outcome rather than an exceptional failure. A user never has to restart the flow merely because a contribution or allocation needs adjustment.

## Use a logic stage for a pure decision

`PlanEvaluationStep` reads completed intake state, calls the deterministic policy, and writes its evaluation before moving into the conversational medical-plan stage. The model does not invent which plans are available or how their costs compare.

```ts
const evaluation = BenefitsPolicy.evaluateMedicalPlans({
  request,
  eligibility,
  household,
  preferences,
});

return this.goto(MedicalPlanStep).withState({ evaluation });
```

The final commit uses the same pattern: it reads the reviewed application and creates a stable enrollment record. Keep LLM interaction at the human-facing boundaries; keep the decision and write boundary deterministic.

Next: [put collection rules in focused prompt files](/docs/tutorials/employee-benefits-flow/prompt-files/).
