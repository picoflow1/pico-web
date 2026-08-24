---
title: 3. Prompt files and bounded collection
eyebrow: EmployeeBenefitsFlow tutorial
lede: Let the model guide a concise conversation, but never let it become the source of eligibility, money, or plan facts.
source: pico-demo/src/myflow/employee-benefits-flow/prompt, pico-demo/src/myflow/employee-benefits-flow/step/eligibility-step.ts
---

Each conversational stage has a focused prompt file. The prompt tells the model what to collect, when to call a stage tool, and what it must not decide. This is deliberately narrower than a single assistant prompt that attempts to carry the whole enrollment policy.

For example, the eligibility prompt collects the employee ID, plan year, and enrollment event. Once complete, it must call the eligibility tool immediately. It does not ask the user to confirm a complete open-enrollment intake before checking eligibility, and it does not calculate eligibility in prose.

```text
When the request is complete, call check_benefits_eligibility immediately.
Do not ask for confirmation before calling it.
For open enrollment, do not ask for an event date.
```

The step validates the structured input and then makes the code-owned decision:

```ts
const request = EnrollmentRequestSchema.parse(input);
const decision = BenefitsPolicy.evaluateEligibility(request);

return decision.eligible
  ? this.goto(HouseholdStep).withState({ request, decision })
  : this.goto(IneligibleBenefitsStep).withState({ request, decision });
```

## Keep prompts stage-specific

The plan, account, beneficiary, and dependent-care prompts each have different constraints:

| Prompt | Model responsibility | Code responsibility |
| --- | --- | --- |
| Medical plan | Ask which option the employee wants; route comparison and provider questions | Plan terms, network lookup, selection validation |
| Health account | Clarify HSA or healthcare FSA intent | Compatibility, employer funding, and contribution limits |
| Beneficiary | Collect names, relationships, and allocations | Require a complete 100% allocation |
| Dependent care | Explain the fictional dependent-care FSA and ask for an election or waiver | Child eligibility and annual cap |
| Review | Answer what the existing application contains; collect a targeted change or confirmation | Application read, repricing, and submit gate |

This separation produces better recovery behavior. If a user enters an invalid annual amount, code returns the exact reason and keeps the stage active; the prompt then helps the model ask for a corrected election rather than improvising a workaround.

## Prompt only for facts the model needs

Do not put the whole plan catalog, employee directory, or arithmetic rules into prompt text. That makes prompts difficult to update and creates a second, less reliable policy implementation. Instead, expose a narrow tool for each factual operation and use direct code-rendered responses for exact tables and limits.

The prompts also explicitly frame the sample as fictional and avoid collecting unneeded sensitive data. A production enrollment flow needs an approved data model, identity controls, and employer-specific privacy review; a better prompt does not replace those controls.

Next: [move eligibility, plan, and limit decisions into deterministic policy](/docs/tutorials/employee-benefits-flow/policy-and-plan-catalog/).
