---
title: An annotated BasicFlow session
eyebrow: Concepts
lede: A completed BasicFlow run, sanitized for publication, shows how one session document carries the cursor, execution trail, memory, step state, token totals, and diagnostics needed for inspection.
source: Sanitized BasicFlow session capture supplied by the PicoFlow team
---

This page is based on one real completed BasicFlow session. The field names, step sequence,
status, revision, and token totals are retained. Session IDs, timestamps, system prompts,
message content, tool-call IDs, and customer data are replaced or abbreviated.

It is an inspection example, not a recommended production retention policy. A real session can
contain prompts, messages, tool arguments, and business data. Apply the same privacy, retention,
and access controls you would apply to application records.

## What this run shows

| Signal | Value in this run | Why it matters |
| --- | --- | --- |
| Flow | `BasicFlow` | A session is bound to one registered flow. |
| Outcome | `completed` | The terminal status decides that a new request starts a new session. |
| Revision | `23` | Twenty-three successful writes occurred during the conversation. |
| Token totals | 5,688 input / 823 output / 6,511 total | Cost and model-use evidence travels with the session. |
| Registered steps | 14 | Every step retains its own durable state entry. |
| Sequence entries | 13 | The execution trail includes top-level and nested work. |
| Memory namespaces | 9 | Conversation history can be separated by step or purpose. |
| Diagnostics | Empty in this clean run | Diagnostic arrays are present even when no log, warning, or error was emitted. |

## Sanitized document excerpt

The full capture is about 32 KB. The abbreviated excerpt below keeps the parts an operator uses
first during an incident. Ellipses and bracketed values stand for sanitized data; they are not
literal values stored by PicoFlow.

```json
{
  "id": "basicflow-demo-session",
  "revision": 23,
  "version": 1.5,
  "runStatus": "completed",
  "createdOn": "<sanitized timestamp>",
  "saveOn": "<sanitized timestamp>",
  "expireAfter": 50000,
  "tokens": {
    "inputTokens": 5688,
    "outputTokens": 823,
    "totalTokens": 6511,
    "reasoningTokens": 340,
    "visibleOutputTokens": 483,
    "cachedInputTokens": 0,
    "cacheCreationInputTokens": 0
  },
  "flow": {
    "name": "BasicFlow",
    "model": {
      "provider": "openai",
      "name": "gpt-4o-mini",
      "params": { "temperature": 0.2 }
    },
    "memory": {
      "WeatherStep": {
        "messages": [
          { "type": "system", "content": "<step instructions redacted>" },
          { "type": "human", "content": "Start" },
          { "type": "ai", "content": "<asks for supported cities>" },
          { "type": "human", "content": "<unsupported cities>" },
          { "type": "ai", "content": "<explains the validation failure>" },
          {
            "type": "ai",
            "content": "",
            "tool_calls": [
              { "name": "get_weather", "args": { "cityName": "LA" }, "id": "<redacted>" },
              { "name": "get_weather", "args": { "cityName": "NYC" }, "id": "<redacted>" }
            ]
          },
          { "type": "tool", "name": "get_weather", "content": "input validated", "status": "success" },
          { "type": "tool", "name": "get_weather", "content": "input validated", "status": "success" }
        ]
      },
      "default": { "messages": "<22 sanitized messages>" },
      "favorite": { "messages": "<4 sanitized messages>" },
      "ConcurStep1": { "messages": "<3 sanitized messages>" },
      "ConcurStep2": { "messages": "<3 sanitized messages>" },
      "ConcurStep3": { "messages": "<3 sanitized messages>" },
      "ConcurStep4": { "messages": "<3 sanitized messages>" },
      "separate": { "messages": "<2 sanitized messages>" },
      "temp": { "messages": "<3 sanitized messages>" }
    },
    "steps": [
      { "name": "WeatherStep", "state": { "city_LA": "<saved result>", "city_NYC": "<saved result>", "_saveOn": "<timestamp>" } },
      { "name": "NameStep", "state": { "name": "<redacted>", "inContext": "<saved value>", "_saveOn": "<timestamp>" } },
      { "name": "DOBStep", "state": { "year": "<redacted>", "month": "<redacted>", "day": "<redacted>", "_saveOn": "<timestamp>" } },
      { "name": "AddressStep", "state": { "address": "<redacted>", "_saveOn": "<timestamp>" } },
      "<10 more registered step entries>"
    ],
    "sequence": [
      { "level": 1, "stepName": "WeatherStep" },
      { "level": 1, "stepName": "FooLogicStep" },
      { "level": 1, "stepName": "GooLogicStep" },
      { "level": 1, "stepName": "FavoritesStep" },
      { "level": 1, "stepName": "NameStep" },
      { "level": 2, "stepName": "InContextStep" },
      { "level": 3, "stepName": "ConcurStep1" },
      { "level": 3, "stepName": "ConcurStep2" },
      { "level": 4, "stepName": "ConcurStep4" },
      { "level": 4, "stepName": "ConcurStep3" },
      { "level": 1, "stepName": "DOBStep" },
      { "level": 1, "stepName": "AddressStep" },
      { "level": 1, "stepName": "TerminateSessionStep" }
    ],
    "currentStep": "TerminateSessionStep"
  },
  "log": [],
  "error": [],
  "warn": [],
  "debug": [],
  "verbose": []
}
```

## Read it as an operator

Start with the top-level status rather than the message history:

1. `runStatus: "completed"` means this is not resumable, even though the cursor still names
   `TerminateSessionStep`. A terminal cursor is useful evidence of how the conversation ended;
   it is not permission to continue the same session.
2. `revision: 23` is the last successful compare-and-swap write. It is a concurrency token, not
   a count of user messages or a schema version.
3. `flow.sequence` answers how execution arrived at the terminal step. Level 1 entries are
   top-level transitions. Levels 2 through 4 are nested work run inside a parent turn.
4. `flow.memory` answers what the model had available in each namespace. The `WeatherStep`
   history shows an unsupported-input response followed by two validated tool calls.
5. `flow.steps` answers what accepted business data and step-local results survived the turn.
6. `tokens` gives the cumulative provider-neutral cost picture for the entire session.

The important separation is that message history records model context, step state records
accepted application data, and `sequence` records execution shape. They answer different
debugging questions.

## Diagnostics: present, but empty here

This run completed without a runner warning, unhandled error, or application log emission, so
all five diagnostic arrays are empty. That is useful evidence in itself: an empty `error` array
does not mean the document lacks observability; it means this specific run did not emit an
error record.

`SessionLogger` writes structured entries into the same document when your flow or the runtime
emits them:

```ts
new SessionLogger(this.getSessionDoc()).log("Finished concurrent flow", {
  operation: "concurrentSteps",
});
```

Use logs for deliberate application events, warnings for recoverable runtime conditions, and
errors for terminal failures. Do not duplicate every prompt and response in a log entry: those
may already be present in memory and can contain customer data.

## Controlled replay from a captured session

The session document supports application-level inspection and controlled replay; it is not a
historical checkpoint stream. The document holds the latest state, not a snapshot after every
prior turn.

To investigate a prior point safely:

1. Retain or export a copy of the document at the point you want to investigate.
2. Work in an isolated environment with a fresh session ID and store record. Never edit a live
   production session in place.
3. Keep `flow.name`, the target step's persisted state, and the required memory namespaces
   consistent. Setting `currentStep` alone is not sufficient.
4. Set `currentStep` to a registered step that can accept the restored state and message
   history.
5. Replace real providers and side-effecting tools with scripted models and fakes before
   running the next turn.
6. Compare the resulting response, cursor, state, sequence, diagnostics, and token totals with
   the expected outcome.

Replaying can call a model again and can repeat side effects if real tools are attached. Make
external effects idempotent and use a non-production environment for every replay exercise.

## Sanitization checklist

Before sharing a session document outside the environment that created it, remove or replace:

- session IDs, MongoDB `_id` values, timestamps, and tool-call IDs;
- system prompts, internal instructions, model credentials, and file paths;
- customer messages, names, addresses, dates of birth, account data, and payment data;
- raw tool arguments and results unless they are explicitly safe demo values.

Keep the field names, namespace names where safe, sequence, status, revision, token counters,
and representative message types. Those are what make the document useful as a technical
example.

## Related

<div class="cards">
	<a class="card" href="/docs/concepts/session-document/">
		<span class="card__title">The session document</span>
		<span class="card__body">The complete field-by-field persistence contract.</span>
	</a>
	<a class="card" href="/docs/resources/interrupts-replay-and-operations/">
		<span class="card__title">Interrupts, replay, and operations</span>
		<span class="card__body">How application-level replay differs from checkpoint history.</span>
	</a>
	<a class="card" href="/docs/guides/testing/">
		<span class="card__title">Testing a flow</span>
		<span class="card__body">Assert the response and the persisted session contract together.</span>
	</a>
</div>
