---
title: 6. Branch, forward, and return
eyebrow: HotelFlow tutorial
lede: A user who says "compare 2 and 5 on price" should not have to say it twice. This lesson covers the three mechanisms that move a request across a step boundary without asking the user to repeat themselves.
source: pico-demo/src/myflow/hotel-flow/present-step.ts, pico-demo/src/myflow/hotel-flow/compare-step.ts
---

`PresentStep` is a junction. From a single result list the user can book,
search again, or compare — and two of those three targets need to know what the
user actually said. PicoFlow gives you three tools for that: `onCrossing()` to
seed a step with a synthetic message, `.withMessage(...)` to forward a real
one, and `flow.saveStepState(...)` to prime a step's state before you enter it.

## The goal

- Seed a newly entered step with a synthetic request using `onCrossing()`.
- Forward the user's own text across a transition with
  `.withMessage(this.getLastMessage())`.
- Prime a destination step's state before entering it with
  `flow.saveStepState(...)`.
- Return from a branch and re-enter the step you left.

## What happens on a step boundary

When a turn's execution moves from one step to another, the runner detects it
before building the request:

```ts
const history = step.getMemory();
if (priorStep.getName() !== step.getName()) {
  await flow.saveSession();
  langMessage =
    step.onCrossing(langMessage, priorStep.getName()) ?? undefined;
}
```

Three things follow from those four lines.

1. The session is persisted at every genuine step boundary, so a crash between
   stages does not lose the transition.
2. `onCrossing()` receives whatever message the transition carried — possibly
   `null` — and returns the message the new step will actually see.
3. It does not run on a self-transition, because the names match.

The default implementation, on `Step`, injects a `"Start"` message when there
is nothing else to say and the last message in memory came from another step.
Overriding it lets a step decide what its own first turn looks like.

## Seeding a step with a synthetic message

From `pico-demo/src/myflow/hotel-flow/present-step.ts`:

```ts
public onCrossing(
  _userMessage: MessageTypes,
  _priorStep?: string,
): MessageTypes {
  return new HumanMessageEx(this, "What hotels choice I have");
}
```

Both parameters are ignored — the underscore prefixes say so. Whatever the
transition carried, `PresentStep` always begins with the same synthetic
request, which combined with its prompt produces the numbered result list.

That is the right choice here, because every path into `PresentStep` means the
same thing:

```text
ExploreStep  --capture_choices, results found--> "show me the list"
CompareStep  --resume_booking-----------------> "show me the list"
```

`HumanMessageEx` is a thin `HumanMessage` subclass that stamps the message with
a step-scoped id, which is what the runner uses to tell whose history a message
belongs to:

```ts
export class HumanMessageEx extends HumanMessage {
  constructor(step: Step, content: string, hint?: MessageHint) {
    super({
      content: content,
      id: step.genMessageId(),
      additional_kwargs: hint ?? { direct: false },
    });
  }
}
```

Build synthetic messages with `HumanMessageEx(this, ...)` rather than a raw
`HumanMessage`, unless you are also setting the id yourself — InvoiceFlow does
exactly that when it has to attach a file part.

## Forwarding the user's own words

`search_again` is the simplest transition in the flow:

```ts
@Tool
protected async search_again(): Promise<ToolResponseType> {
  // go(...) changes steps; forward the request so ExploreStep can refine the search.
  return go(ExploreStep).withMessage(this.getLastMessage());
}
```

`getLastMessage()` returns the newest message in **this step's** memory
namespace:

```ts
public getLastMessage(): MessageTypes | null {
  const mem = this.flow.getMemory(this.memorySpace);
  if (mem.length > 0) {
    return mem.at(-1) ?? null;
  }
  return null;
}
```

The builder attaches it to the transition, and the runner delivers it to the
destination's `onCrossing()`. `ExploreStep` does not override `onCrossing`, so
the default returns it unchanged and the model sees the user's actual sentence
against `explore.md`'s instructions.

This is what makes the scenario turn `"change to a 2 bed rooms, search"` work
in one turn. `PresentStep` recognises a re-search intent and calls
`search_again`; `ExploreStep` receives the same sentence, updates `cRoomType`
in the scaffold, and fires `capture_choices` — without a round trip that asks
the user what they wanted changed.

<div class="callout callout--tip"><span class="callout__title">Forwarding only helps if the destination reads it</span><p>Forwarding a message into <code>PresentStep</code> would be pointless, because its <code>onCrossing()</code> discards the argument. Check the destination&rsquo;s crossing behaviour before adding <code>.withMessage(...)</code>, or you will spend a turn debugging a message that was thrown away on arrival.</p></div>

## Priming a step before you enter it

`go_compare` has more work to do, because `CompareStep` needs two lists: the
hotels the user picked and the hotels that were available to pick from.

```ts
@Tool
protected async go_compare(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const rawHotels = args?.hotelsToCompare;
  if (
    !Array.isArray(rawHotels) ||
    rawHotels.some((hotelName) => typeof hotelName !== "string")
  ) {
    return stay("Choose hotels from the presented list to compare.");
  }
  const requestedHotels = rawHotels
    .map((hotelName: string) => hotelName.trim())
    .filter((hotelName: string) => hotelName.length > 0);
  const availableHotels =
    (this.getState("hotelFound") as SearchHotelEntry[] | undefined) ?? [];
  const availableByName = new Map(
    availableHotels.map((hotel) => [
      hotel.hotelName.toLowerCase(),
      hotel.hotelName,
    ]),
  );
  const selectedHotelNames = requestedHotels.map((hotelName) =>
    availableByName.get(hotelName.toLowerCase()),
  );
  if (
    requestedHotels.length === 0 ||
    selectedHotelNames.some((hotelName) => hotelName === undefined) ||
    new Set(selectedHotelNames).size !== selectedHotelNames.length
  ) {
    return stay("Choose distinct hotels from the presented list to compare.");
  }

  this.flow.saveStepState(CompareStep, {
    compare_hotel: selectedHotelNames,
  });

  const strAvailableHotel = availableHotels.map((entry) => entry.hotelName);

  // go(...) enters comparison mode with the selected hotel data as destination state.
  return go(CompareStep)
    .withState({
      available_hotel: strAvailableHotel,
    })
    .withMessage(this.getLastMessage());
}
```

Two different ways of writing to another step appear here, and the difference
is timing:

```ts
this.flow.saveStepState(CompareStep, { compare_hotel: ... });  // now
go(CompareStep).withState({ available_hotel: ... });           // when the transition is applied
```

`saveStepState` reaches into the registered instance and calls `saveState` on
it immediately. `.withState(...)` is data attached to the returned builder that
the runner applies to the destination after `flow.goto` succeeds. Both end up
in `CompareStep`'s state bag before its prompt is built, so in this handler the
choice is stylistic. It stops being stylistic if the transition can fail or be
overridden downstream — `saveStepState` has already written by then.

Here `this.getState("hotelFound")` reads the results that `PresentStep` owns.
If a handler needs to read another step's state, use the explicit
`flow.getStepState(StepClass, key)` form instead.

`go_compare` validates the requested names against the current result list and writes
the canonical names to `compare_hotel`. `CompareStep.getPrompt()` reads that same key
on the first comparison; after a chart is generated it can also render the enriched
`chosen_hotels` rows.

## Reading the primed state back

From `pico-demo/src/myflow/hotel-flow/compare-step.ts`:

```ts
public getPrompt(): string {
  const compare_hotel = (this.getState("compare_hotel") as string[]) ?? [];
  const chosen_hotels =
    (this.getState("chosen_hotels") as Array<{ hotelName?: string }>) ?? [];
  const available_hotel = this.getState(`available_hotel`) ?? [];

  let prompt = `
  ${ComparePrompt}
  ${FlowPrompt.EndChat}
  `;

  const hotels =
    compare_hotel.length > 0
      ? compare_hotel.map((hotelName) => ({ hotelName }))
      : chosen_hotels.map(({ hotelName }) => ({ hotelName }));

  prompt = Prompt.replace(prompt, {
    ChosenHotels: JSON.stringify(hotels),
    AvailableHotels: JSON.stringify(available_hotel),
  });

  return prompt;
}
```

`compare.md` is written as a four-state machine around those two variables. Its
rules are explicitly conditional on emptiness:

```text
- If `ChosenHotels` is not empty, do not ask the user to choose hotels again.
- If `ChosenHotels` is not empty, skip State 1 and go directly to State 2.
- If `ChosenHotels` is not empty and the user already provided a valid feature,
  skip State 2 and go directly to State 3.
```

A prompt written this way stays correct whether the step was primed or entered
cold, which is the property you want when a step has more than one caller.

## Returning

The way back is a plain transition with nothing attached:

```ts
@Tool
protected async resume_booking(): Promise<ToolResponseType> {
  // go(...) returns to the booking-results step.
  return go(PresentStep);
}
```

No state, no message. `PresentStep` still has `hotelFound` in its own state bag
from the original search, its `onEnter()` clears the stale presentation
history, and its `onCrossing()` supplies "What hotels choice I have". The
result list is regenerated from data that never moved.

That is the payoff of the ownership discipline from lesson 1: because the
result list belongs to `PresentStep`, returning to it costs one line.

## Why it is written this way

The three mechanisms cover three genuinely different needs.

| Need | Mechanism |
| --- | --- |
| The destination always starts the same way | `onCrossing()` returning a synthetic message |
| The destination must interpret this specific user request | `.withMessage(this.getLastMessage())` |
| The destination needs data, not words | `.withState(...)` or `flow.saveStepState(...)` |

Keeping them separate means a step's entry behaviour is defined on the step, in
one place, rather than being reconstructed from every handler that can reach
it. `PresentStep` guarantees its own opening line no matter who called it, and
callers cannot accidentally break that guarantee.

## Common mistakes

- **Forwarding a message to a step whose `onCrossing()` discards it.** Nothing
  breaks, but the request is silently lost.
- **Building synthetic messages with a bare `HumanMessage`.** Without a
  step-scoped id from `genMessageId()`, the runner cannot attribute the message.
- **Calling `getLastMessage()` after switching namespaces in your head.** It
  reads the *current* step's namespace, not the conversation as a whole.
- **Skipping validation before priming comparison state.** Resolve every requested
  name against the current result list and reject unknown or duplicate names.
- **Assuming `onCrossing()` fires on every turn.** It fires only when the step
  actually changed during the turn.
- **Carrying data forward in the message text.** Put data in state and words in
  the message.

## Next

[7. Answering without an LLM](/docs/tutorials/hotel-flow/direct-responses/) picks up
inside `CompareStep`, where the answer is a rendered table and no second model
call happens at all.
