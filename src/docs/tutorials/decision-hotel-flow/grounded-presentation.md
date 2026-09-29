---
title: 6. Grounded presentation and booking
eyebrow: DecisionHotelFlow tutorial
lede: PresentStep drafts a useful answer, PresentationJudgeStep checks it against saved results, and application code renders the fallback and validates the final hotel selection.
source: pico-demo/src/myflow/decision-hotel-flow/present-step.ts, pico-demo/src/myflow/decision-hotel-flow/presentation-judge-step.ts
---

Search results are structured application data. A chat model may make them
pleasant to read, but it must not invent a hotel, alter a price, or claim a
booking that has not happened.

## Prime an isolated presentation stage

`PresentStep` shares the `present` memory namespace with its judge. On entry it
erases old presentation history; on crossing it creates a synthetic request:

```ts
protected override async onEnter(): Promise<void> {
  this.eraseMemory();
}

public override onCrossing(): MessageTypes {
  return new HumanMessageEx(this, 'Present the current matching hotels.');
}
```

The prompt injects the exact `hotelFound` array. Intake history stays in the
separate `intake` namespace.

## Capture the draft before releasing it

When the chat model produces ordinary text, `onResponse()` saves it and routes
to the judge instead of returning it to the user:

```ts
public override async onResponse(
  llmResult: string | object,
): Promise<LastResponseType> {
  const draft =
    typeof llmResult === 'string' ? llmResult : JSON.stringify(llmResult);
  this.saveState({ draft });
  return go(PresentationJudgeStep);
}
```

The durable cursor moves to `PresentationJudgeStep` within the same turn. Its
facts contain the draft, saved hotels, and criteria.

## Judge bounded properties

The judge asks whether the draft is grounded and scores completeness and
clarity. Application code sets the release threshold:

```ts
const accepted =
  answers.grounded.noul >= 0.85 &&
  answers.completeness.score >= 1.5 &&
  answers.completeness.confidence >= 0.75 &&
  answers.clarity.score >= 1.5 &&
  answers.clarity.confidence >= 0.75;

return directTo(
  PresentStep,
  accepted ? draft : CriteriaHelper.renderHotelResults(hotels),
);
```

`directTo(PresentStep, content)` moves the durable cursor back to the booking
stage, returns exact content, and ends the turn without another model call. A
rejected draft never reaches the customer.

## Deterministic fallback rendering

`CriteriaHelper.renderHotelResults()` builds a numbered list directly from the
saved array. `PresentationJudgeStep.onDecisionError()` returns that same list
when Jev is unavailable. This boundary fails closed with respect to generated
prose: only a reviewed draft or code-rendered results can be shown.

The renderer does not make the model's prose “more likely” to be correct. It is
a separate, always-grounded output path.

## Revision returns to the owner graph

`PresentStep` exposes a `revise_search` tool. It forwards the latest request to
`RouterStep` when available:

```ts
const message = this.getLastMessage();
return message
  ? go('RouterStep').withMessage(message)
  : go('RouterStep');
```

The same routing and collector validation used during intake therefore handle a
later budget or date correction. Search results are replaced only after a new
validated search.

## Validate the terminal selection

The booking tool accepts a name but resolves either an exact normalized name or
a one-based number against `hotelFound`:

```ts
const hotels = this.getState<SearchHotelEntry[]>('hotelFound') ?? [];
const selected = resolveHotel(args.hotelName, hotels);
if (!selected) {
  return stay('Choose a hotel name or number from the current result list.');
}

const confirmationNumber = Math.floor(100000 + Math.random() * 900000);
this.saveState({
  selectedHotel: selected.hotelName,
  confirmationNumber,
});
return finish(
  `${selected.hotelName} is booked with confirmation #${confirmationNumber}. Thank you for choosing Hilton.`,
);
```

The model cannot select an arbitrary hotel by inventing an ID. `finish(...)`
returns the exact confirmation, marks the session completed, keeps the current
cursor, and makes no follow-up model call.

In production, replace the random number with an idempotent backend reservation
write and persist the external operation ID before returning the confirmation.

## Common mistakes

- **Showing the draft before review.** Save it and route; release only the
  judge's selected output.
- **Using another model as the fallback.** The outage path should depend only
  on saved application data.
- **Letting the model book by free text.** Resolve against the current result
  set in code.
- **Returning to intake without the revision message.** Forward it when the
  router must classify it.
- **Calling `finish()` before the durable side effect succeeds.** Completion
  belongs after the backend commit.

## Next

[7. Fallbacks and two-tier testing](/docs/tutorials/decision-hotel-flow/fallbacks-and-testing/)
tests every decision boundary without providers, then separates that evidence
from a real OpenAI-and-Jev replay.
