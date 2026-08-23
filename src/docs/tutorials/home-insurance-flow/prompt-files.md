---
title: 3. Prompt files and bounded collection
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: The model asks and explains. Typed tools validate the complete data record, and each stage sees only the state it needs to collect or revise.
source: pico-demo/src/myflow/home-insurance-flow/prompt, pico-demo/src/myflow/home-insurance-flow/qualification-step.ts, pico-demo/src/myflow/home-insurance-flow/property-step.ts, pico-demo/src/myflow/home-insurance-flow/coverage-step.ts
---

Conversation quality comes from focused, reviewable prompt files; data integrity
comes from schemas and tool handlers. HomeInsuranceQuoteFlow keeps those concerns
separate so a friendly explanation cannot accidentally become a rating rule.

## The goal

- Compose a shared safety role with a stage-specific instruction file.
- Inject only authoritative, relevant state into each stage prompt.
- Validate a complete record in a tool handler before changing the cursor.
- Keep calculated values out of collection prompts.

## Prompt files are the readable specification

The shared role lives in
[`prompt/role.md`](https://github.com/picoflowio/pico-demo/blob/main/src/myflow/home-insurance-flow/prompt/role.md).
It says this is a preliminary, non-binding estimate; forbids requests for Social
Security numbers, payment cards, bank information, and birth dates; and forbids
the model from calculating premiums, reason codes, option IDs, or validity dates.

Each stage has a second file: `qualification.md`, `property.md`, `risk.md`,
`coverage.md`, `review.md`, `present.md`, `contact.md`, and `referral.md`. The
TypeScript wrapper is intentionally small:

```ts
// prompt/home-insurance-prompt.ts
export class HomeInsurancePrompt {
  public static readonly Role = Prompt.file("role.md");
}

// qualification-step.ts
const Instructions = Prompt.file("prompt/qualification.md");

public getPrompt(): string {
  return `${HomeInsurancePrompt.Role}\n${Prompt.replace(Instructions, {
    CURRENT_DATE: homeInsuranceCurrentDate().toISOString().slice(0, 10),
    SUPPORTED_STATES: JSON.stringify(quoteConfig.supportedStates),
    QUALIFICATION: JSON.stringify(this.getState<Qualification>("qualification") ?? null),
    CORRECTION_REQUEST: JSON.stringify(this.getState("correctionRequest") ?? null),
  })}`;
}
```

`Prompt.file(...)` resolves relative to the source file, which keeps all of the
flow's text next to the steps it governs. `Prompt.replace(...)` is where the
runtime data enters. It is injected afresh on each turn rather than trusted to
survive in chat history.

## State is context, not instruction

The qualification prompt receives a date, supported state list, its current
qualification record, and an optional correction request. It does **not** receive
the property or an old quote table. Likewise, `CoverageStep` receives only
`COVERAGE` and `CORRECTION_REQUEST`:

```ts
public getPrompt(): string {
  return `${HomeInsurancePrompt.Role}\n${Prompt.replace(Instructions, {
    COVERAGE: JSON.stringify(this.getState<CoveragePreferences>("coverage") ?? null),
    CORRECTION_REQUEST: JSON.stringify(this.getState("correctionRequest") ?? null),
  })}`;
}
```

That small context window makes the model's job obvious: fill or correct one
record, then hand it to the one tool that accepts that record. It also means the
review stage cannot accidentally rate an application while it is still being
collected.

## Tools validate before moving on

The tool schema helps the model produce structured arguments; the handler still
validates them and applies business checks. `QualificationStep` is typical:

```ts
@Tool
protected async capture_home_qualification(args: unknown): Promise<ToolResponseType> {
  const parsed = QualificationSchema.safeParse(args);
  if (!parsed.success) {
    return stay("Collect a valid two-letter state, five-digit ZIP, purchase status, occupancy, and YYYY-MM-DD effective date.");
  }

  const effective = new Date(`${parsed.data.effectiveDate}T00:00:00.000Z`);
  if (Number.isNaN(effective.getTime()) || effective <= current || effective > latest) {
    return stay(`The effective date must be after ${today} and no more than one year later.`);
  }

  this.saveState({ qualification: durableJson(parsed.data) });
  return go(PropertyStep);
}
```

`stay(...)` retains the cursor and makes a concrete corrective instruction
available for the next model response. A successful `go(...)` moves only after
the state save has happened. The property and coverage steps apply the same
pattern with their own Zod schemas.

## The collection boundary

| Stage | The model may do | Code must do |
| --- | --- | --- |
| Qualification | Ask for missing data and explain valid formats | Validate date range and supported-state routing |
| Property | Ask concise follow-ups and interpret a correction | Validate profile fields and system years |
| Risk | Collect claims, hazards, and protections | Validate typed risk data |
| Coverage | Explain the allowed choices | Validate limits and save the selected deductible |
| Review | Summarise persisted values and choose a correction tool | Route back to the state owner |

No collection prompt gets product factors or a formula. The state objects are
validated inputs to the next stage; they are not an invitation for the model to
invent a preliminary premium.

## Next

[4. Deterministic eligibility and rating](/docs/tutorials/home-insurance-flow/rating-boundary/)
follows those persisted records across the boundary into versioned product rules.
