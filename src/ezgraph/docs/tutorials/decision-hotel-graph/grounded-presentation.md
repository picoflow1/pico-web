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

`PresentNode` receives the current `hotelFound` list, asks the model for a draft, and saves that
draft. `PresentationDecisionNode` then evaluates the draft against the exact saved hotels and
criteria. Code releases it only when grounding, completeness, and clarity thresholds pass.

If it does not pass—or the decision provider is unavailable—the graph returns a deterministic
rendering of the saved search results to `PresentNode`.

## Validate selection against the result list

The booking tool accepts a name or a one-based number, but resolves it against the current
`hotelFound` array. Unknown values return `stay(...)`; only a listed hotel creates a confirmation
number and returns `finish(...)`.

## Why it is written this way

A polished answer is not evidence. The customer sees a model draft only when it is supported by
the actual search result, and a booking is bound to that same result list rather than a name the
model happens to mention.

## Next

Continue to [7. Fallbacks and evaluation](/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-testing/).
