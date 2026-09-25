---
layout: layouts/ezgraph.njk
title: 9. Revisions, direct responses, and acceptance
description: Walk QuoteNode's three tools, re-rating a what-if with a code-written direct() reply, sending a revision back to coverage with the customer's words, and completing only from the current tier list.
permalink: /ezgraph/docs/tutorials/quote-graph/revise-and-accept/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 9. Revisions, direct responses, and acceptance

Once the tiers are on screen, the customer can ask "what if?", start the coverage over, or accept.
`QuoteNode` handles all three. Two of its three tools reply with text written entirely in code,
and the third sends the conversation backwards. This lesson reads the node in full.

## The goal

- Present calculated numbers without letting the model compute any.
- Answer a what-if with a code-written reply and no second model call.
- Go back a stage carrying the customer's own words.
- Treat acceptance as a business event tied to the current saved tiers.

## The presentation prompt

```ts
getPrompt(state: QuoteGraphStateType): string {
  const local = this.state(state) as QuoteGraphNodeState<"QuoteNode">;
  return `${quotePrompt.role}\n\n${fillPrompt(quotePrompt.quote, {
    TIERS_JSON: JSON.stringify(local.tiers ?? []),
  })}\n\n${endChatInstruction}`;
}
```

`quote.md` asks the model to present each tier from the JSON as a numbered option, recommend
`selected`, and offer three paths: adjust (`adjust_quote` with only the changed fields), accept
(`accept_quote`), or rework (`revise_coverage`). It ends with "Answer premium questions only from
the tiers JSON; never invent or recompute numbers yourself."

On turn 13 of the replay this is the only model-written presentation of prices. Every figure in it
is copied from the JSON.

<div class="callout"><span class="label">The model override changes nothing</span><p><code>QuoteNode.getLlmConfig()</code> returns <code>openai:gpt-5.4</code> with three retries and low reasoning effort, which is exactly the graph default. The class comment says this is “the one place this graph pays for a stronger model”, but it no longer does. It still shows the mechanism: a node's <code>getLlmConfig()</code> is merged over the graph's <code>llmConfig</code>, and when the result differs, EZGraph records the effective model in that node's state.</p></div>

## Three tools

```ts
{ name: "adjust_quote",
  description: "Recompute the quote tiers after changing deductibles, liability, or extras.",
  schema: z.object({
    liability: z.enum(["state-minimum", "standard", "premium"]).optional(),
    collisionDeductible: deductibleSchema.optional(),
    comprehensiveDeductible: deductibleSchema.optional(),
    extras: z.array(z.enum(["rental", "roadside"])).max(2).optional(),
  }) },
{ name: "accept_quote",
  description: "Accept one presented quote tier and finish the quote.",
  schema: z.object({ tier: z.enum(["saver", "selected", "shield"]) }) },
{ name: "revise_coverage",
  description: "Return to the coverage stage to rework the selections.",
  schema: z.object({ isRevise: z.boolean() }) },
```

| Customer says | Tool | State written | Reply | Next turn in |
| --- | --- | --- | --- | --- |
| "What if both deductibles were $1000?" | `adjust_quote` | new `tiers`; new `coverage` in `CoverageNode` | code text via `direct()` | `QuoteNode` |
| "Let's change the coverage completely." | `revise_coverage` | nothing | whatever `CoverageNode` writes | `CoverageNode` |
| "Accept my selected option." | `accept_quote` | `acceptedTier`, `referenceNumber` | code text via `finish()` | nowhere; the graph is complete |

## Adjusting: re-rate and reply in code

```ts
@Tool("adjust_quote")
async adjustQuote(input: AdjustQuoteInput): Promise<ToolResponse> {
  const state = this.graph.graphState();
  if (
    input.liability === undefined &&
    input.collisionDeductible === undefined &&
    input.comprehensiveDeductible === undefined &&
    input.extras === undefined
  ) {
    return reject("Provide at least one coverage change to adjust.");
  }
  const current = state.nodes.CoverageNode?.coverage;
  const use = state.nodes.VehicleNode?.vehicle;
  if (!current || !use) return reject("There is no coverage selection to adjust yet.");
  const next: CoverageSelection = { ...current, /* only the supplied fields */ };
  const now = quoteNow();
  const error = validateCoverageSelection(next, use.ownership, now);
  if (error) return reject(error);
  const rating = buildRatingSubject(state.nodes);
  if ("error" in rating) return reject(rating.error);
  const tiers = RatingEngine.quoteTiers(rating.subject, next, now);
  const response = `Here is the updated quote:\n${formatTiers(tiers)}\nAdjust anything else, accept a tier, or rework the coverage.`;
  this.saveState({ tiers });
  this.graph.saveNodeState(CoverageNode, { coverage: next });
  return direct(response);
}
```

Step by step:

1. **The change is a patch.** Only fields the model supplied are merged over the saved coverage.
   An empty call is rejected, so the model cannot "adjust" nothing.
2. **The same rules apply.** A what-if runs through `validateCoverageSelection()`, so "what if I
   dropped collision?" on a financed car is refused with the lender sentence, exactly as in the
   coverage stage.
3. **The same engine prices it,** from the same committed subject.
4. **Both channels are updated.** `QuoteNode` gets the new tiers, and `CoverageNode` gets the new
   coverage, so a later adjustment or revision starts from the current selection. That shared
   write is discussed in [lesson 2](/ezgraph/docs/tutorials/quote-graph/graph-and-state/).
5. **`direct(response)` ends the turn** with text built by `formatTiers()`. There is no second
   model call. The loop appends the text as an assistant message, so the model sees what the
   customer saw on the next turn, and `QuoteNode` stays the resume point.

Replay turn 14 is this path: "Here is the updated quote: 1. Saver — state-minimum liability,
$1000/$1000 deductibles, no extras: $99.96/mo…". The wording is the template's, and every number
is the engine's.

`adjust_quote` cannot change the start date; its schema has no `startDate`. A customer who wants a
different start date has to go back through `revise_coverage`.

### Two names for one tier

`formatTiers()` labels tiers with `TIER_LABELS`: "Saver", "Your selection", and "Shield". The model's
presentation on turn 13 works from the JSON, where the middle tier's ID is `selected`, and called it
"Selected". So the customer sees two names for the same tier on consecutive turns. Putting the
display labels into `TIERS_JSON`, or telling `quote.md` to use them, would make the model and the
code agree.

## Revising: go back with the customer's words

```ts
@Tool("revise_coverage")
async reviseCoverage(
  { isRevise }: ReviseCoverageInput,
  _context: Record<string, never>,
  state: QuoteGraphStateType,
): Promise<ToolResponse> {
  if (!isRevise) return stay("Continue with the current quote tiers.");
  return go(CoverageNode).withMessage(new HumanMessage(this.graph.input(state)));
}
```

`this.graph.input(state)` returns the newest human message in the current node's history space.
That is `quote-present`, and the message is what the customer just said. `CoverageNode` lives in
`quote-intake`, where the latest human message is from much earlier in the conversation. The
forwarded message puts the customer's actual request at the end of the intake history. The
coverage model then reads "let's rework this with premium liability", not a synthetic "the customer
wants to revise".

Nothing is cleared. `QuoteNode` keeps its old tiers until `select_coverage` replaces them, which is
safe because only `QuoteNode` can accept, and the conversation is now in `CoverageNode`.

Two small oddities:

- **The `isRevise` flag.** The tool takes a boolean, and `false` returns `stay()`. An empty
  `z.object({})` schema works for argument-free tools elsewhere in EZGraph, and would remove a way
  for the model to call the tool and then decline.
- **`graph.input()` returns any human message.** If the model called `revise_coverage` on the very
  turn `QuoteNode` was entered, the newest human message in `quote-present` would be the stage
  instruction "Present the quote tiers.", not the customer's words. In practice the model calls it
  only after the customer asks.

## Accepting: only a current tier

```ts
@Tool("accept_quote")
async acceptQuote(input: AcceptQuoteInput): Promise<ToolResponse> {
  const local = this.getState() as QuoteGraphNodeState<"QuoteNode">;
  const tier = local.tiers?.find((candidate) => candidate.tier === input.tier);
  if (!tier) return reject("That tier is not part of the current quote.");
  const referenceNumber = `QT-${Math.floor(100000 + Math.random() * 900000)}`;
  const response = `You're all set — ${ACCEPTED_TIER_PHRASES[tier.tier]} (${TIER_LABELS[tier.tier]}) is locked in at ${usd(tier.monthlyPremium)}/month starting ${tier.coverage.startDate}. Your quote reference is ${referenceNumber}.`;
  this.saveState({ acceptedTier: tier.tier, referenceNumber });
  return finish(response);
}
```

The model names a tier; code finds it in the *saved* list. Because `adjust_quote` replaces that list,
acceptance always uses the latest calculated premium. On turn 15 that is $130.49, not the $140.43
presented two turns earlier. The confirmation, premium, start date, and reference are all written in
code, and `finish()` completes the graph: `currentNode` becomes `end` and the reply is marked
`completed: true`.

`ACCEPTED_TIER_PHRASES.selected` is "your selected coverage", and `TIER_LABELS.selected` is "Your
selection". Put together, turn 15 reads "your selected coverage (Your selection)". The reference
number is random and not checked for uniqueness. A real system would issue it from the quoting
backend.

## Why it is written this way

A displayed quote is an explanation; an accepted quote is a business event. `QuoteNode` lets the
model handle the first, presenting and discussing the tiers, and keeps the second in code. Numbers
come from the engine, what-if answers come from a template, and acceptance is checked against the
current saved list. `direct()` and `finish()` are what make that practical: code can reply without
asking the model to repeat it.

## Common mistakes

- **Letting the model restate recalculated prices.** Reply with `direct()` and code-built text.
- **Validating what-ifs less strictly than the original.** Reuse the same rule function.
- **Accepting a tier by name without checking the saved list.** Stale or invented tiers must fail.
- **Going back without the customer's words.** The earlier stage reads only its own history;
  forward the request.
- **Mismatched labels.** Give the model and the code the same display names.

## Next

Continue to [10. Testing the whole quote](/ezgraph/docs/tutorials/quote-graph/testing/).
