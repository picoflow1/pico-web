---
layout: layouts/ezgraph.njk
title: 5. The router's policy
description: Walk every branch of RouterDecisionNode.onDecision(), from saved notices and the literal-search guard to forwarding a customer's request to a criterion collector.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 5. The router's policy

`RouterDecisionNode` is the hub of the graph. It runs at the start of almost every turn, and again
after every collector saves a value. Jev tells it which of nine destinations fits the customer's
latest message; everything after that is about sixty lines of ordinary TypeScript. This lesson
reads those lines branch by branch.

## The goal

- Give the router the state it needs through the prompt and facts.
- Handle every label Jev can return, in a deliberate order.
- Keep side effects, like running a search, behind checks that do not depend on the model.
- Forward the customer's real message to a collector when it contains a value to apply.

## What the router sends

```ts
override getPrompt(state: DecisionHotelGraphStateType): string {
  const criteria = CriteriaHelper.readCriteria(state);
  const issues = CriteriaHelper.validateCriteria(criteria);
  return fillHotelPrompt(hotelPrompts.router, {
    COLLECTED_CRITERIA: JSON.stringify(criteria, null, 2),
    UNRESOLVED_CRITERIA: issues.length
      ? issues.map((issue, index) => `${index + 1}. ${issue.field}: ${issue.message}`).join("\n")
      : "None.",
  });
}

protected override getDecisionFacts(state: DecisionHotelGraphStateType) {
  const criteria = CriteriaHelper.readCriteria(state);
  return {
    criteria,
    unresolved: CriteriaHelper.validateCriteria(criteria).map((issue) => issue.field),
    notice: state.nodes.RouterDecisionNode?.notice ?? null,
  };
}
```

Both methods start from the same `CriteriaHelper` snapshot, so Jev and the handler always reason
about identical criteria. `unresolved` lists fields in a fixed order (dates, budget, room type,
amenities, distance), which is also the order in which the router asks for them.

## The whole handler

```ts
override onDecision(
  answers: DecisionAnswers<typeof ROUTING_QUESTIONS>,
  context: DecisionContext,
  state: DecisionHotelGraphStateType,
): GraphNodeResponse<DecisionHotelGraphStateType> {
  const criteria = CriteriaHelper.readCriteria(state);
  const issues = CriteriaHelper.validateCriteria(criteria);
  const notice = state.nodes.RouterDecisionNode?.notice;
  if (notice) {
    this.saveState({ notice: null });
    return directTo(RouterDecisionNode, notice);
  }

  const route = answers.destination.choice;
  this.saveState({ lastRoute: route, lastDecision: answers });
  if (route === "unclear") {
    return directTo(
      RouterDecisionNode,
      "I can update dates, nightly budget, room type, amenities, or distance. You can also ask to review or search.",
    );
  }
  if (route === "exit") {
    return finish("Thanks for considering Hilton hotels in Portland.");
  }
  if (route === "review") {
    return directTo(
      RouterDecisionNode,
      `${CriteriaHelper.renderCriteriaSummary(criteria)}\n\nTell me what to revise, or say “search” when ready.`,
    );
  }
  if (route === "search") {
    if (context.request.trim().toLowerCase() !== "search") {
      return issues.length
        ? directTo(CriteriaHelper.nextNode(issues[0]!), CriteriaHelper.criteriaPrompt(issues[0]!.field))
        : directTo(
            RouterDecisionNode,
            `${CriteriaHelper.renderCriteriaSummary(criteria)}\n\nTell me what to revise, or say “search” when ready.`,
          );
    }
    return issues.length
      ? go(CriteriaHelper.nextNode(issues[0]!))
      : go(CriteriaReadinessDecisionNode);
  }
  return answers.request_delivery.choice === "apply_request" ||
    CriteriaHelper.criterionAnswered(criteria, route)
    ? go(CriteriaHelper.nextNode(route)).withMessage(new HumanMessage(context.request))
    : directTo(CriteriaHelper.nextNode(route), CriteriaHelper.criteriaPrompt(route));
}
```

## Branch by branch

| Order | Condition | Returns | Customer sees |
| --- | --- | --- | --- |
| 1 | a saved `notice` exists | `directTo(RouterDecisionNode, notice)`, clearing it | the notice, such as "No hotels matched…" |
| 2 | `unclear` | `directTo(RouterDecisionNode, …)` | what the assistant can do |
| 3 | `exit` | `finish(…)` | a goodbye; the graph completes |
| 4 | `review` | `directTo(RouterDecisionNode, summary)` | the saved criteria |
| 5 | `search`, but the message is not literally "search" | `directTo(firstIssueOwner, question)` or the summary | the next missing question, or the summary |
| 6 | `search`, literally | `go(firstIssueOwner)` or `go(CriteriaReadinessDecisionNode)` | whatever the next node produces |
| 7 | a criterion, with a value to apply or already answered | `go(collector).withMessage(request)` | whatever the collector produces |
| 8 | a criterion that is just the next question | `directTo(collector, question)` | that criterion's question |

### 1. Notices come first

`SearchHotelsNode` saves a notice when a search finds nothing and returns
`go(RouterDecisionNode)`. The router runs in the same turn, sees the notice, shows it once, and
clears it with `saveState({ notice: null })`. The customer's next message then starts a normal
routing turn.

<div class="callout warn"><span class="label">A decision call that is thrown away</span><p>The notice check is inside <code>onDecision()</code>, so Jev has already been called by the time it runs, and its answers are ignored. In the live replay that is one of 22 decision calls. Because the check depends only on state, it could run before any call: route the empty search to a small node that shows the notice, or override <code>run()</code> in the router to return the notice before calling <code>super.run(state)</code>. The deterministic test never sees this cost, because its fake provider fails deliberately whenever a notice is present, which sends the turn through <code>onDecisionError()</code> instead.</p></div>

### 2–4. Answers that stay at the router

`unclear`, `review`, and the no-issue case of branch 5 all return `directTo(RouterDecisionNode,
…)`. The response is code-owned text and the router remains the resume point, so the customer's
next message is routed afresh.

`exit` uses `finish()` directly. A decision node has no tools, so it cannot call
`terminate_session`; `finish()` is its equivalent. Collectors and `PresentNode` can still reach
`TerminateSessionNode` through the inherited `terminate_session` tool.

### 5–6. A search needs the literal word

A search is the one route with a real side effect: it runs the catalog search and a presentation.
The router runs it only when the customer's message, trimmed and lower-cased, is exactly
`search`, and only when deterministic validation finds no issue. If Jev says `search` for
anything else, such as "distance does not matter" once everything is answered, the router asks
for the next missing criterion or shows the summary with an invitation to say "search".

`router.md` tells Jev the same rule, "Exact `search` routes to search", but the code does not rely
on Jev obeying it. A label is a suggestion; the literal check is the permission.

<div class="callout"><span class="label">Deliberately strict</span><p>“Search”, “ search ”, and “SEARCH” pass the guard; “search now”, “search.”, and “find hotels” do not. The live replay's scenario always types <code>search</code>. For a friendlier product, replace the string comparison with a deterministic check you are comfortable owning, for example a short allowlist of phrases, rather than trusting the label alone.</p></div>

With issues outstanding, branch 6 returns `go(owner)`, not `directTo()`. The collector runs in the
same turn and its chat model asks for the missing value in its own words.

### 7–8. Asking versus applying

For a criterion route, the router must decide whether the collector should *apply* the latest
message or simply *ask* its question:

- "Hi" routes to `dates` with `prompt_next`. Dates are unanswered, so the router returns
  `directTo(DateRangeNode, "What are your Portland check-in and checkout dates?")`. No chat-model
  call is needed to ask a fixed question.
- "Actually change my dates to August 3 through August 9, 2027", sent while the graph is asking
  about amenities, routes to `dates`. Dates are already answered, so whatever `request_delivery`
  says, the router forwards the message: `go(DateRangeNode).withMessage(new
  HumanMessage(context.request))`. The collector applies the change in the same turn and returns to
  the router, which asks the still-open amenity question again.

Checking `criterionAnswered()` as well as `apply_request` is a safety net. Revising an answered
criterion always requires the collector to read the message, even if Jev labels it
`prompt_next`.

<div class="callout warn"><span class="label">Forwarding within one history space duplicates the message</span><p>The router and the collectors share <code>hotel-intake</code>, and the customer's message is already in that history. <code>withMessage()</code> appends it again, so the collector sees it twice, and the router's next <code>priorRequests</code> contains it twice. Re-appending does put the request last, after the previous collector's <code>reroute_request</code> tool exchange, which gives the collector's model a clean final message. Contrast <code>PresentNode</code>'s <code>revise_search</code>, where the router lives in a <em>different</em> space and forwarding is the only way it can see the request at all.</p></div>

## A routing trace from the live replay

| Turn | Customer | Active node before | Router's decision | Result |
| --- | --- | --- | --- | --- |
| 1 | Hi | router | dates, prompt next | asks for dates |
| 3 | August 1 through August 8, 2027 | `DateRangeNode` | (after capture) budget, prompt next | asks for a budget |
| 7 | Actually change my dates to… | `AmenityNode` | dates; already answered | forwards; dates saved; asks for amenities again |
| 9 | distance does not matter | `DistanceNode` | (after capture) everything resolved | summary and "say search when ready" |
| 10 | show my criteria | router | review | summary |
| 11 | search | router | search, literal, no issues | readiness judge, then search |
| 13 | search | router | search, literal, no issues | empty search; notice shown |

The labels in the "Router's decision" column follow from each turn's outcome and the handler's
code; the replay records responses, not Jev's raw answers.

## When Jev cannot answer

If the call fails or times out after its retries, or returns an invalid answer, the router's
`onDecisionError()` shows a pending notice, or asks for the first missing criterion, or says the
saved criteria are ready and invites "search". It never runs a search itself. Lesson 9 compares all
three fallbacks.

## Why it is written this way

The router's job is to turn open-ended language into one of nine bounded outcomes, and then to
apply policy that does not depend on the model at all. Reading the handler, you can answer "what
can this message make the graph do?" without knowing anything about Jev: at worst it shows the
wrong question, and it never searches unless the customer typed the word.

## Common mistakes

- **Running side effects on a label alone.** Put a deterministic check in front of anything
  expensive or irreversible.
- **Ignoring branch order.** State-driven branches, like a pending notice, belong before
  label-driven ones.
- **Calling a chat model to ask a fixed question.** `directTo(collector, question)` asks it for
  free and still hands the next turn to the collector.
- **Forgetting that a revision of an answered field must be applied.** Check saved state, not just
  the label.
- **Forwarding across a shared history without noticing the duplicate.** Decide deliberately
  whether you want the message re-appended.

## Next

Continue to [6. Criteria collectors and corrections](/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/).
