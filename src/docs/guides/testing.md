---
title: Testing a flow
eyebrow: Guides
lede: Four levels of coverage, scenario files that assert every turn, a scripted model for determinism, and a model judge for the responses that only a human could otherwise grade.
source: pico-demo/test
---

A flow is a distributed system with a nondeterministic component in the middle. Testing it
well means separating the parts that must be exact — transitions, persisted state, session
identity — from the parts that can only be judged semantically.

## The levels

| Level | What it proves | How |
| --- | --- | --- |
| 1. Registration | The app boots and the flow is reachable | `GET /ai/flows` contains the name; the engine's `getFlowNames()` |
| 2. Step contracts | Schemas, handlers, validation and every `stay`/`go` decision | Unit tests over handler methods |
| 3. End-to-end session | Session ID round-trip, correct current step, completion, content type | A scenario driven through the real HTTP adapter |
| 4. Persistence and migration | Final state, memory ownership, sequence, status, version upgrades, conflicts | Read the session document back from the store |

Levels 3 and 4 are the ones that catch real regressions, and the demo specs run them together:
each turn asserts the response *and* re-reads the persisted document.

## Running the demo suites

```bash
npm test                 # runs test:flows
npm run test:flows       # standard registered flow suite
npm run test:basic-flow
npm run test:hotel-flow
npm run test:invoice-flow
npm run test:home-insurance-flow # deterministic rating + 20-turn live scenario
npm run typecheck        # tsc --project tsconfig.contract.json
```

Each spec is a plain `node --test` file executed through `tsx`, with no test framework beyond
`node:assert/strict`.

Every flow suite loads `.env`. It honors `SESSION_STORE` and `DOCUMENT_DB` when configured;
otherwise it falls back to SQLite under `test/.tmp/`. For example, `SESSION_STORE=MONGO`
writes the test session to MongoDB.

There are also two unit specs, `test/tool-decorator.spec.ts` and
`test/tool-response-helper.spec.ts`, which no npm script currently runs. Invoke them directly:

```bash
node --import tsx --test test/tool-decorator.spec.ts
```

## Scenario files: turn-by-turn assertions

Keep the conversation out of the spec. `BasicFlow` drives every turn from
`test/basic-flow/basic-flow.scenario.json`:

```json
{
  "flowName": "BasicFlow",
  "turns": [
    {
      "label": "name rejected",
      "input": "John Doe",
      "expectedResponse": "The assistant should reject John Doe and ask for another name.",
      "expectedActiveStep": "NameStep",
      "responseMustInclude": ["john doe"],
      "completed": false
    }
  ]
}
```

The spec validates the scenario's own shape before running, so a malformed turn fails loudly
rather than silently skipping an assertion.

## Deterministic contract assertions

For every turn, the spec asserts three independent things.

**The transport contract** — status, success, and a stable session ID in both the body and
the `CHAT_SESSION_ID` header:

```ts
const responseSessionId = readSessionHeader(response.headers);
if (sessionId) {
  assert.equal(body.session, sessionId, "Session id changed in body");
  assert.equal(responseSessionId, sessionId, "Session id changed in response header");
} else {
  sessionId = responseSessionId ?? body.session;
}
```

**The persisted contract** — read the document back from the store and check the cursor and
run status:

```ts
const sessionDoc = await app.get(FlowEngine).getFlowSession().fetchAll(sessionId);
assert.equal(sessionDoc.flow?.name, scenario.flowName);
assert.equal(sessionDoc.runStatus, turn.completed ? "completed" : "running");
assert.equal(sessionDoc.flow?.currentStep, turn.expectedActiveStep);
```

**The domain contract** — at the end, the state each step should own:

```ts
assert.equal(stepState(basicFlow, "WeatherStep").city_LA, 72);
assert.equal(stepState(basicFlow, "NameStep").name, "John Wick");
assert.equal(stepState(basicFlow, "AddressStep").address.zip, "97006");
```

<div class="callout callout--tip"><span class="callout__title">Pair every prose assertion with a structural one</span><p>A fluent model response can hide a missing <code>saveState()</code> or a wrong <code>go(...)</code> target. Asserting <code>flow.currentStep</code> and the owning step's state after each turn is what makes the suite a regression test rather than a vibe check.</p></div>

## Live models versus a scripted model

`BasicFlow` runs either way. `BASIC_FLOW_USE_SCRIPTED_MODEL=1` swaps the model
implementation for a deterministic one:

```bash
BASIC_FLOW_USE_SCRIPTED_MODEL=1 npm run test:basic-flow
```

The scripted model patches `Model.prototype.createInstance` and restores it afterwards. Its
`invoke()` branches on the system prompt to decide what to return:

```ts
if (systemPrompt.includes("exactly two city aliases")) {
  if (/\bLA\s*,\s*NYC\b/i.test(latestMessage)) {
    return scriptedToolCalls([
      { name: "get_weather", args: { cityName: "LA" } },
      { name: "get_weather", args: { cityName: "NYC" } },
    ]);
  }
  // ...
}
throw new Error(`No scripted BasicFlow response for system prompt: ${preview(systemPrompt)}`);
```

Note the final `throw`. An unmatched prompt is a test failure, not a default response — so a
prompt edit that the scenario does not cover surfaces immediately.

| Mode | Use it for | Requires |
| --- | --- | --- |
| Scripted | CI, transitions, state, persistence, tool dispatch | `PICOFLOW_KEY` only |
| Live | Prompt quality, tool-calling reliability, provider behaviour | `PICOFLOW_KEY` plus the provider key |

Run scripted on every commit; run live on a schedule and before a release. A scripted suite is
free, fast and deterministic, and it still exercises the whole runner — memory, retries, tool
dispatch, structured output and persistence.

## Model-judge semantic assertions

Some responses cannot be asserted with `includes()`. `HotelFlow` describes the *intent* of
each turn and has a model grade the actual response against it:

```json
{
  "flowName": "HotelFlow",
  "judgeModel": "gpt-4o",
  "judgeMinScore": 0.75,
  "turns": [
    {
      "label": "date range prompt",
      "input": "yes",
      "expectedResponse": "The assistant should proceed with the Portland hotel booking flow and ask for the stay date range.",
      "completed": false
    }
  ]
}
```

The judge is called at `temperature: 0` with `response_format: json_object`, and must return
`{ pass, score, reason, missing, contradictions }`. A turn passes when `pass === true` and
`score` reaches `minScore` — per turn, or the scenario default of `0.75`.

Make the judge's system prompt as specific as the domain requires. The hotel judge is told to
ignore markdown formatting differences, to accept 2027 dates, and to fail when the assistant
asks the user to re-select hotels it should have reused. Without that specificity, a judge
produces flaky results in both directions.

On failure the spec writes the whole transcript, including judge reasons, to
`test/.tmp/hotel-flow-semantic-failure.json`. Keep that artifact — reading the transcript is
usually faster than re-running the conversation.

Judge knobs: per-turn `minScore` and scenario `judgeMinScore`.
The live scenario runs when its provider credentials are present in `.env`.

## Pinning time and other nondeterminism

A flow that reads the clock cannot be replayed. `ExploreStep` reads an override first:

```ts
const currentDate =
  process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format();
```

The spec pins it before the app boots:

```ts
process.env.HOTEL_FLOW_CURRENT_DATE =
  process.env.HOTEL_FLOW_CURRENT_DATE ?? "2027-07-15T00:00:00.000Z";
```

That single line is what lets the scenario hard-code August 2027 dates and expect stable
prices. Apply the same pattern to every nondeterministic input a flow reads:

| Source | Technique |
| --- | --- |
| Current date or time | An environment override read inside the step |
| Random identifiers | Inject a generator, or assert the shape rather than the value |
| Backend data | Fixture files, as in `hotels.json` and the invoice PNG fixtures |
| Session store | Point at a temporary SQLite file under `test/.tmp/` |
| Model | The scripted model, or a pinned model ID and `temperature: 0` |

Set overrides **before** the Nest application is created. `CoreConfig` reads configuration
once, when the engine is constructed.

## New-flow checklist

1. `GET /ai/flows` lists the flow after boot.
2. A first request with no session ID returns a session ID in the body and the header.
3. Every scenario turn asserts the response, `flow.currentStep`, and `runStatus`.
4. Invalid input on each tool returns `stay(...)` and does not advance the cursor.
5. Valid input advances to the expected step and saves state on the right owner.
6. A resumed turn with the stored session ID keeps the same ID and the same current step.
7. The terminal turn reports `completed: true` and persists `runStatus: "completed"`.
8. Final state, memory namespaces and the execution sequence match expectations.
9. Nested children ran, saved their state, and did not move the cursor.
10. Migration is tested from every supported historical version, plus the reset path and the
    new session ID it returns.
11. Non-plain content types are asserted on the body shape, not only the header.
12. `npm run typecheck` passes, which catches model-selection and tool-schema type errors that
    runtime tests will not.

Related: [Testing a flow end to end](/docs/tutorials/basic-flow/testing/),
[Error handling and completion](/docs/guides/error-handling/), and
[Environment variables](/docs/reference/environment-variables/).
