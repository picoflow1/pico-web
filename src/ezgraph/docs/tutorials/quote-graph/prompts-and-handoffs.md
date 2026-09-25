---
layout: layouts/ezgraph.njk
title: 4. Prompts and stage handoffs
description: Compose QuoteGraph's prompts from a shared role file and one specification per stage, fill live values into them, and compare three ways to start the next stage cleanly.
permalink: /ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 4. Prompts and stage handoffs

Every QuoteGraph stage has a prompt assembled from three parts: a shared role, a stage
specification, and a closing instruction. The prompt tells the model what to collect and when to
call its tool. Code decides whether the result is acceptable. This lesson reads the prompt files,
then looks at a question that matters in any multi-stage graph: when one stage hands over to the
next inside a single turn, how does the new stage know what just happened?

## The goal

- Keep large prompts in Markdown files and compose them in `getPrompt()`.
- Fill live values, such as today's date or the current tiers, into a prompt.
- Write stage prompts that describe the conversation and leave policy to code.
- Choose between a prompt cue, a stage message, and a forwarded request when changing stages.

## Loading and composing prompts

`prompt/quote-prompt.ts` reads every file once, at module load:

```ts
export const quotePrompt = {
  role: readPrompt("./role.md"),
  driver: readPrompt("./driver.md"),
  vehicle: readPrompt("./vehicle.md"),
  history: readPrompt("./history.md"),
  coverage: readPrompt("./coverage.md"),
  quote: readPrompt("./quote.md"),
};

export const endChatInstruction =
  "If the user explicitly wants to end the conversation, call terminate_session immediately. Never mention internal tools, phases, schemas, or implementation details.";

export function fillPrompt(prompt: string, replacements: Record<string, string>): string {
  let filled = prompt;
  for (const [name, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(`{{${name}}}`, value);
  }
  return filled;
}
```

Each node composes the same three parts:

```ts
getPrompt(): string {
  return `${quotePrompt.role}\n\n${fillPrompt(quotePrompt.driver, {
    CURRENT_DATE: quoteNow().toISOString().slice(0, 10),
  })}\n\n${endChatInstruction}`;
}
```

`getPrompt()` runs every time the node's agent loop starts, so filled values are always current.

## The shared role

`role.md`:

```text
## Role & Tone ##
- You are the quoting assistant for Sequoia Auto Insurance, guiding one customer to a personal car-insurance quote.
- Warm, professional, and efficient. Ask at most two questions per message, in plain language.
- Stay on the quote. Politely decline unrelated topics, legal advice, and claims handling.
- Never mention internal tools, stages, schemas, or implementation details.
- **Chat Termination:** if the user explicitly wants to end the conversation, immediately call tool `terminate_session`.
```

Persona, tone, and scope are written once. The termination rule appears here and again in
`endChatInstruction`, so every assembled prompt states it twice. That is harmless, but if you
change one, change both, or remove the duplicate.

## A stage specification

`driver.md`:

```text
## Stage: Driver Details ##
- Today's date: {{CURRENT_DATE}}

Collect these items in order, at most two questions per message:
1. Full name.
2. Date of birth. Convert to YYYY-MM-DD; the driver must be at least 16.
3. License state (two-letter U.S. code) and license status: `valid` or learner's `permit`. If the license is suspended, say a suspended license cannot be quoted.
4. Years licensed (whole years).

When all four items are collected, restate them in one short line, then call `capture_driver`.

If the tool rejects the submission, explain the problem conversationally and re-ask only the affected item.
```

The five stage files follow the same pattern:

- **What to collect, in order,** with the format the tool needs, such as `YYYY-MM-DD`.
- **When to call the tool:** only when every item is known. This is why most turns in the replay
  call no tool at all.
- **What to do on rejection:** re-ask only the item the tool complained about. The tool's
  `{ accepted: false, error }` text is written for this; it names the problem precisely.

The prompt repeats some rules, like "at least 16", so the model asks sensible questions. It does
not enforce them. `capture_driver` checks the age again in code, and a model that ignores the
prompt still cannot save a 15-year-old driver.

## Live values in prompts

| Node | Placeholder | Filled with | Why |
| --- | --- | --- | --- |
| `DriverNode`, `HistoryNode`, `CoverageNode` | `{{CURRENT_DATE}}` | `quoteNow()` as `YYYY-MM-DD` | So the model can convert "June 15" or "March 2026" to real dates |
| `VehicleNode` | `{{RESOLVED_VEHICLE}}` | the catalog record for `resolvedVehicleId`, or `null` | So the model knows whether to look the vehicle up or ask about its use |
| `CoverageNode` | `{{OWNERSHIP}}` | `vehicle.ownership` from `VehicleNode`'s channel | So it can mention the lender rule up front for a financed car |
| `QuoteNode` | `{{TIERS_JSON}}` | `QuoteNode`'s saved `tiers` | So it presents code-calculated prices and "never invents or recomputes numbers" |

The last row is the most important. `QuoteNode`'s model never computes a price. It reads
the tiers the rating engine produced, and `quote.md` tells it to answer premium questions only
from that JSON.

## Stage handoffs

When `DriverNode` returns `go(VehicleNode)`, `VehicleNode` runs in the same turn. Its model has
not yet said anything, and the last human message it can see is a driver-licence answer. Without
help, it might treat "Licensed in Oregon, valid license…" as an answer to a vehicle question, or
open with a generic greeting. QuoteGraph uses three techniques to prevent that.

### 1. A prompt cue on entry (Driver → Vehicle)

`VehicleNode` shares `quote-intake` with `DriverNode`, so it can see the driver conversation. Its
prompt adds one extra paragraph only on the turn it is entered:

```ts
const driver = state.nodes.DriverNode?.driver;
const transitionAcknowledgement = state.inputConsumed && driver
  ? `This stage has just started after recording the driver's details. Your user-facing reply must begin by briefly confirming this saved record before asking any question: ${driver.fullName}, born ${driver.dateOfBirth}, has a ${driver.licenseStatus} ${driver.licenseState} license and ${driver.yearsLicensed} years licensed. Then ask for the vehicle's year, make, and model. Do not treat earlier messages as vehicle answers.`
  : "";
```

`inputConsumed` is reset to `false` at the start of every turn and set to `true` by the node that
handles it. When `VehicleNode` runs with `inputConsumed` already `true`, some other node consumed
this turn's message, so `VehicleNode` has just been entered. On the next turn, when the customer
answers the vehicle question, the flag is `false` again and the paragraph disappears. The replay's
turn 3 shows the result: "Thanks — I’ve saved Jamie Rivera, born 1993-04-12, with a valid Oregon
license and 10 years licensed."

The confirmed values come from the saved channel, not from the conversation, so the customer sees
exactly what was stored, uppercased state code and all.

### 2. A stage message (Vehicle → History, History → Coverage, Coverage → Quote)

The other forward transitions append an instruction to the target's history with `withMessage()`:

```ts
return go(HistoryNode).withMessage(
  new HumanMessage("Collect the driving and insurance history."),
);
```

| Transition | Target space | Message |
| --- | --- | --- |
| Vehicle → History | `quote-incidents` (new and empty) | "Collect the driving and insurance history." |
| History → Coverage | `quote-intake` (shared) | "The history stage is complete. Collect the coverage preferences." |
| Coverage → Quote | `quote-present` (new and empty) | "Present the quote tiers." |

Into a new space, the message replaces the framework's generic `"Start"` seed with a specific
instruction. Into a shared space, it marks the boundary clearly after the previous stage's tool
exchange.

<div class="callout"><span class="label">Consider marking stage messages as internal</span><p>These are ordinary <code>HumanMessage</code>s. Nothing in QuoteGraph is confused by them today, but a decision node added to one of these spaces would take the instruction as the customer's latest request. The framework's own <code>terminate_session</code> handoff, and <code>SearchHotelsNode</code> in the DecisionHotelGraph track, mark their instructions with <code>additional_kwargs: { ezgraphInternal: true }</code>, which decision nodes skip. Doing the same here costs one line per transition. Note that <code>graph.input()</code> does not skip internal messages; it returns the newest human message of any kind.</p></div>

### 3. A forwarded request (Quote → Coverage)

Going backward is different: the new stage must act on what the customer just said. `QuoteNode`'s
`revise_coverage` forwards the customer's actual message into the intake space:

```ts
return go(CoverageNode).withMessage(new HumanMessage(this.graph.input(state)));
```

[Lesson 9](/ezgraph/docs/tutorials/quote-graph/revise-and-accept/) looks at this transition in
detail.

### Choosing a technique

| Situation | Use |
| --- | --- |
| The target shares a history with the previous stage and should acknowledge saved facts | a prompt cue gated on `state.inputConsumed` |
| The target starts in a new or shared space and needs a clear task | a stage message with `withMessage()`, preferably marked internal |
| The target must act on the customer's own words | forward the real message with `withMessage(new HumanMessage(this.graph.input(state)))` |
| The target needs data, not words | `withState()` or `graph.saveNodeState()`, never text in a message |

## Why it is written this way

Prompt files keep a stage's conversation design readable and reviewable by people who do not
read TypeScript, while `getPrompt()` keeps the live parts, like dates and tiers, in code. The
handoff techniques exist because a graph that changes stages mid-turn has to tell the new stage
what happened. Doing that deliberately, with facts from state, is what makes the stage changes
invisible to the customer.

## Common mistakes

- **Enforcing rules only in the prompt.** Repeat them in the prompt for good questions, and enforce
  them in the handler.
- **Computing prices, dates, or IDs in prompt text.** Fill them in from code, and tell the model not
  to recompute them.
- **A new stage with no cue.** Its first reply will be generic, or will misread the previous stage's
  last message.
- **Passing data through message text.** Put data in state and words in messages.
- **Duplicated instructions drifting apart.** Keep each rule in one place, or change every copy
  together.

## Next

Continue to [5. Validated collection](/ezgraph/docs/tutorials/quote-graph/validated-tools/).
