---
layout: layouts/ezgraph.njk
title: 6. Criteria collectors and corrections
description: Build five small ConversationNode collectors that validate and own one criterion each, share one reroute tool, and let the router apply an out-of-order correction in a single turn.
permalink: /ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/
ezgraph: true
ezgraphDocument: true
---

# 6. Criteria collectors and corrections

The five collectors are the only nodes in the graph that talk to a chat model about criteria. Each
one is deliberately narrow: one criterion, one or two capture tools, and a way back to the router.
That narrowness is what lets a customer answer out of order and still end up with a consistent
record.

## The goal

- Write a collector that validates a value, saves it, and hands control back to the router.
- Split validation between the tool schema and handler code.
- Share one tool definition across several nodes.
- Follow an out-of-order correction through the graph in a single turn.

## Anatomy of a collector

`DateRangeNode` in full:

```ts
export class DateRangeNode extends ConversationNode<DecisionHotelGraphStateType> {
  getPrompt(): string {
    return fillHotelPrompt(hotelPrompts.dates, {
      CURRENT_DATE: CriteriaHelper.currentBusinessDate().toISOString().slice(0, 10),
    });
  }

  defineTool(): readonly ToolDefinition[] {
    return [
      {
        name: "capture_date_range",
        description: "Save complete check-in and checkout dates.",
        schema: z.object({ start: z.string(), end: z.string() }),
      },
      {
        name: "reroute_request",
        description: "Return a request for another hotel criterion to the router.",
        schema: z.object({}),
      },
    ];
  }

  @Tool("capture_date_range")
  async captureDateRange(input: { start: string; end: string }): Promise<ToolResponse> {
    const start = CriteriaHelper.parseDate(input.start);
    const end = CriteriaHelper.parseDate(input.end);
    if (!start || !end) {
      return stay("Use valid calendar dates for both check-in and checkout.");
    }
    if (start <= CriteriaHelper.currentBusinessDate()) {
      return stay("Check-in must be after the current date.");
    }
    if (end <= start) return stay("Checkout must be after check-in.");
    this.saveState({ answered: true, start: input.start, end: input.end });
    return go(RouterDecisionNode);
  }

  @Tool("reroute_request")
  async rerouteRequest(): Promise<ToolResponse> {
    return go(RouterDecisionNode);
  }
}
```

Every collector follows the same shape:

- A **prompt file** that names the one criterion, the capture tool, and when to call
  `reroute_request`.
- A **capture tool** whose handler either returns `stay(feedback)`, keeping the model in this node
  to ask again, or saves the channel with `answered: true` and returns `go(RouterDecisionNode)`.
- A **reroute handler** that returns `go(RouterDecisionNode)` without saving anything.

A successful capture never decides what comes next. It always returns to the router, which reads
the updated snapshot and picks the next question. Adding a sixth criterion does not touch the
other five collectors.

## Schema and code share the validation

| Collector | Tool schema (checked before the handler runs) | Handler checks | Saved on success |
| --- | --- | --- | --- |
| `DateRangeNode` | two strings | real `YYYY-MM-DD` dates; check-in after today; checkout after check-in | `start`, `end` |
| `BudgetNode` | two finite numbers or `null` | neither negative; minimum not above maximum | `min`, `max` |
| `RoomTypeNode` | `z.enum(["one bed", "two beds", "suite"])` | none needed | `roomType` |
| `AmenityNode` | `capture_amenities`: an array of at least one allowed amenity; `capture_no_amenity_preference`: no arguments | none needed; duplicates removed | `amenities` (empty for "no preference") |
| `DistanceNode` | two finite numbers or `null` | neither negative | `airport`, `cityCenter` |

Two rules decide where a check goes:

- **Closed sets go in the schema.** Room types and the 23 amenity names are Zod enums built from
  `CriteriaHelper.ROOM_TYPES` and `CriteriaHelper.AMENITIES`. The model cannot even send an
  unsupported value; EZGraph rejects it as `{ accepted: false, error }` before the handler runs.
- **Rules that need context go in code.** "After today" needs the business date, and "February 30"
  passes a `YYYY-MM-DD` regex. `CriteriaHelper.parseDate()` parses the string and then checks that
  it formats back to the same text, so `2027-02-30` is rejected even if a model passes it through.
  On turn 2 of the live replay, "February 30" never became a saved date.

`AmenityNode` needs two tools because an empty array is ambiguous: it could be a model that has not
understood the answer yet. Requiring at least one amenity in `capture_amenities`, and offering a
separate `capture_no_amenity_preference`, makes "no preference" an explicit act.

## One tool definition, five handlers

Only `DateRangeNode` lists `reroute_request` in `defineTool()`. The other four collectors simply
decorate a method with `@Tool("reroute_request")`. That works because tool definitions are
registered once per graph, and `@Tool` selects a definition by name from that registry. A second
`defineTool()` entry with the same name would fail at startup with
`Tool 'reroute_request' is defined by both 'DateRangeNode' and '…'`.

The same mechanism supplies `terminate_session`: `TerminateSessionNode` defines it, and every
`ConversationNode` inherits a handler.

<div class="callout"><span class="label">Where to define a shared tool</span><p>Defining the shared tool in one arbitrary collector works, but it hides a dependency: remove <code>DateRangeNode</code> and four other nodes lose their reroute tool. For a larger graph, define shared tools on a small base class or a dedicated node, so ownership is obvious.</p></div>

## One snapshot for everyone else

The router, the readiness judge, and the search node never read collector channels directly. They
call `CriteriaHelper.readCriteria(state)`, which returns one `HotelCriteriaSnapshot`:

```ts
{
  dates: { answered: boolean; start: string | null; end: string | null };
  budget: { answered: boolean; min: number | null; max: number | null };
  roomType: { answered: boolean; roomType: RoomType | null };
  amenities: { answered: boolean; amenities: Amenity[] };
  distance: { answered: boolean; airport: number | null; cityCenter: number | null };
}
```

The reader is defensive: it drops unknown amenities, and it turns anything that is not a finite
number into `null`. `validateCriteria()` then applies the same rules the collectors applied on
write, plus "not answered", and returns issues in a fixed field order. Validating on read as well
as on write protects against state the collectors did not write, such as a session saved by an
older version of the graph.

## A correction, traced through one turn

On turn 7 of the live replay, the graph is waiting on `AmenityNode` when the customer says
"Actually change my dates to August 3 through August 9, 2027". The whole correction happens in
that one turn:

1. The engine resumes `AmenityNode`. Its model recognizes a date request and calls
   `reroute_request`, which returns `go(RouterDecisionNode)`.
2. The router asks Jev. Dates are already answered, so it forwards the message:
   `go(DateRangeNode).withMessage(new HumanMessage(context.request))`.
3. `DateRangeNode`'s model reads the forwarded message and calls `capture_date_range` with
   `2027-08-03` and `2027-08-09`. The handler validates and saves them, then returns
   `go(RouterDecisionNode)`.
4. The router asks Jev again. Amenities are the first unresolved criterion, so it returns
   `directTo(AmenityNode, "Which hotel amenities do you require?")`.

The customer sees the amenity question again, and the corrected dates are saved. In a scripted
run of the same five turns, this turn made two chat-model calls and two decision calls, and left
these entries at the end of the shared `hotel-intake` history:

```text
human: Actually change my dates to August 3 through August 9, 2027
ai:    (tool call: reroute_request)            ← AmenityNode
tool:  OK
human: Actually change my dates to August 3 through August 9, 2027   ← forwarded by the router
ai:    (tool call: capture_date_range)         ← DateRangeNode
tool:  OK
ai:    Which hotel amenities do you require?   ← the router's directTo() text
```

The forwarded message is the duplicate discussed in [lesson 5](/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/).
Every step reads and writes state through one owner: `AmenityNode` saves nothing, `DateRangeNode`
overwrites only its own channel, and the router works from the snapshot.

The deterministic test makes this turn harder on purpose. Its scripted `AmenityNode` answers with
two tool calls in one batch: `capture_amenities` with an empty list, which the schema rejects, and
`reroute_request`. The test asserts that the turn still ends at `AmenityNode` with the corrected
dates saved and amenities still unanswered.

## Why it is written this way

A non-linear conversation over linear data needs one rule: every fact has one owner, and nobody
else writes it. The collectors never route anywhere except the router, and the router never edits
a criterion. So a correction is the same operation as a first answer, arriving at a different
time. No downstream conclusion has to be invalidated, because the readiness judge, the search, and
the presentation all recompute from the current snapshot every time they run.

## Common mistakes

- **Letting a collector route forward on its own.** Return to the router, and let it read the
  snapshot; otherwise every collector must know the whole order.
- **Saving before validating.** A malformed value in state becomes a problem for every later node.
- **Relying on a regex for dates.** `2027-02-30` matches `\d{4}-\d{2}-\d{2}`; parse and round-trip.
- **Using an empty array to mean "no preference".** Give that answer its own tool.
- **Defining a shared tool twice.** Define it once and decorate the other handlers.
- **Reading another node's channel directly in policy code.** Go through one snapshot function so
  every reader agrees.

## Next

Continue to [7. Readiness and deterministic search](/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/).
