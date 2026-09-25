---
layout: layouts/ezgraph.njk
title: 4. Questions, prompts, and thresholds
description: Choose Choice, Score, and Noul questions, write guidance a decision model can use, split data between the prompt and facts, and keep thresholds in application code.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/
ezgraph: true
ezgraphDocument: true
---

# 4. Questions, prompts, and thresholds

Jev answers exactly the questions you ask, in the shape you ask them. The three decision nodes in
this graph ask three different kinds of question, and each design choice shows up later as a line
of routing policy. This lesson looks at the question maps, the prompt files behind them, and where
a probability turns into a decision.

## The goal

- Pick the question type that matches the decision you need to make.
- Split one judgment into several questions when the parts are independent.
- Write guidance that tells a decision model how to judge, not what the business rules are.
- Decide what belongs in the prompt and what belongs in facts.
- Keep every threshold in code, where it can be reviewed and tuned.

## Three question types

| Type | You declare | You get back | Use it for |
| --- | --- | --- | --- |
| `choice` | `criteria: { label: description, ... }` | `choice` (one label), `probabilities`, `confidence` | picking one of a closed set: a route, a category, an outcome |
| `score` | `criteria: [level0, level1, ...]`, at least two | `score` from 0 to the last index (can be fractional), `legend`, `probabilities`, `confidence` | a graded quality with ordered levels |
| `noul` | `instructions` and/or `criteria: { true, false }` | `noul`, a probability from 0 to 1 | a yes/no property you want to threshold |

All the questions in one node are evaluated together against the same state. If one judgment
depends on the answer to another, put them in separate nodes. The readiness judge runs after the
router for exactly that reason.

## The router: two independent choices

```ts
export const ROUTING_QUESTIONS = {
  destination: {
    type: "choice",
    criteria: {
      dates: "Set or revise dates",
      budget: "Set or revise nightly budget",
      room_type: "Set or revise room type",
      amenities: "Set or revise amenities",
      distance: "Set or revise distances",
      review: "Show saved criteria",
      search: "Execute a hotel search",
      exit: "End the conversation",
      unclear: "Ambiguous or outside this flow",
    },
  },
  request_delivery: {
    type: "choice",
    criteria: {
      apply_request:
        "The latest request contains a new value or revision that the selected collector must apply",
      prompt_next: "The selected criterion is merely the next unresolved field",
      none: "The destination is not a criterion collector",
    },
  },
} as const satisfies DecisionQuestionMap;
```

Two decisions hide in one customer message. *Where* should the conversation go, and does the
message *itself* contain a value the destination must apply? "Actually change my dates to August 3
through August 9" answers both: dates, and yes, apply it. "Hi" routes to dates too, but there is
nothing to apply; the collector should just ask its question. One nine-label choice cannot express
that difference, so the router asks a second, smaller question.

The labels are the keys; the values are descriptions for the model. Keep labels short and stable,
because they become TypeScript string literals in your handler and values in saved state.
`unclear` gives the model somewhere to put a message that fits nothing; without it, an off-topic
message would be forced into the nearest real route. `none` does the same job for the second
question when the destination is not a collector.

<div class="callout"><span class="label">The router never reads confidence</span><p><code>RouterDecisionNode</code> acts on <code>answers.destination.choice</code>, the most likely label, however uncertain Jev was. Most wrong routes are recoverable here, because a collector can call <code>reroute_request</code>, and searching requires the literal word “search”. In a graph where a wrong route is expensive, add a gate such as <code>if (answers.destination.confidence &lt; 0.6) return directTo(RouterDecisionNode, clarifyingQuestion);</code> and treat it like any other threshold.</p></div>

## The readiness judge: a choice and a probability

```ts
export const CRITERIA_REVIEW_QUESTIONS = {
  outcome: {
    type: "choice",
    criteria: {
      ready: "Ready to search",
      dates: "Dates conflict",
      budget: "Budget conflicts",
      room_type: "Room type conflicts",
      amenities: "Amenities conflict",
      distance: "Distance conflicts",
      unclear: "Ambiguous",
    },
  },
  faithful: {
    type: "noul",
    criteria: {
      true: "Saved criteria reflect requests",
      false: "Saved criteria contradict requests",
    },
  },
} as const satisfies DecisionQuestionMap;
```

`outcome` names *what* to do next, using the same field names as `CriteriaHelper`, so a label maps
straight to a collector. `faithful` is a single probability that the saved record matches what the
customer asked for, which is the one thing deterministic validation cannot check. A Noul here can
declare `criteria` for its true and false cases instead of `instructions`; either is enough.

## The presentation judge: a probability and two grades

```ts
export const PRESENTATION_QUESTIONS = {
  grounded: {
    type: "noul",
    instructions: "Are all names, addresses, and prices supported by hotelFound?",
  },
  completeness: {
    type: "score",
    criteria: [
      "Missing names, addresses, or prices",
      "Hotel details without a next action",
      "Complete hotel details plus booking or revision action",
    ],
  },
  clarity: {
    type: "score",
    criteria: ["Confusing", "Understandable", "Clear numbered choices"],
  },
} as const satisfies DecisionQuestionMap;
```

Grounding is binary: a draft either invents a hotel or price, or it does not. Completeness and
clarity are graded, so they are Scores with ordered levels, each describing what that level looks
like. Describe levels by observable features, like "hotel details without a next action", rather
than by adjectives like "fair" or "good". The model is judging against your descriptions.

## Guidance files

`getPrompt()` in each decision node fills a Markdown file from `prompt/`. The framework prepends
the result to every question's instructions.

`router.md`:

```text
You are the typed routing boundary for a Portland Hilton hotel search.

Criteria collected so far:
{{COLLECTED_CRITERIA}}

Unresolved criteria:
{{UNRESOLVED_CRITERIA}}

Choose one destination. Exact `search` routes to search; review requests route to review; explicit
exit routes to exit. A new or corrected criterion routes to its collector. Otherwise route to the
first unresolved criterion. When everything is resolved, do not search automatically. Never invent
or alter a saved preference.
```

`criteria-judge.md`:

```text
You are a semantic reviewer, not the owner of hotel policy.

Normalized criteria:
{{NORMALIZED_CRITERIA}}

Deterministic issues:
{{DETERMINISTIC_ISSUES}}

Application code owns date ordering, numeric ranges, and allowed values. Missing bounded history is
not a contradiction. When validation has no issue, choose ready unless a supplied request
explicitly contradicts saved state. Treat explicit no preference as answered.
```

`presentation-judge.md`:

```text
Review a generated hotel-results draft against trusted `hotelFound` data. Reject invented or changed
hotel names, addresses, prices, amenities, availability, or booking claims. A complete response
lists matching names, addresses, nightly price ranges, and total prices and explains how to book or
revise.
```

The files are loaded once by `prompt/hotel-prompts.ts`, and `fillHotelPrompt()` replaces each
`{{KEY}}` with a string. Each file does the same three jobs:

- **It states the node's role and its limits.** "A semantic reviewer, not the owner of hotel policy"
  stops the judge from second-guessing date or budget rules that code already enforces.
- **It explains the evidence.** "Missing bounded history is not a contradiction" matters because
  Jev sees at most five human messages. A customer who gave their budget eight messages ago must
  not look like a contradiction merely because the message has scrolled out of `priorRequests`.
- **It sets defaults for ambiguous cases.** "When validation has no issue, choose ready unless…"
  tells the judge which way to lean.

None of the files mentions a threshold, a node name, or a transition. That knowledge lives in
the handler.

## Prompt or facts?

The router puts the saved criteria in both places: pretty-printed inside `router.md` and again as
the `criteria` fact. It works, but the prompt is repeated once per question, so the criteria are
sent three times per router call. In the live replay, the 22 decision calls used 30,693 tokens,
about 1,400 per call.

A good default:

| Put it in… | When it is… | Examples in this graph |
| --- | --- | --- |
| the prompt | guidance about *how* to judge, the same shape on every call | role, scope, tie-breaking rules |
| a question's `instructions` | guidance for that question only | the `grounded` question |
| facts | data the judgment is *about* | criteria, deterministic issues, a draft, search results |

`PresentationDecisionNode` already follows this split: a static prompt, and the draft, results,
and criteria as facts. Moving the router's criteria out of its prompt and relying on the facts
would be a reasonable optimization; measure routing quality before and after.

## Thresholds live in handlers

| Node | Rule | Where |
| --- | --- | --- |
| `RouterDecisionNode` | acts on the top label; no threshold | `onDecision()` |
| `CriteriaReadinessDecisionNode` | search only when there are no deterministic issues, `outcome === "ready"`, and `faithful.noul >= 0.75` | `onDecision()` |
| `PresentationDecisionNode` | release the draft only when `grounded.noul >= 0.85`, and both scores are `>= 1.5` with `confidence >= 0.75` | `onDecision()` |

A score threshold of 1.5 on a three-level scale means "closer to the top level than to the
middle". Requiring confidence as well rejects a draft that merely averages out to a good score.

These numbers are illustrative, not calibrated. To tune them, collect labeled cases from your own
traffic. The saved `review` answers in node state are a ready-made source. Then measure false
accepts and false rejects at several thresholds. A grounding judge should usually lean towards
rejecting, because its fallback is a correct, code-rendered list.

## Why it is written this way

A question map is an interface between your code and the model. Every label becomes a branch you
must handle; every Score level becomes part of what "good" means. Keeping guidance free of
policy, and keeping numbers in handlers, means you can change a threshold with a code review and
a test, without rewording a prompt and hoping the model's behavior moved the way you intended.

## Common mistakes

- **One giant Choice for two independent decisions.** Split them, as the router does with
  `destination` and `request_delivery`.
- **No escape label.** Without `unclear`, the model has to put off-topic input into a real route.
- **Adjectives as Score levels.** Describe what each level contains.
- **Business rules in the guidance.** "Checkout must be after check-in" belongs in validation
  code; the judge prompt should say that code owns it.
- **Bulky data in `getPrompt()`.** The prompt is repeated for every question; send data as facts.
- **Treating illustrative thresholds as tuned.** Calibrate on labeled cases before production.

## Next

Continue to [5. The router's policy](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/).
