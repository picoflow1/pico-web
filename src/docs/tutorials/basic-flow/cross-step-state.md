---
title: 8. Reading another step's state
eyebrow: BasicFlow tutorial
lede: State is owned by the step that collected it. Later steps read it through the flow rather than copying it forward.
source: pico-demo/src/myflow/basic-flow/dob-step.ts
---

`NameStep` collected the user's name. `DOBStep` wants to use it in a question. There
are two ways to arrange that, and PicoFlow pushes you towards the one that keeps a
single owner for each value.

## The goal

- Read a value another step persisted with `flow.getStepState(StepClass, key)`.
- Substitute it into a prompt template at render time.
- Understand why the value is not copied into the reading step's own state.

## The code

All of `pico-demo/src/myflow/basic-flow/dob-step.ts`'s `getPrompt()`:

{% raw %}
```ts
public getPrompt(): string {
  const template = `
  ${DemoPrompt.DemoPrompt}
  Ask the user to provide the date of birth for {{UserName}}.
  Accept common date formats, including M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD, and written month formats. Interpret slash-separated numeric dates as U.S. month/day/year.
  A valid date must immediately trigger the 'dob' tool with numeric year, month, and day. Do not ask the user to confirm or reformat a valid date.
  In particular, input 1/1/2000 is valid and MUST call 'dob' with year 2000, month 1, and day 1.
  Ask the user to re-enter the date only when it is missing, impossible, or cannot be interpreted under these rules.
  If the user explicitly asks to exit, call 'terminate_session'.
  `;

  const name = this.flow.getStepState<string>(NameStep, "name");
  const prompt = Prompt.replace(template, { UserName: name });
  return prompt;
}
```
{% endraw %}

Two lines do the work. `flow.getStepState<string>(NameStep, "name")` reads the `name`
key from `NameStep`'s durable state, and `Prompt.replace` drops it into the template.

`NameStep` wrote it in its tool handler:

```ts
this.saveState({ name });
```

Nothing was passed between the two steps. `DOBStep` reached across at the moment it
needed the value.

## The state helpers

`getStepState` is a thin resolver over the flow's step registry:

```ts
public getStepState<T = JsonObject>(
  stepClass: StepClassType,
  key?: string,
): T {
  const step = this.requireStep(stepClass.id);
  return step.getState<T>(key);
}
```

`requireStep` throws if the class is not in `defineSteps()`, so a cross-step read
cannot silently target a step this flow does not own. Omitting `key` returns the whole
state object.

The full set:

| Call | Reads or writes | Notes |
| --- | --- | --- |
| `this.getState<T>(key?)` | this step | Omit `key` for the whole object |
| `this.saveState(json)` | this step | Merges and stamps `_saveOn` |
| `this.removeState(key)` | this step | Deletes one key |
| `flow.getStepState(Class, key?)` | another step | Throws if unregistered |
| `flow.saveStepState(Class, json)` | another step | Use sparingly; see below |
| `flow.saveTransientStepState(Class, json)` | another step, non-persisted | [Lesson 14](/docs/tutorials/basic-flow/transient-state/) |

Note the asymmetry in the demo. `DOBStep` **reads** from `NameStep` but never writes to
it, and `NameStep` never writes into `DOBStep`. The only cross-step writes in BasicFlow
go through the routing builders — `go(X).withState(...)` — which write to the
destination at the moment it is activated.

## Read at render time, not at transition time

The alternative design would be for `NameStep` to push the name forward:

```ts
// not what BasicFlow does
return go(DOBStep).withState({ userName: name });
```

That works, and for a value the destination genuinely owns it is the right tool — that
is exactly what `FooLogicStep` does with `fooData`. But for a value the *source* owns,
copying creates a second copy that can go stale, and the session document now has the
name in two places. Which one is authoritative?

Reading at render time avoids the question. `getPrompt()` runs before every model call,
so the substitution always reflects the latest value in `NameStep`. If the user later
corrects their name and `NameStep` is re-entered, `DOBStep`'s next prompt picks up the
correction with no extra plumbing.

The persisted document keeps the ownership visible:

```json
{
  "steps": [
    { "name": "NameStep", "state": { "name": "John Wick", "_saveOn": "..." } },
    { "name": "DOBStep", "state": { "year": 2000, "month": 1, "day": 1 } }
  ]
}
```

The end-to-end test asserts exactly this shape —
`stepState(basicFlow, "NameStep").name === "John Wick"` and
`stepState(basicFlow, "DOBStep").year === 2000` — which is only a meaningful assertion
while each value has one home.

## How it works

Step state is not held on the instance between requests. During `bootstrap()` each
registered step runs `readDoc(flowDoc.steps)` and rehydrates its own slot; during
`saveSession()` each runs `writeDoc(...)`. So when `DOBStep.getPrompt()` calls
`getStepState(NameStep, "name")`, it is reading the in-memory `NameStep` instance that
was reconstructed and rehydrated a few milliseconds earlier in this same request.

This also explains why cross-step reads are cheap. There is no store round-trip; the
whole flow document was loaded once at the top of the request.

## Why it is written this way

The rule is: **the step that collected a value owns it**. Everything else follows.

It gives you one place to look when a value is wrong. If the date of birth is bad, the
bug is in `DOBStep`; nowhere else writes it. It makes the session document readable as
a record of which stage produced what. And it makes deleting a step a bounded
operation — you remove it from `defineSteps()`, and the compiler shows you every
`getStepState(ThatStep, ...)` that has to change.

The typed generic (`getStepState<string>`) is a convenience, not a guarantee. It casts;
it does not validate. If `NameStep` never ran, this returns `undefined` and
`Prompt.replace` substitutes the string `"undefined"` into the prompt. When a step can
be reached without its prerequisite, guard the read.

## Common mistakes

- **Copying a value forward with `withState` when the source still owns it.** You get
  two copies and no rule about which wins.
- **Reading state from a step that is not registered.** `requireStep` throws
  `Step 'X' is not defined in flow 'BasicFlow'.`
- **Trusting the generic parameter.** `getStepState<string>(NameStep, "name")` returns
  `undefined` at runtime if the key was never written; the type says otherwise.
- **Caching the value in a field.** Steps are reconstructed every request, and
  `getPrompt()` reruns after every tool response. Read it where you need it.
- **Using flow context for domain values.** Context is initialised from the first
  request's `config` and is not refreshed on later turns. Collected data belongs in
  step state.

## Next

Every step so far has called a model. [9. Deterministic LogicStep](/docs/tutorials/basic-flow/logic-steps/)
introduces one that never does.
