---
title: 14. Transient state and context
eyebrow: BasicFlow tutorial
lede: PicoFlow has four places to put data and they have different lifetimes. Choosing wrong is the most common cause of a value that mysteriously disappears — or one that mysteriously will not change.
source: pico-demo/src/myflow/basic-flow/name-step.ts, pico-demo/src/myflow/basic-flow/incontext-step.ts, pico-demo/src/myflow/basic-flow/president-step.ts
---

Durable step state, transient step state, flow context, and conversation memory. Three
of them look like key-value stores and behave differently. This lesson pins down which
is which, using the three BasicFlow steps that exercise all of them.

## The four stores

| Store | Written with | Scope | Persisted | Read with |
| --- | --- | --- | --- | --- |
| Step state | `saveState(json)` | one step, forever | yes | `getState(key)`, `flow.getStepState(Class, key)` |
| Transient step state | `saveTransientState(json)`, `flow.saveTransientStepState(Class, json)` | one step, one request | **no** | `getTransientState(key)` |
| Flow context | request `config` on session creation | whole flow | yes, but frozen at creation | `getContext("config.x")` |
| Memory | the runner, per turn | one namespace | yes | `getMemory()`, `getLastMessage()` |

Memory is covered in [lesson 15](/docs/tutorials/basic-flow/memory-and-models/). The other
three are here.

## Transient state: an argument to a child

`NameStep` sets a value on a step it is about to invoke:

```ts
this.flow.saveTransientStepState(InContextStep, {
  msg: "transient variable passed from NameStep",
});
const answer = await this.runStep(InContextStep);
```

and `InContextStep` reads it in `onEnter()`:

```ts
protected async onEnter() {
  await super.onEnter();
  const msg = this.getTransientState<string>("msg");
  console.log("InContextStep.transient msg=", msg);
  // ...
}
```

That is the whole pattern: transient state is how a parent passes a parameter to a
nested child when `runStep`'s single `userMessage` string is not enough.

Under the hood it is the same store as durable state, namespaced under a reserved key:

```ts
public saveTransientState(json: JsonObject) {
  return this.saveState(json, SaveStateType.transient);
}

public getTransientState<T = JsonObject>(key?: string): T {
  return this.getState<T>(key, SaveStateType.transient);
}
```

`saveState` with `SaveStateType.transient` merges into `state._transient` instead of
`state`. And `writeDoc` — the method that serialises a step into the session document —
strips it:

```ts
public writeDoc(stepDoc: StepType[]) {
  for (const sdoc of stepDoc) {
    if (sdoc.name === this.id) {
      sdoc.state = omit(this.state, K.TRANSIENT);
      // ...
    }
  }
}
```

`K.TRANSIENT` is `"_transient"`. So transient values are readable for the remainder of
the request and are gone the moment the document is written. Nothing to clean up, and
nothing that can leak into a resumed session.

<div class="callout callout--tip"><span class="callout__title">Tip</span><p>Use transient state for anything you would have passed as a function argument: a request-scoped correlation id, a decrypted token, a large intermediate blob. Use durable state for anything a later turn must see.</p></div>

## Durable state and its merge semantics

`saveState` is not a naive deep merge. Read it carefully:

```ts
public saveState(
  json: JsonObject,
  stateType: SaveStateType = SaveStateType.persistent,
) {
  if (json) {
    const stateKey = Object.keys(json)[0];
    if (!stateKey) return;
    if (stateType === SaveStateType.transient) {
      const transient = omit(get(this.state, K.TRANSIENT, {}), stateKey);
      this.state = merge({}, this.state, {
        [K.TRANSIENT]: merge({}, transient, json),
      });
    } else {
      this.state = omit(this.state, stateKey);
      this.state = merge({}, this.state, json);
    }
    this.state = merge(this.state, { _saveOn: moment().toDate() });
  }
}
```

Two behaviours follow.

**The first key is replaced, not merged.** `omit(this.state, stateKey)` removes the
first key of the incoming object before merging. So
`saveState({ address: { city: "Portland" } })` fully replaces any previous `address`
object rather than merging into it. That is what you want for
`AddressStep.saveState({ address: response })`.

**Only the first key gets that treatment.** `DOBStep` calls
`saveState({ year, month, day })`: `year` is replaced, `month` and `day` are deep-merged
by lodash. For scalars this is indistinguishable. For objects it is not. Call
`saveState` once per logical value and the distinction never bites you.

**A falsy argument is a silent no-op.** `if (json)` guards the whole body, so
`saveState(undefined)` does nothing at all.

Every write stamps `_saveOn`, which is why persisted state objects contain a timestamp
you did not put there.

## Flow context: session-wide configuration

Context comes from the request body's `config` object, and only when the session is
created. `FlowEngine.run` wraps it:

```ts
const context = input.config === undefined ? undefined : { config: input.config };
```

and `FlowCreator` calls `flow.addContext(context)` before bootstrap. The extra nesting
is why every read is prefixed:

```ts
const nth = this.getContext<string>("config.nth");
```

`PresidentStep` uses it to build its question:

```ts
public onCrossing(
  _langMessage: MessageTypes,
  _priorStep?: string,
): MessageTypes {
  const nth = this.getContext<string>("config.nth");
  this.sessionCompleted();
  return new HumanMessageEx(
    this,
    `Who is the ${nth} President of United State`,
  );
}
```

and `BasicFlow` uses it for two flow-level decisions:

```ts
protected initialStep() {
  return this.getContext<boolean>("config.isPresident")
    ? PresidentStep
    : WeatherStep;
}
```

Context is persisted in the flow document, so it survives restarts. But it is **frozen
at creation**. On a restored session, `readDoc()` overwrites the in-memory context with
the stored one:

```ts
this.context = flowDoc.context;
```

Sending a different `config` on turn 5 has no effect. The engine will happily accept it
and then discard it. If a value must be changeable mid-conversation, it belongs in step
state, not context.

`getContext` is a lodash `get` over the context object, so dotted paths work to any
depth: `getContext("config.tenant.region")`.

## Correct context access

Values supplied in the request's `config` object are read through the `config.` path:

```ts
const runData = this.flow.getContext<JsonObject>("config.myRunData");
this.saveState(runData);
```

The same prefix applies to nested values such as `config.tenant.region`. If you need to
inspect the complete context object, call `this.flow.getContext()` without a path.

## Choosing between them

Ask two questions.

**Does a later turn need to see it?** If yes, it is durable step state — owned by the
step that produced it. If no, and it exists only to hand to a child in this request, it
is transient.

**Was it supplied by the caller when the session started, and is it the same for the
whole session?** Then it is context. Tenant id, feature flags, a file name for a
one-shot extraction, `isPresident`. Anything the conversation collects is not context,
even though it is tempting: context cannot be updated on a restored session.

## Why it is written this way

Transient state exists because `runStep(Child, userMessage?)` takes a string, and a
string is not enough for a structured argument. The alternatives would have been to
widen `runStep`'s signature — coupling every call site to every child's parameter shape
— or to let children read the parent's state directly, which inverts ownership. A
namespaced, non-persisted slot on the child keeps the argument where the child looks for
it and guarantees it cannot outlive the call.

Stripping transient data at `writeDoc` rather than at the end of the call is a
deliberate simplification: there is one place where persistence happens, so there is one
place where the filter has to be right.

Freezing context at session creation is the more debatable choice. It makes a restored
session reproducible — the configuration it ran under is recorded in its own document —
at the cost of surprising anyone who expects `config` to behave like request parameters.
The rule to remember is that `config` configures a *session*, not a *request*.

## Common mistakes

- **Expecting a new `config` to reconfigure a restored session.** It is overwritten by
  the stored context during `readDoc()`.
- **Putting collected domain data in context.** It cannot be updated later. Use the
  state of the step that collected it.
- **Expecting transient state to survive the response.** It is stripped in `writeDoc`.
  If a later turn needs it, it was never transient.
- **Calling `saveState` with a multi-key object and expecting all keys to be
  replaced.** Only the first is; the rest deep-merge.

## Next

[15. Memory namespaces and model overrides](/docs/tutorials/basic-flow/memory-and-models/)
covers the fourth store, and the per-step model configuration that sits beside it.
