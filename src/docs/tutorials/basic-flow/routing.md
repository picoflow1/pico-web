---
title: 5. Routing with go() and stay()
eyebrow: BasicFlow tutorial
lede: A handler returns where the conversation goes next. stay() is a corrective loop that keeps the current step active; go() moves the one durable cursor.
source: picoflow-demo/src/myflow/basic-flow/name-step.ts, picoflow-demo/src/myflow/basic-flow/dob-step.ts, picoflow-demo/src/myflow/basic-flow/address-step.ts
---

PicoFlow has one durable conversation cursor: `flow.currentStep`, a step-name string in
the session document. Nothing else decides which step handles the next user turn. The
routing helpers exist to move it, or deliberately not to.

## What you will build

- A corrective loop with `stay(reason)` that does not lose the turn.
- A forward transition with `go(TargetStep)`.
- Transitions that carry a prompt and destination state via the builders.

## stay() is a loop, not a no-op

From `picoflow-demo/src/myflow/basic-flow/name-step.ts`:

```ts
if (name.toLowerCase() === "john doe") {
  // stay(...) keeps NameStep active and returns corrective feedback to the model.
  return stay("Cannot accept John Doe, please choose a different name.");
}
```

Internally `stay` is barely a function:

```ts
export function stay(feedback?: string): ToolResponseBuilder {
  return go(getToolResponseStep()).withToolFeedback(
    feedback ?? K.ToolValidated,
  );
}
```

It resolves the currently executing step from an async-local scope and returns
`go(thatStep)` with the feedback attached as the tool result. Two consequences follow.

**The string is sent to the model, not to the user.** It becomes the tool-result
message in the conversation, and the model then composes a reply from it. That is why
BasicFlow's feedback strings read as instructions to an assistant rather than as user
copy:

```ts
return stay(
  `${cityName} is unsupported. Only LA and NYC are supported. Ask the user to enter LA or NYC.`,
);
```

**It costs another model call.** After the tool result is appended, the runner invokes
the model again — `getPrompt()` runs a second time — so the user still gets a reply
within the same HTTP request. The turn is not wasted.

<div class="callout callout--warning"><span class="callout__title">Warning</span><p><code>stay()</code> is only valid inside a PicoFlow tool handler. It reads the executing step from an <code>AsyncLocalStorage</code> scope established by <code>invokeToolHandler</code>. Called from <code>onResponse()</code>, <code>onEnter()</code>, or anywhere else it throws <code>Tool response helpers can only be used while a picoflow tool handler is running.</code></p></div>

Omitting the argument is legal — `stay()` uses the framework's standard
`"input validated"` message — but it tells the model nothing about what to fix. Prefer
an explicit reason.

## go() moves the cursor

```ts
this.saveState({ year: args?.year, month: args?.month, day: args?.day });
return go(AddressStep);
```

`go(target)` accepts a `Step` constructor or a registered step-name string, and
normalises it to the name. When the runner applies the result it calls `flow.goto(...)`,
which:

1. throws if the target is not registered;
2. returns immediately if the target is already current;
3. calls `currentStep.onExit()`;
4. appends the step to the flow's `sequence` audit trail;
5. sets `flowDoc.currentStep`;
6. calls `targetStep.onEnter()`;
7. runs the target's `onCrossing(message, priorStepName)` and its model loop.

All of that happens inside the same HTTP request. The user's next reply is handled by
the new step; the current reply was already composed by it.

## The builders

`go()` returns a `ToolResponseBuilder`, an immutable object whose `with*` methods each
return a fresh builder. `AddressStep` uses two of them:

```ts
@Tool
protected async address(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const response = ValidateAddress(args?.address);
  if (!response) {
    return stay(
      "Invalid address. Ask for street, city, two-letter state, and ZIP code.",
    );
  } else {
    this.saveState({ address: response });
    return go(TerminateSessionStep)
      .withPrompt(DemoPrompt.FromAddressEnd)
      .withState({ fromAddress: 5 });
  }
}
```

| Builder | Effect | Applied to |
| --- | --- | --- |
| `withToolFeedback(text)` | Returned to the model as the tool result | the current turn |
| `withState(json)` | `saveState(json)` after activation | the **destination** step |
| `withPrompt(text)` | Saves `_prompt`, which the base `getPrompt()` returns | the **destination** step |
| `withMessage(message)` | Appends a LangChain message after the tool result | the memory namespace |
| `withContentType(type)` | Sets the response content type | the destination step |

The destination-ownership rule is the one that catches people. `.withState({ fromAddress: 5 })`
does **not** write to `AddressStep`. It writes to `TerminateSessionStep`, because the
runner applies it after `goto` has activated the target. The address itself is saved
with `this.saveState({ address: response })` before the transition, on the step that
collected it.

`.withPrompt(DemoPrompt.FromAddressEnd)` works because `TerminateSessionStep.getPrompt()`
checks the base implementation first:

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

A step that overrides `getPrompt()` unconditionally will ignore any `withPrompt` aimed
at it.

## Two exits, two closings

`AddressStep` reaches the same terminal step two ways, and the difference is the whole
point of the builders:

```ts
@Tool
protected async terminate_session(): Promise<ToolResponseType> {
  // the user asked to leave
  return go(TerminateSessionStep);
}
```

Bare `go(TerminateSessionStep)` falls through to the framework's abrupt-end prompt. The
successful path attaches `DemoPrompt.FromAddressEnd` instead:

```text
Confirm that the address was accepted and the profile collection is complete. End the
conversation without asking another question or offering additional help.
```

Same destination class, same registration, different closing behaviour, and no branch
inside `TerminateSessionStep`.

## How it works

The full decision table for a tool handler's return value:

```text
stay("why")            -> go(currentStep).withToolFeedback("why")
                       -> cursor unchanged, model called again with the feedback

go(Next)               -> onExit(current), currentStep = Next, onEnter(Next),
                          onCrossing(msg, "Current"), model called for Next

go(Next).withState(s)  -> as above, then Next.saveState(s)

direct(content)        -> stays on the current step and returns content to the
                          caller with no further model call
```

`direct()` is not used in BasicFlow — HotelFlow and InvoiceFlow use it — but it is the
third member of the family and obeys the same scope rule as `stay()`.

## Why it is written this way

Making the transition a **return value** rather than a mutation has one large benefit:
the validation that produced the decision and the decision itself are in the same
function, three lines apart. You can read `dob()` top to bottom and know every way it
can end. There is no separate edge table to cross-reference and no possibility of a
transition firing from a place you did not expect.

Making `stay()` an alias for `go(current)` rather than a distinct concept keeps the
runner simple: there is one code path for applying a routing result, and "stay" is the
degenerate case where the target happens to be the current step. `flow.gotoByName`
short-circuits when the name matches, so `onExit`/`onEnter` do not fire spuriously.

## Common mistakes

- **Calling `stay()` outside a tool handler.** It throws. `onResponse()` cannot use it;
  return the step or a `go(...)` builder instead.
- **Expecting `.withState()` to write to the current step.** It writes to the
  destination. Use `this.saveState(...)` before returning for values the current step
  owns.
- **Writing `stay()` feedback as user-facing copy.** It goes to the model. Phrase it
  as an instruction, as BasicFlow does.
- **Overriding `getPrompt()` without `super.getPrompt()` on a `withPrompt` target.**
  The attached prompt is stored but never read.
- **Forgetting that a `go()` target must be registered.** `flow.goto` throws
  `Step 'X' is not defined in flow 'BasicFlow'.` mid-turn.

## Next

`AddressStep` delegated its rule to `ValidateAddress`.
[6. Validation belongs in code](/docs/tutorials/basic-flow/validation/) looks at that module
and at two validators the demo forgot to wire up.
