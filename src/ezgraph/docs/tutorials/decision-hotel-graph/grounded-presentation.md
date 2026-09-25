---
layout: layouts/ezgraph.njk
title: 6. Grounded presentation and booking
description: Check an LLM presentation against saved hotel results, fall back to deterministic rendering, and validate the selected hotel before completion.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/
ezgraph: true
ezgraphDocument: true
---

# 6. Grounded presentation and booking

## The goal

Let the model make a friendly hotel presentation without allowing it to invent a hotel, price,
or booking.

## Separate the draft from the release decision

`PresentNode` receives the current `hotelFound` list in its prompt. The model drafts a
presentation and submits it with the `publish_hotel_draft` tool, which saves the draft and
returns `go(PresentationDecisionNode)`. The decision node's `getDecisionFacts()` supplies the draft plus the exact
saved hotels and criteria. It asks whether the draft is `grounded` (Noul) and scores
`completeness` and `clarity` (Score, 0–2). Code releases the draft only when
`grounded.noul >= 0.85` and both scores are at least 1.5 with confidence of at least 0.75.

Either way, the node returns `directTo(PresentNode, text)`. The text is the accepted draft or
`CriteriaHelper.renderHotelResults(hotels)`, a deterministic rendering of the saved results. The
same rendering is the fallback when the decision provider is unavailable. The next customer turn
resumes in `PresentNode`.

## Validate selection against the result list

The `chosen_hotel` tool accepts a hotel name or a one-based number, but resolves it against the
current `hotelFound` array. Names must match exactly, ignoring case. Unknown values return
`stay(...)`; only a listed hotel saves `selectedHotel` and a confirmation number and returns
`finish(...)`. A request to change criteria calls `revise_search`, which forwards the customer's
message to `RouterDecisionNode`.

## Why it is written this way

A polished answer is not evidence. The customer sees a model draft only when it is supported by
the actual search result, and a booking is bound to that same result list rather than a name the
model happens to mention.

## Next

Continue to [7. Fallbacks and evaluation](/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-testing/).
