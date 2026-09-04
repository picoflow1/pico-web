---
title: 5. Memory namespaces and expiry
eyebrow: EmployeeBenefitsFlow tutorial
lede: Carry only the conversational context each stage needs, while the session record remains the durable source of truth.
source: pico-demo/src/myflow/employee-benefits-flow/employee-benefits-flow.ts, pico-demo/src/myflow/employee-benefits-flow/medical-plan-step.ts
---

The flow gives related intake stages a shared `benefits-intake` memory namespace, then isolates later domains. That preserves enough continuity for the early conversation without carrying every prior plan question and correction into every later model call.

| Namespace | Stages | Purpose |
| --- | --- | --- |
| `benefits-intake` | Eligibility, household, preferences | Maintain a coherent intake conversation; this is the namespace eligible for summary compaction. |
| `medical` | Medical plan | Keep comparisons and network questions close to plan selection. |
| `accounts` | Health account | Keep HSA and healthcare FSA discussion separate from plan selection. |
| `ancillary` | Dental, vision, life, disability | Isolate optional-benefit choices. |
| `beneficiaries` | Beneficiary allocation | Avoid leaking personal allocation details into unrelated stages. |
| `dependent-care` | Dependent-care FSA | Scope childcare-related questions to this stage. |
| `review` | Application review | Reconstruct facts from saved state instead of relying on the entire chat history. |

## State is durable; memory is conversational

The saved session state holds the request, eligibility result, evaluation, elections, review changes, and final record. Memory helps the model maintain a natural dialogue but is not the authoritative place to recover business facts.

That is why stages may clear their own memory on entry. For instance, when the employee reaches medical-plan selection, the flow can start that discussion cleanly while still reading the deterministic plan evaluation from state. The review stage similarly reads the current application from policy code rather than trusting a long conversation summary.

## Make abandonment explicit

The session has a 45-minute idle expiry. On restore, the flow can decide how to handle expired or incomplete cases using its own restoration policy. This is an important boundary: the persistence store loads the session document, while the flow decides whether the enrollment may continue and what to tell the user.

Use a duration and restore policy that fit the actual enrollment process. A production journey might need authentication renewal, a new eligibility check, or a new consent screen after restoration; it should not assume an old chat message is still authorization to submit.

Next: [design correction and review paths](/docs/tutorials/employee-benefits-flow/correct-and-review/).
