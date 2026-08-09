---
title: 7. Present and book
eyebrow: HotelFlow tutorial
lede: The last stage lists priced results, offers three actions, and hands a generated confirmation message to the framework's terminal step. This is where a conversation becomes a transaction.
source: picoflow-demo/src/myflow/hotel-flow/present-step.ts, picoflow-demo/src/myflow/hotel-flow/prompt/present.md
---

`PresentStep` has the smallest prompt in the flow and the most branches. Its
job is to render a list from state, name the three things the user can do next,
and route accordingly. Booking is the only branch that leaves the flow, and it
does so by handing the terminal step the exact sentence it should say.

## The goal

- Render a result list from injected state rather than from conversation
  history.
- Offer a small, closed set of next actions and map each to one tool.
- Hand a generated message to `TerminateSessionStep` with `.withPrompt(...)`.
- Understand what "completed" means to the caller.

## The presentation prompt

`picoflow-demo/src/myflow/hotel-flow/prompt/present.md` in full outline:

```text
## Execution instruction ##
  - **Hotel founded JSON**
    - {% raw %}{{HOTEL_FOUND_INFO}}{% endraw %}

  - **Presenting Found Hotels**
    - Must use data from `Hotel founded JSON` section, present to user each item's
      `hotelName` , `total` in `Hotel founded JSON` list in numbered bullet form,
      and ask user to pick a number.
    - the `total` must be formatted in U.S. currency, and display "total price is: `total`"

  - **Subsequent Choices After Hotel Presentation**
    - While you are presenting the list of found hotels to be picked, tell user they can
      a. book a hotel by typing name or number presented above.
        - if user choose to book hotel, call tool `chosen_hotel`
      b. re-run the entire search
        - If user choose to re-run the search, immediately call tool `search_again`
      c. compare hotel features
        - If user choose to compare features of hotel, call tool `go_compare`
```

Each of the three actions is followed in the file by six to ten worked examples
of the phrasings a user might produce — "change distance to airport to 10
miles", "compare Hotel A vs. Hotel B", "show preferences". Enumerating
phrasings is cheap and does more for routing accuracy than restating the rule.

The step builds it with the same two-part composition used everywhere in this
flow:

```ts
public getPrompt(): string {
  const hotelFoundInfo = this.getState("hotelFound") as SearchHotelEntry;
  let prompt = `
  ${PresentPrompt}
  ${FlowPrompt.EndChat}
  `;

  prompt = Prompt.replace(prompt, {
    HOTEL_FOUND_INFO: JSON.stringify(hotelFoundInfo),
  });

  return prompt;
}
```

The list is injected as JSON on every turn. Nothing about it depends on the
history — which is precisely why `onEnter()` can erase that history, as lesson
4 covered, without breaking the presentation.

## Three tools, three branches

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "chosen_hotel",
      description: "Capture user choice of hotel",
      schema: z.object({
        hotelName: z.string().describe("Hotel name chosen"),
      }),
    },
    {
      name: "search_again",
      description: "User request to re-run the search hotel again",
      schema: z.object({
        isSearch: z.boolean().describe("run the search"),
      }),
    },
    {
      name: "go_compare",
      description: "User request compare hotel",
      schema: z.object({
        hotelsToCompare: z
          .array(z.string())
          .describe("Hotel names chosen to be compared"),
      }),
    },
  ];
}
```

Plus `terminate_session`, defined further down the file, for an explicit "bye".

Note that `chosen_hotel` takes a `hotelName`, not the number the user typed.
The prompt asks the user to pick a number and the model resolves it against the
list it just rendered. That keeps positional ambiguity out of the handler — but
it also means the handler receives a string the model produced, which is the
part worth validating.

## Booking

```ts
@Tool
protected async chosen_hotel(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  this.saveState({ hotel: args?.hotelName });
  const msg = `Tell user hotel is booked with confirmation #:${this.generateConfirmationNumber()}. Thank the user for choosing Hilton, you MUST NOT talk other things!`;
  // go(...) activates the terminal step, which asks the model to confirm the booking.
  return go(TerminateSessionStep).withPrompt(msg);
}

private generateConfirmationNumber(): number {
  return Math.floor(100000 + Math.random() * 900000);
}
```

The confirmation number is generated in code, not by the model — the one thing
in this transaction that must be unguessable by a language model is the one
thing a language model is worst at.

### How .withPrompt() reaches the terminal step

`withPrompt` is not a message. The runner stores it as state on the destination
under a reserved key:

```ts
if (result.prompt) {
  step.saveState({ _prompt: result.prompt });
}
```

`Step.getPrompt()`'s base implementation reads that key back:

```ts
public getPrompt(): string | null {
  const p = this.getState('_prompt');
  return p ? p.toString() : null;
}
```

And `TerminateSessionStep` uses it when present, falling back to a generic
close when it is not:

```ts
public getPrompt() {
  const basePrompt = super.getPrompt();
  if (basePrompt) {
    return basePrompt;
  } else {
    return AbruptEndPrompt;
  }
}
```

So the booking confirmation is a **system prompt** for one final model call.
The model still writes the sentence — tone, greeting, phrasing — but the
content it must convey, including the confirmation number, is fixed by code.
That is the same division of labour as the rest of the flow: the model chooses
words, the application chooses facts.

<div class="callout callout--warning"><span class="callout__title">The demo hardcodes the brand and drops the hotel name</span><p>The message always says &ldquo;Thank the user for choosing Hilton&rdquo; and never interpolates <code>args?.hotelName</code>, even though the handler just saved it. It also does not check the name against <code>hotelFound</code>, so a hallucinated hotel would be booked. In a real booking system, resolve the choice against the result list first, fail the tool with <code>stay(...)</code> if it does not match, and put the resolved name into both the saved state and the confirmation prompt.</p></div>

### Overriding getPrompt on a withPrompt target

The mechanism only works because `TerminateSessionStep.getPrompt()` calls
`super.getPrompt()`. A custom terminal step that overrides `getPrompt()` and
returns its own string will store `_prompt` and never read it. If you write
one, either read `super.getPrompt()` first or do not use `.withPrompt(...)`
against it.

## What "completed" means

`TerminateSessionStep` marks the session on entry:

```ts
public isEnd(): boolean {
  return true;
}

protected async onEnter() {
  this.flow.markCompleted();
}
```

`markCompleted()` sets `runStatus = 'completed'` on the session document, and
`Step.isEnd()` is what the flow reports back:

```ts
return {
  success: true,
  completed: step.isEnd(),
  message: MessageUtil.contentToText(resp),
  session: this.requireSessionDoc().id,
  contentType: step.contentType,
};
```

That `completed` flag is what the end-to-end scenario asserts on every turn:
`false` for the first thirteen, `true` for the fourteenth. Callers should treat
it as "do not send another message on this session id".

The terminal step is registered with `.useMemory('end')`, giving it its own
namespace so the closing exchange is not appended to a stage's history. Its
`onCrossing()` also inherits the previous step's content type:

```ts
public onCrossing(
  _userMessage: MessageTypes | null | undefined,
  priorStep?: string,
): MessageTypes {
  if (priorStep) {
    this.contentType = this.flow.requireStep(priorStep).contentType;
  }
  return new HumanMessageEx(this, "I'm done with chat");
}
```

That matters for flows that return JSON, which is what
[InvoiceFlow lesson 5](/docs/tutorials/invoice-flow/json-and-batch/) is about. For
HotelFlow it is a no-op, since every step stays on `text/plain`.

## The full path, end to end

The scenario in `picoflow-demo/test/hotel-flow/hotel-flow.scenario.json` walks the
whole graph in fourteen turns:

```text
 1 "Hi"                          ExploreStep   Task 1, Portland eligibility
 2 "yes"                         ExploreStep   Task 2, date range
 3 "8/1/2027 to 8/8/2027"        ExploreStep   Task 3, price range
 4 "max 700"                     ExploreStep   Task 4, room type
 5 "suite"                       ExploreStep   Task 5, amenities
 6 "free wifi, parking"          ExploreStep   Task 6, distances
 7 "none"                        ExploreStep   Task 7, confirm and search
 8 "search"                      -> PresentStep    capture_choices, results found
 9 "change to a 2 bed rooms,     -> ExploreStep    search_again, message forwarded
    search"                      -> PresentStep    capture_choices again
10 "compare hotel 2,5,8 on       -> CompareStep    go_compare, then
    price"                                         generate_comparison -> direct(table)
11 "compare on amenities"        CompareStep   reuses chosen_hotels, direct(table)
12 "compare hotels 2,5 on price" CompareStep   direct(table)
13 "resume booking"              -> PresentStep    resume_booking, list regenerated
14 "8"                           -> TerminateSessionStep  chosen_hotel, completed: true
```

Turn 9 is the one to look at if you want to see the whole design pay off. A
single sentence changes a criterion, re-runs a search, and returns a new list —
crossing two step boundaries — because the message was forwarded rather than
re-elicited.

## Why it is written this way

Booking is modelled as a handoff, not as a fourth conversational stage. The
transaction — resolve, record, generate an identifier — happens in the handler,
synchronously, before any transition. Everything after that is presentation,
so it belongs to a step whose only job is to say one thing and stop.

Using the framework's `TerminateSessionStep` rather than a custom one buys the
`isEnd()` contract, the `markCompleted()` call, and the content-type
inheritance for free. The only customisation needed is the message, which is
exactly what `.withPrompt(...)` is for.

## Common mistakes

- **Trusting the model's `hotelName`.** Resolve it against the result list
  before saving anything durable.
- **Generating identifiers in the prompt.** Confirmation numbers, order ids,
  and reference codes belong in code.
- **Overriding `getPrompt()` on a `.withPrompt(...)` target without calling
  `super.getPrompt()`.** The prompt is stored and never read.
- **Treating `completed: true` as advisory.** The session's `runStatus` is
  `completed`; continuing to post to it is not a supported path.
- **Building the result list from history.** Inject it from state, so the stage
  can erase its history on entry and still be correct.

## Next

You have finished the HotelFlow track. For file uploads, raw JSON responses,
and batch fan-out, continue with the
[InvoiceFlow track overview](/docs/tutorials/invoice-flow/). For tool batching,
structured output, and nested execution, see the
[BasicFlow track](/docs/tutorials/basic-flow/).
