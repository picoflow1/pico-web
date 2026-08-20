---
title: 18. Testing a flow end to end
eyebrow: BasicFlow tutorial
lede: Assert on the persisted session document, not only on what the assistant said. A fluent reply from the wrong step is the failure mode that matters.
source: pico-demo/test/basic-flow/basic-flow.scenario.json, pico-demo/test/basic-flow/basic-flow.e2e-spec.ts
---

A flow test that only checks response text passes when the model is charming and the
routing is broken. BasicFlow's end-to-end test asserts three things per turn: what the
assistant said, what `flow.currentStep` became, and — at the end — what every step
actually stored. It runs against a live model or a scripted one, using the same
assertions either way.

## The goal

- Describe a conversation as data, not as test code.
- Assert on message content **and** the persisted cursor after every turn.
- Assert final state per step.
- Run the same scenario against a real provider or a deterministic stub.

## The scenario is data

`pico-demo/test/basic-flow/basic-flow.scenario.json` defines eight turns. Two of them:

```json
{
  "label": "unsupported city recovery",
  "input": "PDX,PHX",
  "expectedResponse": "Reject PDX and PHX as unsupported, explain that only LA and NYC are supported, and ask the user to provide supported city names.",
  "expectedActiveStep": "WeatherStep",
  "responseMustInclude": ["support", "LA", "NYC"],
  "completed": false
},
{
  "label": "final end response",
  "input": "123 K St. Portland, OR 97006",
  "expectedResponse": "Confirm that the address was accepted and that the conversation/profile collection is complete. Do not ask for more information.",
  "expectedActiveStep": "TerminateSessionStep",
  "responseMustInclude": ["address", "complete"],
  "completed": true
}
```

Five fields do the work:

| Field | Asserted? | Purpose |
| --- | --- | --- |
| `label` | no | Names the turn in progress logs and failure messages |
| `input` | — | The user message posted to `/ai/run` |
| `expectedResponse` | no | Prose intent, printed on failure to explain what should have happened |
| `expectedActiveStep` | **yes** | The persisted `flow.currentStep` after the turn |
| `responseMustInclude` | **yes** | Case-insensitive substrings that must appear in the reply |
| `completed` | **yes** | The response flag and the persisted `runStatus` |

`expectedResponse` is deliberately not machine-checked. Asserting on a model's exact
wording is a losing game; asserting that "support", "LA", and "NYC" appear is stable
across providers and temperature settings, and the prose gives a human reading a failure
enough context to judge whether the model was wrong or the assertion was.

The full path exercised by the eight turns:

```text
"Hi"                          -> WeatherStep      (asks for LA/NYC)
"PDX,PHX"                     -> WeatherStep      (stay: unsupported)
"LA,NYC"                      -> FavoritesStep    (through Foo/Goo logic steps)
"blue, Star Wars, summer"     -> NameStep         (favorites parsed and saved)
"John Doe"                    -> NameStep         (stay: placeholder rejected)
"John Wick"                   -> DOBStep          (nested InContextStep tree runs here)
"1/1/2000"                    -> AddressStep
"123 K St. Portland, OR 97006"-> TerminateSessionStep, completed
```

Two turns are `stay()` loops and two are multi-step hops. Both matter: a `stay` that
accidentally advanced, or a `go` that silently did not, is invisible in the reply text.

## The turn loop

From `basic-flow.e2e-spec.ts`:

```ts
for (const [index, turn] of scenario.turns.entries()) {
  logProgress(`turn ${index + 1}/${scenario.turns.length}: ${turn.label}`);
  logProgress(`input: ${turn.input}`);

  const response = await send(turn.input);
  logProgress(`response: ${preview(response.message)}`);

  assert.equal(
    response.completed,
    turn.completed,
    `${turn.label} completed flag mismatch`,
  );
  expectResponseContract(turn, response);
  assert.ok(sessionId, `${turn.label}: expected a session id`);
  await expectTurnSessionState(app, sessionId, turn);
  logProgress(`contract: current step=${turn.expectedActiveStep}`);
}
```

`send` posts through the real Fastify instance with `server.inject`, so the controller,
the DTOs, the header handling, and the engine all participate. It also asserts the
session-id round-trip on every turn:

```ts
const responseSessionId = readSessionHeader(response.headers);
if (sessionId) {
  assert.equal(body.session, sessionId, "Session id changed in body");
  assert.equal(responseSessionId, sessionId, "Session id changed in response header");
} else {
  sessionId = responseSessionId ?? body.session;
}
```

An id that changes mid-conversation means a session was silently recreated — the exact
symptom of a failed restore — and it would otherwise show up only as a model that has
forgotten everything.

## Asserting the persisted cursor

This is the assertion that makes the suite worth running:

```ts
async function expectTurnSessionState(
  app: NestFastifyApplication,
  sessionId: string,
  turn: ScenarioTurn,
): Promise<void> {
  const sessionDoc = await app
    .get(FlowEngine)
    .getFlowSession()
    .fetchAll(sessionId);
  assert.ok(sessionDoc, `${turn.label}: expected a session document`);
  assert.equal(sessionDoc.flow?.name, scenario.flowName);
  assert.equal(
    sessionDoc.runStatus,
    turn.completed ? "completed" : "running",
    `${turn.label}: persisted run status mismatch`,
  );

  assert.equal(
    sessionDoc.flow?.currentStep,
    turn.expectedActiveStep,
    `${turn.label}: persisted current step mismatch`,
  );
}
```

It re-reads the document from the store — not from the in-memory flow, which is gone —
so it verifies that the transition was **written**, not merely computed.

Two of these assertions encode things earlier lessons claimed:

`"John Wick"` expects `DOBStep`. That turn runs `NameStep.user_name`, which runs
`InContextStep`, which runs `ConcurStep1` and `ConcurStep2`, which run `ConcurStep3` and
`ConcurStep4`. Five nested model calls, and the cursor lands on `DOBStep` — never on any
of the children. That is the `runStep()` contract from
[lesson 12](/docs/tutorials/basic-flow/nested-runstep/), asserted.

`"LA,NYC"` expects `FavoritesStep`, not `FooLogicStep`. The two logic steps are traversed
within the same request, so they are never observable as a persisted cursor. That is the
`LogicStep` behaviour from [lesson 9](/docs/tutorials/basic-flow/logic-steps/), asserted.

## Asserting final state

```ts
assert.equal(stepState(basicFlow, "WeatherStep").city_LA, 72);
assert.equal(stepState(basicFlow, "WeatherStep").city_NYC, 83);
assert.deepEqual(stepState(basicFlow, "FavoritesStep").favorites, {
  favoriteColor: "blue",
  favoriteMovie: "Star Wars",
  favoriteSeason: "summer",
});
assert.equal(stepState(basicFlow, "NameStep").name, "John Wick");
assert.equal(stepState(basicFlow, "DOBStep").year, 2000);
assert.equal(stepState(basicFlow, "DOBStep").month, 1);
assert.equal(stepState(basicFlow, "DOBStep").day, 1);
assert.equal(stepState(basicFlow, "AddressStep").address.zip, "97006");
assert.equal(stepState(basicFlow, "AddressStep").address.city, "Portland");
assert.equal(stepState(basicFlow, "AddressStep").address.state, "OR");
```

Every value is checked in the slot of the step that owns it — the ownership rule from
[lesson 8](/docs/tutorials/basic-flow/cross-step-state/), made executable. The address
assertions only work because `AddressStep` persists the **parsed** object rather than the
raw string, and `city_LA: 72` only works because `WeatherStep` normalised the alias
before building the state key.

`72` and `83` are the deterministic local fixture's fixed answers, so they are safe constants:

```ts
if (normalized === "nyc") return 83;
if (normalized === "la") return 72;
```

## Live model versus scripted model

The same file runs two ways.

```bash
npm run test:basic-flow                                       # live provider
BASIC_FLOW_USE_SCRIPTED_MODEL=1 npm run test:basic-flow       # scripted, no provider calls
```

<div class="callout callout--note"><span class="callout__title">Note</span><p>The demo's internal guide refers to an <code>npm run test:basic-flow:contract</code> script. No such script exists in <code>pico-demo/package.json</code>; set <code>BASIC_FLOW_USE_SCRIPTED_MODEL=1</code> on the normal test script instead. The related <code>test2:basic-flow</code> script sets <code>BASIC_FLOW_TEST_USE_ENV=1</code> to use the environment's configured session store.</p></div>

The scripted variant is selected by `BASIC_FLOW_USE_SCRIPTED_MODEL=1`, and the test swaps
the model factory on the prototype:

```ts
function installScriptedBasicFlowModel(): () => void {
  const modelPrototype = Model.prototype as Model & {
    createInstance: (...args: unknown[]) => unknown;
  };
  const originalCreateInstance = modelPrototype.createInstance;
  modelPrototype.createInstance = () => new ScriptedBasicFlowModel();

  return () => {
    modelPrototype.createInstance = originalCreateInstance;
  };
}
```

The stub implements the three methods the runner uses — `bindTools`,
`withStructuredOutput`, `invoke` — and dispatches on the **system prompt**, which is how
it knows which step is asking:

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
```

Note that this is what exercises the `@Tools(["get_weather"])` group handler from
[lesson 16](/docs/tutorials/basic-flow/mcp-and-multi-tool/): two calls in one AI message.

The stub is strict about coverage:

```ts
throw new Error(
  `No scripted BasicFlow response for system prompt: ${preview(systemPrompt)}`,
);
```

Add a step and forget to script it, and the scripted run fails with the prompt that had
no branch — a useful forcing function.

What the scripted run still covers: the controller, DTOs, engine, session lock, SQLite
store, tool dispatch including group dispatch, transitions, logic steps, nested and
parallel execution, structured output, and every persisted-state assertion. What it does
not cover: whether a real model actually calls the tool when a real user types
`"1/1/2000"`. That is what the live run is for, and it is why both exist.

## Environment

```ts
const requiredConfig = useScriptedModel
  ? ["PICOFLOW_KEY"]
  : ["OPENAI_API_KEY", "PICOFLOW_KEY"];
const missingConfig = requiredConfig.filter((key) => !process.env[key]?.trim());
```

The test **skips** rather than fails when configuration is missing, with the reason in
the skip message. `PICOFLOW_KEY` is required for both, because the runner verifies the
licence on every model call.

The session store defaults to SQLite at `test/.tmp/basic-flow-session.sqlite`, created if
absent, and `BASIC_FLOW_TEST_USE_ENV=1` switches to whatever the environment configures.
Running against a real store matters: the persisted-state assertions are only meaningful
if serialisation and deserialisation are in the loop.

## Why it is written this way

Separating the scenario from the runner means adding a turn is a JSON edit, and the diff
shows the conversation rather than test plumbing. It also means the same file could drive
a different harness — a manual QA script, a load test — without rewriting the assertions.

Asserting the persisted cursor after **every** turn, rather than only at the end, is the
design decision that catches the most bugs. Routing errors compound: a step that fails to
advance produces a plausible reply, and the next turn's reply is plausible too, and the
test only notices four turns later when the wrong question is asked. Checking the cursor
each turn localises the failure to the turn that caused it.

Extending the flow means extending the test in the same shape:

1. Add a scenario turn for every new `stay` and `go` decision, including the failure
   paths — `"PDX,PHX"` and `"John Doe"` exist for exactly that reason.
2. Add a final-state assertion for whatever the new step persists, in that step's slot.
3. Add a branch to the scripted model keyed on a distinctive phrase from the new
   prompt.
4. For nested work, assert the child's state too. A fluent outer response can hide a
   failed internal branch, and the reply text will not tell you.

## Common mistakes

- **Asserting exact model wording.** It breaks on every model upgrade.
  `responseMustInclude` with a few load-bearing substrings survives.
- **Asserting only the reply.** The reply is the least reliable signal in the system.
  Check `currentStep` and step state.
- **Reading state from the in-memory flow.** It is discarded at the end of the request.
  Fetch the document from the store, as `expectTurnSessionState` does.
- **Testing with an in-memory session store only.** Serialisation bugs — a `Date`, a
  `Map`, an undefined — only appear when a real store round-trips the document.
- **Only testing the happy path.** Two of the eight turns are rejections, and they are
  the turns that verify `stay()` does not advance the cursor.
- **Forgetting to script a new step.** The stub throws with the unmatched system prompt,
  which is the intended behaviour, not a test bug.

## Next

That completes the BasicFlow track. Continue with the
[HotelFlow track](/docs/tutorials/hotel-flow/) for memory compaction, backend tools, and
`direct()` responses, or the [InvoiceFlow track](/docs/tutorials/invoice-flow/) for multimodal
extraction and one-shot flows. The [track overview](/docs/tutorials/basic-flow/) has the full
step map if you want to re-read a lesson against it.
