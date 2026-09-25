---
layout: layouts/ezgraph.njk
title: 8. Grounded presentation and booking
description: Let a chat model draft the hotel presentation, release it only after a Jev grounding review, fall back to a code-rendered list, and book only a hotel from the saved results.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 8. Grounded presentation and booking

After a search, the graph has a trusted list of hotels in `PresentNode`'s state. The model may
describe that list in friendly language, but it must not invent a hotel, change a price, or claim a
booking. This lesson shows how `PresentNode` and `PresentationDecisionNode` split that job: the
model drafts, Jev reviews, code decides what the customer sees, and booking is resolved against the
same saved list.

## The goal

- Force a conversational node to act only through tools.
- Separate drafting a response from releasing it.
- Give a judge the draft and the trusted data as facts.
- Fall back to a deterministic rendering that is correct by construction.
- Book only a hotel that exists in the saved results.

## PresentNode acts only through tools

```ts
export class PresentNode extends ConversationNode<DecisionHotelGraphStateType> {
  getPrompt(state: DecisionHotelGraphStateType): string {
    return fillHotelPrompt(hotelPrompts.present, {
      HOTEL_FOUND_INFO: JSON.stringify(state.nodes.PresentNode?.hotelFound ?? []),
    });
  }

  getLlmConfig(): GraphLlmConfigOverride {
    return { params: { forceToolCalls: true } };
  }

  defineTool(): readonly ToolDefinition[] {
    return [
      { name: "publish_hotel_draft", description: "Submit the grounded result draft for semantic review.",
        schema: z.object({ draft: z.string().min(1) }) },
      { name: "chosen_hotel", description: "Book one hotel from the current results.",
        schema: z.object({ hotelName: z.string().min(1) }) },
      { name: "revise_search", description: "Return a criteria revision to the decision router.",
        schema: z.object({}) },
    ];
  }
  // handlers below
}
```

`present.md` names the three actions:

```text
Present only hotels in this trusted JSON array:
{{HOTEL_FOUND_INFO}}

For a new result set, call `publish_hotel_draft` with a numbered list containing every hotel name,
address, nightly price range, and total price plus booking/revision guidance. For an explicit
booking call `chosen_hotel`. For a criteria change call `revise_search`. Never invent addresses,
prices, amenities, availability, or booking status.
```

`forceToolCalls: true` is merged into the graph's `gpt-4o` configuration and sent to the provider as
a required tool choice. The model cannot reply with plain text at all. Every model turn in this
node is one of the three tools, so nothing it writes reaches the customer without passing through
a handler.

<div class="callout"><span class="label">What forcing tools costs</span><p>A question such as “does the second hotel have a pool?” has no dedicated tool, so the model can only answer it as a new draft. That draft then goes through the grounding review like any other. Likewise, when <code>chosen_hotel</code> returns <code>stay(...)</code> for an unknown hotel, the model's next move in the loop must again be a tool call. Forcing tools buys a strong guarantee; add a tool for each kind of answer you want the node to give.</p></div>

## Draft, then review

```ts
@Tool("publish_hotel_draft")
async publishDraft(input: { draft: string }): Promise<ToolResponse> {
  this.saveState({ draft: input.draft });
  return go(PresentationDecisionNode);
}
```

The draft is saved to `PresentNode`'s own channel, and the judge runs in the same turn.

`PresentationDecisionNode` has a static prompt and sends the evidence as facts:

```ts
override getPrompt(): string {
  return hotelPrompts.presentationJudge;
}

protected override getDecisionFacts(state: DecisionHotelGraphStateType) {
  return {
    draft: state.nodes.PresentNode?.draft ?? "",
    hotelFound: state.nodes.PresentNode?.hotelFound ?? [],
    criteria: state.nodes.PresentNode?.criteria ?? {},
  };
}
```

The facts contain everything the grounding question needs: the exact draft and the exact data it
must agree with. The framework adds the conversation from `hotel-present`. On the first
presentation after a search, that space holds only the search node's internal instruction, which
is excluded, so `request` is empty and the judge works from the facts alone. On a later turn, such
as a question about the results, `request` is the customer's message.

## The release decision

```ts
override onDecision(
  answers: DecisionAnswers<typeof PRESENTATION_QUESTIONS>,
  _context: DecisionContext,
  state: DecisionHotelGraphStateType,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  const hotels = state.nodes.PresentNode?.hotelFound ?? [];
  const draft = state.nodes.PresentNode?.draft ?? "";
  const accepted =
    answers.grounded.noul >= 0.85 &&
    answers.completeness.score >= 1.5 &&
    answers.completeness.confidence >= 0.75 &&
    answers.clarity.score >= 1.5 &&
    answers.clarity.confidence >= 0.75;
  this.saveState({ review: answers, accepted });
  return directTo(PresentNode, accepted ? draft : CriteriaHelper.renderHotelResults(hotels));
}
```

Both outcomes return the same builder: `directTo(PresentNode, text)`. The text becomes the
turn's response and is appended to `hotel-present` as an assistant message. `PresentNode` becomes
the resume point, so the customer's reply goes to the node that owns booking. Only the *text*
differs:

- **Accepted:** the model's draft, exactly as published.
- **Rejected:** `CriteriaHelper.renderHotelResults(hotels)`, a numbered list built in code from the
  saved results, with formatted currency and fixed booking instructions.

```ts
static renderHotelResults(hotels: readonly SearchHotelEntry[]): string {
  if (hotels.length === 0)
    return "No hotels matched the current criteria. Tell me which criterion to revise.";
  return [
    "Here are the matching Portland hotels:",
    ...hotels.map((hotel, index) => {
      const low = Math.min(...hotel.prices);
      const high = Math.max(...hotel.prices);
      return `${index + 1}. ${hotel.hotelName} — ${hotel.address} — nightly ${this.usd(low)}–${this.usd(high)} — total ${this.usd(hotel.total)}`;
    }),
    "",
    "Reply with a hotel name or number to book, or tell me which search criterion to revise.",
  ].join("\n");
}
```

The live replay shows both. Turn 11's response is a model draft: bold headings, unformatted prices
such as "$600.3", and every value taken from the results. Turn 15's response is word for word the
`renderHotelResults()` format, so on that turn the review either rejected the draft or failed and
fell back. The transcript does not record which. Either way, the customer saw only grounded
data.

A rejected draft does not disappear from history. It remains as the arguments of the
`publish_hotel_draft` call, followed by the assistant message the customer actually saw.

## Booking against the saved list

```ts
@Tool("chosen_hotel")
async chosenHotel(input: { hotelName: string }): Promise<ToolResponse> {
  const hotels = this.graph.graphState().nodes.PresentNode?.hotelFound ?? [];
  const normalized = input.hotelName.trim().toLowerCase();
  const numeric = /^\d+$/.test(normalized) ? Number(normalized) : NaN;
  const selected =
    Number.isInteger(numeric) && numeric >= 1 && numeric <= hotels.length
      ? hotels[numeric - 1]
      : hotels.find((hotel) => hotel.hotelName.toLowerCase() === normalized);
  if (!selected) {
    return stay("Choose a hotel name or number from the current result list.");
  }

  const confirmationNumber = Math.floor(100000 + Math.random() * 900000);
  this.saveState({ selectedHotel: selected.hotelName, confirmationNumber });
  return finish(
    `${selected.hotelName} is booked with confirmation #${confirmationNumber}. Thank you for choosing Hilton.`,
  );
}
```

The model supplies only a string. Code resolves it: a number between 1 and the list length, or a
hotel name that matches exactly, ignoring case. Anything else returns `stay(...)`. A hotel that is
not in the current results cannot be booked, the confirmation text is written in code from the
resolved record, and `finish()` completes the graph.

Compare PicoFlow's HotelFlow, whose booking step saves whatever name the model passes. Resolving
against the result list is the difference between a demo and a booking boundary.

<div class="callout warn"><span class="label">Demo shortcuts</span><p>Names must match exactly, so “Hampton Inn Sherwood” does not resolve to “Hampton Inn Sherwood Portland”; the model usually passes a list number or a full name, which is why this rarely shows up. The confirmation number is random and not checked for uniqueness, and nothing is reserved anywhere. A production booking would call an inventory service, and use its reservation ID.</p></div>

## Going back to the criteria

```ts
@Tool("revise_search")
async reviseSearch(
  _input: Record<string, never>,
  _context: Record<string, never>,
  state: DecisionHotelGraphStateType,
): Promise<ToolResponse> {
  return go(RouterDecisionNode).withMessage(new HumanMessage(this.graph.input(state)));
}
```

`this.graph.input(state)` returns the latest customer message in the current node's history space,
here `hotel-present`. The router lives in `hotel-intake`, so without `withMessage()` its `request`
would still be the old "search". Forwarding puts "change maximum budget to 500 per night" into the
intake conversation, where the router classifies it and sends it to `BudgetNode`. That is turn 12
of the live replay: one message, and the budget is revised and the summary shown.

This is the case where forwarding is essential. Inside a single shared space, as
[lesson 5](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/) showed, it only
duplicates a message that is already there.

## Why it is written this way

A polished answer is not evidence. The model is good at presentation and bad at being trusted with
prices, so the graph lets it do the first and never depend on the second. The customer sees a
draft only after a review against the exact data. If the review says no, or cannot run, they see a
list that is correct by construction. Booking is bound to the same list, not to a name the model
happened to write.

## Common mistakes

- **Letting a presentation node reply in free text.** Without forced tools, an unreviewed reply is
  one model decision away.
- **Judging a draft without the source data.** Grounding needs both the draft and the records it
  must match, as facts.
- **A fallback that calls another model.** The fallback should be deterministic, so it cannot fail
  the same way.
- **Booking by the name the model wrote.** Resolve the choice against the saved results first.
- **Forgetting to forward a request across history spaces.** The receiving node reads only its
  own space.

## Next

Continue to [9. Fallbacks, usage, and cost](/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-cost/).
