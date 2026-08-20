---
title: 2. Big prompts as spec files
eyebrow: HotelFlow tutorial
lede: ExploreStep collects eight fields over as many turns. Its instructions live in a Markdown file that reads like a specification, and its working data lives in a JSON scaffold injected fresh on every turn.
source: pico-demo/src/myflow/hotel-flow/prompt/hotel-prompt.ts, pico-demo/src/myflow/hotel-flow/prompt/role.md, pico-demo/src/myflow/hotel-flow/prompt/explore.md, pico-demo/src/myflow/hotel-flow/prompt/explore.json, pico-demo/src/myflow/hotel-flow/explore-step.ts
---

`ExploreStep` has to collect dates, a price range, a room type, a set of
amenities, and two distances before it can search. That is far too much
instruction to keep in a template literal. HotelFlow externalises it into
`explore.md`, a numbered task list, and pairs it with `explore.json`, a mutable
scaffold that gives the model a fixed shape to fill in.

## The goal

- Load prompt text from files with `Prompt.file()` and understand how it
  resolves paths.
- Compose a role partial, a stage specification, and the framework's end-chat
  instructions into one system prompt.
- Inject a JSON scaffold that the model accumulates across turns.
- Pin the conversation date so date-sensitive runs are reproducible.

## Prompt.file resolves against the calling file

From `pico-demo/src/myflow/hotel-flow/prompt/hotel-prompt.ts`:

```ts
export class HotelPrompt {
  public static Role = Prompt.file('role.md');
}
```

From `pico-demo/src/myflow/hotel-flow/explore-step.ts`:

```ts
const ExplorePartial = Prompt.file("prompt/explore.md");
const ExplorePrompt = `
  ${HotelPrompt.Role}
  ${ExplorePartial}
  ${FlowPrompt.EndChat}
  `;

const HotelJSON = Prompt.file("prompt/explore.json");
```

Two different relative paths reach files in the same directory, because
`Prompt.file()` resolves against the directory of whichever module called it.
The implementation walks the stack to find that directory:

```ts
public static file(filePath: string): string {
  const callerDir = this.getCallerDir();
  const absolutePath = path.resolve(callerDir, filePath);

  if (this.cache.has(absolutePath)) {
    return this.cache.get(absolutePath)!;
  }

  const content = readFileSync(absolutePath, 'utf-8');
  this.cache.set(absolutePath, content);
  return content;
}
```

Reads are synchronous, cached by absolute path, and — because these are
module-level `const` declarations — happen once at import time, not per turn.

<div class="callout callout--warning"><span class="callout__title">Build step</span><p>Compiled output must keep the same relative layout, or <code>Prompt.file()</code> will not find the asset. The demo handles this with a <code>postbuild</code> script: <code>copyfiles -u 1 'src/**/*.{json,md,png,pdf}' dist/</code>.</p></div>

## Three sources, one system prompt

`ExplorePrompt` is a plain template literal concatenating three strings.

`HotelPrompt.Role` is the persona, shared with any other step that wants it:

```text
## Role & Tone ##
- **Role:**
  - You are a travel AI assistant for Hilton Hotel.
  - You can use you knowledge on trip planning to answer user's question but only to Portland Oregon.
- **Tone:**
  - Professional, friendly, positive, warm, genuinely enthusiastic.
  - Refrain from talking other topics and jokes other than relevant hotel booking inquiries
- **Chat Termination:** if user explicitly wants to terminate the conversation, immediately call tool `terminate_session`
```

`FlowPrompt.EndChat` is shipped by the framework and is itself a `Prompt.file`
call against `terminate-session.md`:

```text
## End Chat ##
  - **Intend** Only if a user express intend to terminate conversation, call tool `terminate_session`
  - **Examples**
    - Bye
    - end conversation
    - I do not want to continue
```

Both the role file and the framework partial name the same tool. That is not
redundant — `terminate_session` is defined separately on every conversational
step in this flow, so the instruction has to travel with each prompt that
offers it.

`explore.md` is the stage specification. It is written as a numbered task list
with an explicit "go to Task N" control flow:

```text
## Tasks List Section ##
  - **Task1**
    -  you must tell user, you can only provide Hotel booking in Portland, OR metropolitan area only.
    - If `yes`, go to `Task2 `
    - If `no`,
      - Immediately call tool `terminate_session`, set the property `prompt` to: "..."

  - **Task2**
    - Ask user what date range the hotel stay is going to be.
    - You must tell start date must be a day greater than today's date in `Variable`: `HotelJSON.currentDate`
    ...
    - Important! You must figure out individual days and set it in `Variable` `HotelJSON.cDateArray` properties.
```

Eight tasks, each with worked examples of the phrasings a user might produce,
plus a trailing `## Situational Logic ##` section that handles "change X" at any
point. Prose of this size is much easier to review, diff, and hand to a
non-engineer as a `.md` file than as a string in a TypeScript module.

## The JSON scaffold

`explore.md` opens by naming a variable that does not exist yet:

```text
## Main Instructions ##
  - **Variable**
    - `HotelJSON`={% raw %}{{HOTEL_JSON}}{% endraw %}
    - you must refer to this `HotelJSON` at all time when executing instructions.
```

`explore.json` supplies its shape and its vocabulary:

```json
{
  "currentDate": null,
  "amenities": [
    "freeWiFi", "nonSmoking", "freeBreakfast", "freeParking", "airportShuttle",
    "roomService", "fitnessCenter", "petFriendly", "digitalKey", "boutique",
    "onSiteRestaurant", "indoorPool", "businessCenter", "meetingRoom",
    "evCharging", "connectingRooms", "eveningReception", "concierge",
    "streaming", "kitchen", "tennis", "outdoorPool", "newHotel"
  ],
  "roomType": ["one bed", "two beds", "suite"],
  "cAmenities": [],
  "cRoomType": [],
  "cPriceRange": { "min": null, "max": null },
  "cDistance": {"cityCenter":null,"airport":null},
  "cDate": { "start": null, "end": null },
  "cDateArray": [],
  "hotelFound":[]
}
```

The `c`-prefixed keys are the ones the model fills in. The other two are
closed vocabularies: `amenities` is the exact set of keys `hotels.json` uses,
so mapping "I want a pool" onto `indoorPool` happens in the prompt rather than
in fuzzy string matching later.

## Building the prompt on every turn

From `explore-step.ts`:

```ts
public getPrompt(): string {
  const hotelJson = JSON.parse(HotelJSON);
  // Allow deterministic callers (notably replayable E2E scenarios) to pin
  // the conversation date without changing the production default.
  const currentDate =
    process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format();
  set(hotelJson, "currentDate", currentDate);

  const hotelFound = this.getState("hotelFound");
  if (hotelFound) {
    set(hotelJson, "hotelFound", hotelFound);
  }

  const prompt = Prompt.replace(ExplorePrompt, {
    HOTEL_JSON: JSON.stringify(hotelJson),
  });
  return prompt;
}
```

Four things happen here, in order.

### JSON.parse per call, not per module

`HotelJSON` is the cached file **text**. Parsing it inside `getPrompt()`
produces a fresh object every turn, so `set(...)` never mutates shared state.
Had the parse been hoisted to module scope alongside the `Prompt.file()` call,
one session's `currentDate` would leak into every other session in the process.

### lodash set for the injection points

`set(hotelJson, "currentDate", currentDate)` writes through a path string,
which is what makes deeper injections such as `cPriceRange.max` trivial to add
later without restructuring the object literal.

### The determinism override

`process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format()` is the entire
mechanism. Production gets the real UTC timestamp; the end-to-end test sets:

```ts
process.env.HOTEL_FLOW_CURRENT_DATE =
  process.env.HOTEL_FLOW_CURRENT_DATE ?? '2027-07-15T00:00:00.000Z';
```

The scenario then books 1–8 August 2027, and the pricing engine produces the
same numbers on every run. Without the pin, "the year is omitted, assume the
current year" in Task 2 would make the transcript drift.

### Prompt.replace fills the placeholders

{% raw %}
```ts
public static replace(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/{{(.*?)}}/g, (match, key) => {
    return values[key] || match;
  });
}
```
{% endraw %}

A global regex over `{% raw %}{{key}}{% endraw %}`, substituting from a plain
record and leaving the placeholder in place when the key is missing. Note the
`||`: a value of `""` or `0` is falsy and also leaves the raw placeholder in
the prompt. Pass strings you know are non-empty, or use `Prompt.replace2`,
which tests for `undefined` instead — [InvoiceFlow lesson
2](/docs/tutorials/invoice-flow/no-tool-step/) covers that variant.

## Why it is written this way

The scaffold is a contract about **shape**, not a store. PicoFlow never parses
it, never validates it, and never persists it from the prompt side. It exists
so that the model has one place to accumulate answers and one obvious payload
to hand back when Task 7 fires `capture_choices`. The real persistence happens
in the tool handler, in code, where it can be validated.

That is the general pattern for long collection stages: prompt describes the
shape and the questions; the tool call transports the accumulated value; the
handler decides whether to accept it.

## Common mistakes

- **Parsing the scaffold at module scope.** The object becomes shared mutable
  state across every session in the process.
- **Assuming the model retains the JSON.** It does not. The accumulated value
  survives only because it is re-injected each turn through the prompt and
  ultimately captured by a tool call.
- **Relying on `Prompt.replace` with falsy values.** `values[key] || match`
  silently leaves `{% raw %}{{KEY}}{% endraw %}` in the prompt for `""` and
  `0`.
- **Letting the prompt's vocabulary drift from the data.** `explore.json`'s
  `amenities` array must stay in sync with the keys in `hotels.json`, or the
  model will emit an amenity the catalogue filter can never match.

<div class="callout callout--info"><span class="callout__title">A dead branch worth knowing about</span><p><code>getPrompt()</code> re-injects <code>hotelFound</code> from <code>this.getState("hotelFound")</code>, but nothing ever writes that key to <code>ExploreStep</code>. The search results are sent to <code>PresentStep</code> with <code>go(PresentStep).withState({ hotelFound })</code>, and <code>.withState()</code> writes to the destination. The branch is harmless, but it never fires. To make it work, <code>ExploreStep</code> would have to read <code>flow.getStepState(PresentStep, "hotelFound")</code>.</p></div>

## Next

[3. MCP-backed hotel search](/docs/tutorials/hotel-flow/backend-tools/) follows the
typed criteria into `capture_choices`, PicoFlow-owned routing, and the pricing
MCP service.
