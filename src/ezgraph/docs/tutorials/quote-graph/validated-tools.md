---
layout: layouts/ezgraph.njk
title: 5. Validated collection
description: Split validation between a model-facing Zod schema and business rules in the handler, write rejections the model can act on, and see both in QuoteGraph's driver and history stages.
permalink: /ezgraph/docs/tutorials/quote-graph/validated-tools/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 5. Validated collection

A model can collect a customer's answers, but it should never be the one that decides whether
those answers are acceptable. `DriverNode` and `HistoryNode` show the pattern QuoteGraph uses
everywhere. A Zod schema describes the shape the model must submit, handler code enforces the
business rules, and a rejection explains exactly what to fix.

## The goal

- Decide which checks belong in the tool schema and which belong in handler code.
- Write rejections that a model can turn into one precise follow-up question.
- Parse dates strictly, and do calendar arithmetic against a pinnable clock.
- Save only a complete, valid record, then move on.

## The driver tool

```ts
defineTool(): readonly ToolDefinition<DriverInput>[] {
  return [
    {
      name: "capture_driver",
      description: "Capture the primary driver's identity and license details.",
      schema: z.object({
        fullName: z.string().min(2),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
        licenseState: z.string().length(2),
        licenseStatus: z.enum(["valid", "permit", "suspended"]),
        yearsLicensed: z.number().int().min(0),
      }),
    },
  ];
}
```

The schema is the tool's interface. The model sees it as a JSON Schema, and EZGraph checks every
call against it before the handler runs. A call that fails comes back to the model as `{ accepted:
false, error }`, with each Zod issue prefixed by its field.

## The handler

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput): Promise<ToolResponse> {
  const licenseState = input.licenseState.toUpperCase();
  if (!US_STATE_CODES.has(licenseState)) {
    return reject(`'${input.licenseState}' is not a U.S. state code.`);
  }
  if (input.licenseStatus === "suspended") {
    return reject("We cannot offer a quote while the driver's license is suspended.");
  }
  const birthDate = parseUtcDate(input.dateOfBirth);
  if (!birthDate) {
    return reject("dateOfBirth must be a real calendar date in YYYY-MM-DD form.");
  }
  const now = quoteNow();
  if (birthDate > now) return reject("The date of birth cannot be in the future.");
  const age = yearsBetween(birthDate, now);
  if (age < 16) return reject("The primary driver must be at least 16 years old.");
  if (age > 100) {
    return reject("Check the date of birth; the driver's age exceeds 100.");
  }
  if (input.yearsLicensed > age - 15) {
    return reject(
      `${input.yearsLicensed} licensed years is inconsistent with a ${age}-year-old driver.`,
    );
  }
  const driver = {
    fullName: input.fullName.trim(),
    dateOfBirth: input.dateOfBirth,
    licenseState,
    licenseStatus: input.licenseStatus,
    yearsLicensed: input.yearsLicensed,
  };
  this.saveState({ driver });
  return go(VehicleNode);
}

function reject(error: string): ToolResponse {
  return stay(JSON.stringify({ accepted: false, error }));
}
```

Every stage file defines the same small `reject()` helper, so every business-rule rejection has
the same `{ accepted: false, error }` shape as a schema rejection. The model sees one consistent
convention either way.

## Where each rule lives

| Rule | Schema | Handler |
| --- | --- | --- |
| a name of at least two characters | `min(2)` | trimmed before saving |
| birth date shaped `YYYY-MM-DD` | regex | — |
| birth date is a real calendar date | — | `parseUtcDate()` round-trip |
| birth date not in the future; age 16 to 100 | — | against `quoteNow()` |
| two-letter licence state | `length(2)` | — |
| a real U.S. state or DC | — | uppercased, then checked against a set of 51 codes |
| licence status is `valid`, `permit`, or `suspended` | `z.enum` | `suspended` is refused |
| whole, non-negative years licensed | `int().min(0)` | at most `age − 15` |

The split follows one rule. **Shape goes in the schema; anything that needs context goes in
code.** "Is this a real date?", "how old is the driver today?", and "is 12 years licensed plausible
for a 25-year-old?" need a calendar, a clock, or another field, so they cannot be schema checks.

### Why the schema accepts "suspended"

It looks odd to allow a value only to refuse it. But if the schema rejected `suspended`, a model
that heard "my licence is suspended" would get a generic enum error, and might resubmit with
`valid` to get past it. Accepting the true value lets the handler refuse it with a sentence the
model can pass on: "We cannot offer a quote while the driver's license is suspended." The type
`DriverProfile["licenseStatus"]` is only `"valid" | "permit"`, so a saved driver can never be
suspended.

### What a rejection does

`reject()` returns `stay()`. The model is still inside its agent loop, so it reads the error and,
in the same turn, asks the customer to correct that one item, as `driver.md` instructs. Nothing is
saved. The deterministic test checks exactly this: after "My license is currently suspended…", the
turn ends in `DriverNode`, `DriverNode.driver` is still undefined, and the reply mentions the
suspension.

## Strict dates, one clock

`backend/quote-clock.ts` holds all the date logic, with no EZGraph imports:

```ts
/** Strictly parses YYYY-MM-DD into a UTC date; rejects overflow like 2027-02-30. */
export function parseUtcDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}
```

JavaScript silently turns February 30 into March 2. The round-trip check rejects any date that does
not come back as the same year, month, and day. `yearsBetween()` then computes an age the way
people do, one year less if this year's birthday has not happened yet. `quoteNow()` returns
`QUOTE_GRAPH_CURRENT_DATE` when it is set, which is what makes every age and window in the tests
reproducible. See [lesson 7](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/).

## The history tool

`HistoryNode` applies the same pattern to a list:

```ts
schema: z.object({
  currentlyInsured: z.boolean(),
  coverageLapse: z.boolean(),
  incidents: z
    .array(
      z.object({
        type: z.enum(["at-fault-accident", "not-at-fault-accident", "violation", "comprehensive-claim"]),
        date: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM"),
      }),
    )
    .max(10),
}),
```

```ts
@Tool("capture_history")
async captureHistory(input: CaptureHistoryInput): Promise<ToolResponse> {
  const now = quoteNow();
  for (const [index, incident] of input.incidents.entries()) {
    const month = parseUtcMonth(incident.date);
    if (!month) {
      return reject(`Incident ${index + 1}: '${incident.date}' is not a real month.`);
    }
    if (month > now) {
      return reject(`Incident ${index + 1} is dated in the future.`);
    }
    if (monthsBetween(month, now) > 60) {
      return reject(
        `Incident ${index + 1} is more than five years old; only the last five years affect this quote — drop it.`,
      );
    }
  }
  this.saveState({ history: { currentlyInsured: input.currentlyInsured, coverageLapse: input.coverageLapse, incidents: input.incidents } });
  return go(CoverageNode).withMessage(
    new HumanMessage("The history stage is complete. Collect the coverage preferences."),
  );
}
```

Three details are worth copying:

- **Rejections name the item.** "Incident 2 is dated in the future" tells the model which entry to
  correct, and `history.md` tells it to "correct only the flagged entry and resubmit".
- **Rejections say what to do.** "…only the last five years affect this quote — drop it." turns a
  failure into an instruction.
- **An empty list is a valid answer.** "None" is complete, and the prompt says so. The tool is
  called as soon as insured status, lapse, and incidents are known.

Incidents are compared at month precision, so an incident dated exactly 60 months before today is
still counted. The limit of ten incidents is a sanity bound, not a business rule.

## Why it is written this way

The model is good at conversation and bad at being a source of truth. A schema that is only an
interface, and a handler that is the policy, give the model room to phrase questions naturally
while keeping every accepted fact reproducible in a unit test. Writing every rejection as an
instruction to the model keeps the conversation moving instead of looping on vague errors.

## Common mistakes

- **Treating the schema as the policy.** A regex cannot tell February 30 from February 28.
- **Rejecting a true answer at the schema level.** Accept it, then refuse it with an explanation,
  so the model does not "fix" the customer's answer.
- **Vague rejections.** "Invalid input" produces a vague follow-up; name the field and the fix.
- **Using `new Date()` inside rules.** Read a clock you can pin, like `quoteNow()`.
- **Saving partial records.** Validate everything, then save once.

## Next

Continue to [6. Catalog lookup and disambiguation](/ezgraph/docs/tutorials/quote-graph/vehicle-catalog/).
