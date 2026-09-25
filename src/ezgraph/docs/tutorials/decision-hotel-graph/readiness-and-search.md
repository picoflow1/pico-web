---
layout: layouts/ezgraph.njk
title: 7. Readiness and deterministic search
description: Put a semantic readiness judge in front of a search without letting it override validation, then search and price a local catalog in a GraphNode with no model.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/
ezgraph: true
ezgraphDocument: true
---

# 7. Readiness and deterministic search

Between "search" and a list of hotels sit two nodes with opposite characters.
`CriteriaReadinessDecisionNode` asks Jev a question code cannot answer: do the saved criteria
match what the customer actually asked for? `SearchHotelsNode` asks no model anything. It
validates, filters, prices, and routes in plain TypeScript.

## The goal

- Use a decision node to catch a mismatch between the conversation and saved state.
- Make sure the judge can block a search but never force one.
- Write a `GraphNode` that uses no model and seeds the next node's state.
- Keep search and pricing in a module you can test on its own.

## When the judge runs

The router enters `CriteriaReadinessDecisionNode` only after a literal "search" with no
deterministic issues. The judge therefore sees a complete, valid snapshot. Its job is to catch a
*valid but wrong* record: the collector saved a budget maximum of 500 when the customer's last
message said 700, for example.

## Prompt and facts

```ts
override getPrompt(state: DecisionHotelGraphStateType): string {
  const criteria = CriteriaHelper.readCriteria(state);
  const issues = CriteriaHelper.validateCriteria(criteria);
  return fillHotelPrompt(hotelPrompts.criteriaJudge, {
    NORMALIZED_CRITERIA: JSON.stringify(criteria, null, 2),
    DETERMINISTIC_ISSUES: issues.length
      ? issues.map((issue) => `${issue.field}: ${issue.message}`).join("\n")
      : "None.",
  });
}

protected override getDecisionFacts(state: DecisionHotelGraphStateType) {
  const criteria = CriteriaHelper.readCriteria(state);
  return { criteria, deterministicIssues: CriteriaHelper.validateCriteria(criteria) };
}
```

Because the judge shares `hotel-intake`, the framework adds the customer's last five messages from
the criteria conversation. On a search turn, `request` is "search" and `priorRequests` holds the
four messages before it. The judge compares those against the saved record.

## The decision

```ts
override onDecision(
  answers: DecisionAnswers<typeof CRITERIA_REVIEW_QUESTIONS>,
  _context: DecisionContext,
  state: DecisionHotelGraphStateType,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  const criteria = CriteriaHelper.readCriteria(state);
  const issues = CriteriaHelper.validateCriteria(criteria);
  const outcome = answers.outcome.choice;
  const accepted = issues.length === 0 && outcome === "ready" && answers.faithful.noul >= 0.75;
  this.saveState({ review: answers, accepted });
  if (issues.length) return go(CriteriaHelper.nextNode(issues[0]!));
  if (accepted) return go(SearchHotelsNode);
  if (outcome !== "ready" && outcome !== "unclear") {
    return directTo(CriteriaHelper.nextNode(outcome), CriteriaHelper.criteriaPrompt(outcome));
  }
  return directTo(
    RouterDecisionNode,
    `${CriteriaHelper.renderCriteriaSummary(criteria)}\nI could not verify one clear correction. Tell me which single criterion to update.`,
  );
}
```

| Situation | Returns | Customer sees |
| --- | --- | --- |
| deterministic issues exist | `go(owner of first issue)` | that collector asking for the value |
| `ready`, and `faithful >= 0.75` | `go(SearchHotelsNode)` | the results |
| a specific criterion, such as `budget` | `directTo(BudgetNode, "What nightly budget range should I use?")` | that question |
| `ready` but `faithful < 0.75`, or `unclear` | `directTo(RouterDecisionNode, summary + …)` | the summary and a request to name one criterion |

Read the `accepted` expression carefully. Deterministic validation is a precondition, not an
input the judge can outvote: with any issue, `accepted` is false whatever Jev says. The judge can
send the customer back to confirm a value, but it can never cause a search that validation would
refuse. In this graph the first branch cannot fire, because the router already checked for
issues. It stays as a guard in case another node ever routes here.

The deterministic test exercises the "specific criterion" branch. On its first readiness review the
fake provider answers `budget`, the graph asks for the budget again, and the customer reaffirms
"maximum 700" before searching.

## The search node

`SearchHotelsNode` extends `GraphNode` directly:

```ts
export class SearchHotelsNode extends GraphNode<DecisionHotelGraphStateType> {
  getPrompt(): string {
    return "";
  }

  async run(state: DecisionHotelGraphStateType): Promise<GraphNodeResult<DecisionHotelGraphStateType>> {
    const criteria = CriteriaHelper.readCriteria(state);
    const issues = CriteriaHelper.validateCriteria(criteria);
    if (issues.length) {
      return this.resolveNodeResponse(go(CriteriaHelper.nextNode(issues[0]!)));
    }

    const hotels = searchHotels(criteria);
    if (!hotels.length) {
      return this.resolveNodeResponse(
        go(RouterDecisionNode).withState({
          notice:
            "No hotels matched all current criteria. Tell me whether to revise budget, room type, amenities, or distance.",
        }),
      );
    }

    return this.resolveNodeResponse(
      go(PresentNode)
        .withState({
          hotelFound: hotels,
          criteria,
          criteriaReviewAccepted: state.nodes.CriteriaReadinessDecisionNode?.accepted === true,
        })
        .withMessage(
          new HumanMessage({
            content: "Present the current matching hotels.",
            additional_kwargs: { ezgraphInternal: true },
          }),
        ),
    );
  }

  protected usesChatModel(): boolean {
    return false;
  }
}
```

Points worth copying:

- **`getPrompt()` returns `""`** because `GraphNode` requires one, but nothing reads it.
  `usesChatModel()` returns `false`, so EZGraph does not record chat-model metadata for this node.
- **It validates again.** The readiness judge's fallback can route here without a review, so the
  node does not assume its caller checked.
- **Both outcomes are transitions with state.** An empty search sends the router a `notice`; a
  successful one seeds `PresentNode` with the results, the snapshot they were computed from, and
  whether the review accepted them.
- **The instruction to `PresentNode` is marked internal.** `PresentNode`'s chat model still reads
  "Present the current matching hotels." as the newest message in `hotel-present`. But
  `PresentationDecisionNode` shares that space, and `ezgraphInternal: true` keeps this
  framework-authored text out of its `request`. Compare QuoteGraph's `CoverageNode`, whose stage
  instruction has no decision node to confuse.

`resolveNodeResponse()` turns a builder into a LangGraph `Command`. It is needed here only because
`run()` declares `GraphNodeResult` as its return type. `GraphNode.invoke()` resolves builders
itself, so a `run()` declared to return `GraphNodeResponse` could return `go(...)` directly.

## The search module

`data/hotel-search.ts` imports nothing from EZGraph. At module load it parses `hotels.json` with a
Zod schema, so an unsupported amenity or a missing distance fails when the application starts, not
during a customer's search. `searchHotels(criteria)` then applies four filters and prices every
remaining hotel:

| Filter | Rule |
| --- | --- |
| amenities | the hotel has **every** requested amenity |
| room type | the hotel offers the requested room type |
| distance | strictly less than each limit that is not `null` |
| budget | the cheapest night is at least the minimum and the most expensive night is at most the maximum |

Each night's price is the hotel's base `level` multiplied by three factors:

| Factor | Values |
| --- | --- |
| season | June–September 1.8; April–May 1.4; October 1.5; otherwise 1.2 |
| room | suite 2.5; two beds 1.6; one bed 1.0 |
| weekend | Saturday or Sunday 1.15; otherwise 1.0 |

The result carries the name, address, amenities, room type, distances, every nightly price, and the
total. Those entries are the only hotel data any later node may present.

<div class="callout warn"><span class="label">The demo prices the checkout night</span><p><code>enumerateDates()</code> loops while <code>date &lt;= end</code>, so a stay from August 3 to August 9 is priced for seven dates, including the checkout day, instead of six nights. The live replay's totals reflect this: Hampton Inn &amp; Suites Portland Tigard's $3,810.60 is five weekday nights at $522.00 plus two weekend nights at $600.30. <code>hotel-search.spec.ts</code> asserts seven prices, so the test encodes the behavior too. A real booking engine should loop while <code>date &lt; end</code> and update that test.</p></div>

Two smaller details show up in the replay. Nightly prices are not rounded, so an accepted model
draft on turn 11 printed "$600.3". The deterministic rendering formats currency properly. And
because the distance filter is strict, "within 5 miles" excludes a hotel exactly 5.0 miles away.

## Why it is written this way

The judge and the search node sit on either side of a side-effect boundary. Everything before it
can be probabilistic, because the worst outcome is asking the customer to confirm something.
Everything from the search onwards is deterministic, testable without a provider, and reproducible
from the saved snapshot. `hotel-search.spec.ts` can check the catalog without starting a graph at
all.

## Common mistakes

- **Letting a judge's "ready" override validation.** Make validation a precondition of acceptance.
- **Assuming the caller validated.** A node reachable from a fallback path should check again.
- **Sending a framework instruction as an ordinary human message into a space a decision node
  reads.** Mark it `ezgraphInternal: true`, or it becomes the judge's `request`.
- **Parsing a data file lazily.** Validate catalogs at load so a bad deploy fails at startup.
- **Off-by-one stay pricing.** Nights run from check-in up to, but not including, checkout.

## Next

Continue to [8. Grounded presentation and booking](/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/).
