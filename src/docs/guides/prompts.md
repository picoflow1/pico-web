---
title: Prompts and prompt files
eyebrow: Guides
lede: getPrompt() is called before every model invocation, including after each tool response. This is how to build one from state, load it from a file, and let a transition override it.
source: pico-demo/docs/step-authoring-contract.md
---

Every step supplies its own system prompt. There is no global prompt, no template engine, and
no prompt registry — just a method that returns a string. The interesting parts are when it is
called, how a transition can override it, and where prompt text stops being trustworthy.

## The getPrompt() contract

```ts
public getPrompt(): string | null
```

It is called immediately before **every** model invocation for that step. In a tool loop that
means once per model turn:

```text
getPrompt() -> model call -> tool call -> handler -> stay()
getPrompt() -> model call -> tool call -> handler -> go(Next)
Next.getPrompt() -> model call -> ...
```

Two consequences:

- the prompt can reflect state saved by the tool handler that just ran, which is how
  `PresentStep` re-injects the current hotel list after a search;
- it must be cheap. Do not call a network service from `getPrompt()`.

The returned string becomes the system message at index 0 of the step's memory namespace,
replacing whatever was there. Returning `null` yields an empty system message.

It may read this step's state, another step's state through the flow, session context, static
files, and the environment. `ExploreStep` reads its prompt file and the environment:

```ts
public getPrompt(): string {
  const hotelJson = JSON.parse(HotelJSON);
  const currentDate =
    process.env.HOTEL_FLOW_CURRENT_DATE ?? moment().utc().format();
  set(hotelJson, "currentDate", currentDate);

  return Prompt.replace(ExplorePrompt, {
    HOTEL_JSON: JSON.stringify(hotelJson),
  });
}
```

## withPrompt() and the `_prompt` key

A transition can supply the destination's prompt:

```ts
return go(TerminateSessionStep).withPrompt(DemoPrompt.AbruptEnd);
```

PicoFlow saves that text as `_prompt` in the destination step's state. The **base**
`getPrompt()` returns it:

```ts
public getPrompt(): string | null {
  const p = this.getState("_prompt");
  return p ? p.toString() : null;
}
```

A subclass that overrides `getPrompt()` therefore hides it — unless it checks the base value
first. That is what the `??` idiom is for:

```ts
public getPrompt(): string {
  return super.getPrompt() ?? "The normal prompt for this step.";
}
```

`TerminateSessionStep` uses exactly this pattern, which is why `withPrompt(...)` on a
transition into it changes the closing message.

<div class="callout callout--warning"><span class="callout__title">_prompt is durable state</span><p><code>_prompt</code> is written with <code>saveState()</code>, so it is persisted in the session document and survives later turns. A step that keeps <code>super.getPrompt() ?? fallback</code> will keep returning the prompt from an old transition until another transition overwrites it. Call <code>removeState("_prompt")</code> when a one-shot prompt should not persist.</p></div>

Use `withPrompt(...)` when the *caller* knows something about how the destination should
behave — "confirm the booking with this confirmation number", "explain that the user asked to
exit". Use a normal `getPrompt()` when the destination's behaviour is intrinsic.

## Prompt.file and prompt assets

`Prompt.file(relativePath)` reads a file synchronously, resolving the path relative to **the
directory of the module that called it**, and caches the contents by absolute path for the
lifetime of the process.

```ts
const PROMPT = Prompt.file("prompt/favorites.md");
const SCHEMA = Prompt.file("prompt/favorites.json");
```

Call it at module scope, not inside `getPrompt()`. The cache makes repeated calls cheap, but
module scope makes the dependency obvious and fails fast at import time if the file is
missing.

Because the path is resolved against the calling module, the files must be shipped next to
the compiled JavaScript. The demo does this with a `postbuild` step:

```json
"postbuild": "copyfiles -u 1 'src/**/*.{json,md,png,pdf}' dist/"
```

A missing prompt file surfaces as an `ENOENT` at import time, which is much easier to debug
than a silently empty prompt.

## Templates: replace, replace2 and set

Prompt files use a double-brace placeholder syntax.

{% raw %}
```text
Today is {{CurrentDate}}.

Available hotels:
{{HOTEL_JSON}}
```
{% endraw %}

Three helpers fill them in:

| Helper | Behaviour |
| --- | --- |
| `Prompt.replace(template, values)` | Replaces every {% raw %}`{{key}}`{% endraw %}; a key with no value keeps the placeholder |
| `Prompt.replace2(template, values)` | Trims whitespace inside the braces and `JSON.stringify`s non-string values |
| `Prompt.set(prompt, key, value)` | Replaces only the first occurrence of one placeholder |

{% raw %}
```ts
const template = `
  Ask the user to provide the date of birth for {{UserName}}.
`;
const name = this.flow.getStepState<string>(NameStep, "name");
const prompt = Prompt.replace(template, { UserName: name });
```
{% endraw %}

`replace2` is the one to reach for when values are objects or when the template has spaces
inside the braces:

{% raw %}
```ts
const prompt = Prompt.replace2(PromptTemplate, {
  internal_address: {
    street: "123 Main St",
    city: "Beaverton",
    state: "OR",
    zip: randomZip(),
  },
});
```
{% endraw %}

<div class="callout callout--note"><span class="callout__title">Falsy values are skipped by replace()</span><p><code>Prompt.replace</code> substitutes with <code>values[key] || match</code>. An empty string, <code>0</code> or <code>false</code> therefore leaves the raw placeholder visible in the prompt. Use <code>replace2</code>, which only skips <code>undefined</code>, or normalise the value before substituting.</p></div>

## Composing a prompt from parts

The demo flows compose a role file, a task partial, and the framework's shared
end-of-conversation instructions at module scope:

```ts
const ExplorePartial = Prompt.file("prompt/explore.md");
const ExplorePrompt = `
  ${HotelPrompt.Role}
  ${ExplorePartial}
  ${FlowPrompt.EndChat}
  `;
```

`FlowPrompt.EndChat` is PicoFlow's built-in text describing how and when to call
`terminate_session`. Including it is what makes "I'm done" work consistently across steps.

Keep the split along these lines:

- **role file** — identity and tone, shared by every step in the flow;
- **task partial** — what this stage must accomplish, and which tool to call when;
- **example or schema file** — a JSON example is often clearer than prose;
- **runtime values** — injected through `Prompt.replace`, never hard-coded.

## Prompt text is not a security boundary

This is the rule that matters most.

A prompt is a request to a probabilistic system. It can be misread, ignored, or overridden by
user text that ends up in the same context window. So:

- validation belongs in the tool handler, not in the prompt — `AddressStep` tells the model
  to send the raw text and lets `ValidateAddress` decide;
- authorisation belongs in your application code, before the side effect;
- limits belong in the Zod schema and then again in the handler;
- secrets do not belong in prompt files at all — they ship as plain assets in `dist/`;
- anything a user typed that you interpolate into a prompt is untrusted input.

Write prompts that describe *conversational behaviour*: what to ask, when to call a tool, how
to explain a rejection. Let deterministic code own the decision.

## Failure modes

| Symptom | Cause |
| --- | --- |
| Placeholder text visible to the user | Key missing from the values object, or a falsy value with `Prompt.replace` |
| `ENOENT` at startup | `Prompt.file` path is wrong, or assets were not copied into `dist/` |
| A stale prompt reappears on a later turn | `_prompt` is durable state; clear it with `removeState("_prompt")` |
| `withPrompt(...)` has no effect | The destination overrides `getPrompt()` without calling `super.getPrompt()` |
| The model ignores an instruction | The instruction is doing work that belongs in a handler or schema |
| Prompt changes never take effect | `Prompt.file` caches by absolute path for the process lifetime; restart |

Related: [Prompt files and templates](/docs/tutorials/basic-flow/prompts/),
[Big prompts as spec files](/docs/tutorials/hotel-flow/prompt-files/), and
[Authoring a step](/docs/guides/authoring-a-step/).
