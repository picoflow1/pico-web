---
title: 6. Validation belongs in code
eyebrow: BasicFlow tutorial
lede: Move the rule out of the prompt and out of the handler into a plain TypeScript module, then hand its verdict back to the model through stay().
source: pico-demo/src/myflow/basic-flow/validators/address-validator.ts, pico-demo/src/myflow/basic-flow/address-step.ts
---

The previous lesson put the decision in the tool handler. This one takes the next step:
get the rule out of the handler too. A validator that is a pure function of its input
can be unit tested, reused, and read by someone who knows nothing about PicoFlow.

## The goal

- Extract a domain rule into a module with no framework imports.
- Return structured data from the validator, not a boolean.
- Feed the failure reason back through `stay()`.
- Recognise validators that were written but never wired in.

## A validator with no framework dependencies

`pico-demo/src/myflow/basic-flow/validators/address-validator.ts` imports nothing at
all. Its whole public surface is one function:

```ts
type AddressType = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export function ValidateAddress(addressStr: string): AddressType | null {
  if (typeof addressStr !== "string" || !addressStr.trim()) {
    return null;
  }

  const addressRegex = /^(.*?),\s*(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;
  const relaxedAddressRegex =
    /^(.*?\b(?:st(?:reet)?|rd|road|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|ln|lane|ct|court|way|pl|place)\.?)\s+(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i;

  const match =
    addressStr.match(addressRegex) ?? addressStr.match(relaxedAddressRegex);

  if (!match) return null;

  const [, street, city, state, zip] = match;
  // ... per-component checks against usStates, street, city, and ZIP patterns
  return { street, city, state, zip };
}
```

Two design choices are worth naming.

**It returns parsed data, not `true`.** The caller gets `{ street, city, state, zip }`
or `null`. A boolean validator forces the caller to parse the string a second time, and
the two parses drift. Here, validation and parsing are the same pass.

**It accepts a second, looser shape.** The strict regex wants a comma after the street.
The relaxed one accepts `"123 K St. Portland, OR 97006"` by recognising a street suffix
instead. That is a deliberate concession to how people actually type addresses, and it
is exactly the sort of rule that becomes unreadable when expressed as prompt prose.
This is also the string the end-to-end scenario sends on its final turn.

## Wiring it into the step

`pico-demo/src/myflow/basic-flow/address-step.ts` does nothing but call it and translate
the result into a transition:

```ts
import { ValidateAddress } from "./validators/address-validator.js";

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

The handler is now five meaningful lines and contains no domain knowledge. Note that
what is persisted is the **parsed object**, not the user's raw text:

```json
{ "street": "123 K St.", "city": "Portland", "state": "OR", "zip": "97006" }
```

The end-to-end test asserts on those components individually, which it could not do if
the step had stored the original string.

## The tool schema stays deliberately dumb

```ts
schema: z.object({
  address: z
    .string()
    .describe("The user's complete address text, unchanged"),
}),
```

One string field, and the description tells the model not to reformat it. The step does
not ask the model to split the address into street, city, state, and ZIP, even though
it easily could. That is intentional: if the model does the splitting, the split is
unverifiable and varies between providers. Taking the raw text and parsing it in code
means the parse is deterministic and the test can assert on it.

The prompt reinforces the same boundary:

```text
As soon as all four parts are present, immediately call 'address' with the user's full
text. Do not ask for confirmation or reformatting before calling the tool.
```

## The two validators nobody wired in

<div class="callout callout--warning"><span class="callout__title">Honest note about the demo</span><p>The <code>validators/</code> directory contains three files. Only <code>address-validator.ts</code> is imported anywhere. <code>name-validator.ts</code> (exporting <code>ValidateName</code>) and <code>dob-validator.ts</code> (exporting <code>ValidateDOB</code>) are dead code: <code>NameStep</code> and <code>DOBStep</code> inline their rules in the handler instead.</p></div>

This is worth looking at rather than glossing over, because the two dead validators are
better than the code that replaced them.

`dob-validator.ts` enforces an age rule the flow does not currently have:

```ts
export function ValidateDOB(day: number, month: number, year: number): DOBType {
  const dob = moment({ year, month: month - 1, day });
  const currentDate = moment();
  const yearsDifference = currentDate.diff(dob, "years");

  if (yearsDifference >= 18) {
    return { day, month, year };
  } else {
    return { error: "applicant must be 18 years or older" };
  }
}
```

`name-validator.ts` splits a full name into first, middle, and last, and returns
`{ error }` when fewer than two parts are supplied — a real rule, where `NameStep`
currently only rejects the literal string `"john doe"`.

Both use the same discriminated-union shape, `T | { error: string }`, which is a
different convention from `ValidateAddress`'s `T | null`. That inconsistency is part of
why they were never adopted.

### A refactoring exercise

If you want to practise the pattern on real code, this is a good place to start:

1. Pick one convention. `T | { error: string }` carries the reason, which is what
   `stay()` wants, so it is the better of the two. Change `ValidateAddress` to match.
2. Rewrite `DOBStep.dob` to call `ValidateDOB` and pass `result.error` straight into
   `stay()`. The calendar round-trip currently inlined there belongs in the validator
   next to the age check.
3. Rewrite `NameStep.user_name` to call `ValidateName`, and save the parsed
   `{ firstName, middleName, lastName }` instead of the raw string — which is what
   `AddressStep` already does with the address.
4. Add a scenario turn for each new rejection path. Lesson 18 covers the format.

Steps 2 and 3 change what is persisted, so the end-to-end assertions in
`test/basic-flow/basic-flow.e2e-spec.ts` (`stepState(basicFlow, "NameStep").name`)
change with them.

## Why it is written this way

Three arguments for pushing the rule down into a module:

**Testability.** `ValidateAddress` can be tested with a table of strings and no
NestJS application, no session store, and no model. A rule embedded in a handler needs
a tool call to reach it; a rule embedded in a prompt cannot be tested at all.

**Auditability.** When someone asks which ZIP formats you accept, the answer is a
regex in one file, not an inference about how a model interpreted a sentence.

**Reuse.** The same validator serves the tool handler, a bulk import job, and a form
endpoint. A rule in a prompt is reusable only by copy-paste, and the copies diverge.

The counter-argument — that a good model can validate an address perfectly well — is
true and irrelevant. The problem is not accuracy, it is that the result is not
reproducible or reviewable, and the failure mode is a confidently wrong state write.

## Common mistakes

- **Returning a boolean.** You throw away the parse and the reason. Return the parsed
  value or an error object.
- **Losing the reason.** `stay("Invalid input")` tells the model nothing. Pass the
  validator's own message through so the assistant can explain the actual problem.
- **Persisting the raw input.** `AddressStep` stores the parsed components, which is
  what makes the test assertions meaningful. Storing the raw string defers the parse
  to every reader.
- **Writing a validator and forgetting to import it.** Two of the three in this
  directory are unreferenced. A lint rule for unused exports would have caught it.

## Next

The prompts quoted so far have been inline template literals.
[7. Prompt files and templates](/docs/tutorials/basic-flow/prompts/) moves them into files.
