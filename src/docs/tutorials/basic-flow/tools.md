---
title: 4. Tools and Zod
eyebrow: BasicFlow tutorial
lede: A tool is a Zod schema the model may call and a decorated method that decides what happens next. The schema shapes the arguments; the handler owns the decision.
source: pico-demo/src/myflow/basic-flow/name-step.ts, pico-demo/src/myflow/basic-flow/dob-step.ts, pico-demo/src/myflow/basic-flow/prompt/role.md
---

Prompt text is a request. A tool call is a typed function invocation with a validated
argument object. The difference matters because only one of the two can be relied on.
BasicFlow's collection steps are built on the second, and their prompts exist mainly to
tell the model to stop reasoning about the rule and call the tool.

## What you will build

- A tool definition with `defineTool()` returning `ToolType[]`.
- A Zod object schema with `.describe()` on every field.
- A handler bound to the tool with the `@Tool` decorator.
- A clear split between what the prompt says and what the code enforces.

## Defining a tool

From `pico-demo/src/myflow/basic-flow/name-step.ts`:

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "user_name",
      description: "Capture name of user",
      schema: z.object({
        name: z.string().min(3).describe("Complete first and last name"),
      }),
    },
  ];
}
```

`ToolType` is exactly three fields:

```ts
export type ToolType = {
  name: string;
  description: string;
  schema: z.ZodObject;
};
```

The schema must be a Zod **object**, not a bare scalar — providers expect a named
argument bag. `defineTool()` is called once per request during `composeTool()`, and
every step's definitions are merged into one flow-wide registry keyed by name.
Duplicate names throw at bootstrap.

`DOBStep` shows a richer schema:

```ts
public defineTool(): ToolType[] {
  return [
    {
      name: "dob",
      description:
        "Capture a valid date of birth after interpreting numeric slash dates as month/day/year.",
      schema: z.object({
        year: z.number().int().min(1900).max(2100).describe("Four-digit year"),
        month: z.number().int().min(1).max(12).describe("Calendar month, 1 through 12"),
        day: z.number().int().min(1).max(31).describe("Calendar day, 1 through 31"),
      }),
    },
  ];
}
```

### Why .describe() on every field

The Zod schema is serialised into the provider's function-calling payload, and
`.describe()` becomes the field description the model reads. It is not documentation
for your team — it is part of the prompt. `"Four-digit year"` and
`"Calendar month, 1 through 12"` are there to stop the model sending `"2000-01-01"` as
a year or a zero-based month.

The same reasoning applies to `description` on the tool itself.
`"Capture a valid date of birth after interpreting numeric slash dates as
month/day/year"` tells the model when to call it and how to interpret ambiguous input.
A description of `"dob tool"` would push that decision back into the prose prompt,
where it is weaker.

Note what the schema does *not* do. `min(1900).max(2100)` on the year and
`min(1).max(31)` on the day are shape constraints; they will happily accept 31
February. The real calendar check lives in the handler.

## Handling the call

```ts
@Tool
protected async user_name(
  args: Record<string, any>,
): Promise<ToolResponseType> {
  const name = typeof args?.name === "string" ? args.name.trim() : "";

  if (name.toLowerCase() === "john doe") {
    return stay("Cannot accept John Doe, please choose a different name.");
  } else {
    this.saveState({ name });
    // ... nested work, covered in lesson 12
    return go(DOBStep);
  }
}
```

`@Tool` with no argument binds the handler to the tool whose name matches the method
name. `@Tool("external_name")` binds to a different name when the method cannot share
it.

The decorator does two jobs, and this is the part worth remembering:

1. **Selection.** It exposes that registered tool to this step's model call.
   `getUsedToolNames()` unions `useTool()` with every decorated tool name, and
   `obtainTools()` resolves each through the flow registry. A tool defined by one step
   is only offered to the model by the steps that decorate a handler for it.
2. **Dispatch.** It registers the runtime handler, so `invokeToolHandler(call)` can
   find it.

That is why `WeatherStep`, `NameStep`, `DOBStep`, and `AddressStep` all have a
`terminate_session` handler but none of them defines the tool. The definition comes
from the framework's `TerminateSessionStep`; the decorator is what puts it on their
model's menu.

```ts
@Tool
protected async terminate_session(): Promise<ToolResponseType> {
  return go(TerminateSessionStep).withPrompt(DemoPrompt.AbruptEnd);
}
```

Handlers are looked up on the prototype chain, so decorated handlers are inherited and
a subclass can override one.

## The handler owns the decision

Look at what `DOBStep` does after the schema has already passed:

```ts
@Tool
protected async dob(args: Record<string, any>): Promise<ToolResponseType> {
  const date = new Date(Date.UTC(args.year, args.month - 1, args.day));
  const isValidDate =
    date.getUTCFullYear() === args.year &&
    date.getUTCMonth() === args.month - 1 &&
    date.getUTCDate() === args.day;
  if (!isValidDate) {
    return stay(
      "That date is not valid. Ask for a valid date of birth in M/D/YYYY format.",
    );
  }

  this.saveState({ year: args?.year, month: args?.month, day: args?.day });
  return go(AddressStep);
}
```

The round-trip through `Date.UTC` catches 31 February, which no Zod range can. The
handler then either advances or hands corrective text back to the model. The model is
never asked to decide whether the date is real.

`NameStep`'s prompt makes the division of labour explicit:

```text
Treat any plausible first-and-last-name response as collected input and immediately
call 'user_name' with the complete name. Do not validate or reject a name in prose
before calling the tool; the tool owns validation.
If 'user_name' rejects the name, clearly repeat the tool's reason and ask for a
different full name. Remain in this step.
```

And the shared role file, `prompt/role.md`, closes the loop:

```text
- Never invent a successful tool result. Let the tool handler validate the user's
  input and follow its response.
```

## Why it is written this way

Two properties fall out of putting the decision in the handler.

**It is testable without a model.** The scripted-model contract run in
`test/basic-flow/` replaces the provider entirely and still exercises every branch of
`user_name` and `dob`, because those branches are ordinary TypeScript reachable from a
tool call payload.

**It cannot be talked around.** A rule in prompt prose is advisory: a sufficiently
insistent user, or a model having a bad day, will route around it. A rule in the
handler is the only path to the state write. `stay("Cannot accept John Doe...")` is not
a suggestion to the model about what to say — it is the tool result, and the step did
not advance.

The prompt still matters, but its job is narrower than people expect. It tells the
model *when* to call the tool and how to phrase a rejection, not whether the input is
acceptable.

## Common mistakes

- **Putting the business rule in the prompt and a rubber-stamp in the handler.** The
  handler is the runtime boundary. If a rule is not enforced there, it is not enforced.
- **Omitting `.describe()`.** The model sees the field name and type only, and
  argument quality drops immediately for anything ambiguous like `month` or `city`.
- **Defining a tool twice.** Definitions are flow-wide. Two steps defining `address`
  fail at bootstrap with `Duplicate tool 'address' registered in flow 'BasicFlow'.`
- **Expecting a handler to run for a tool it did not decorate.** A step only offers
  the tools it decorates or lists in `useTool()`. Defining a tool in `defineTool()`
  registers it flow-wide but does not put it on that step's menu.
- **Trusting Zod for domain validity.** `min(1).max(31)` accepts 31 February. Range
  constraints shape the payload; they do not check the domain.

## Next

Both handlers above end in `stay()` or `go()`.
[5. Routing with go() and stay()](/docs/tutorials/basic-flow/routing/) explains what those
actually do.
