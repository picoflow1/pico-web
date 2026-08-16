---
title: 3. Example-as-schema prompting
eyebrow: InvoiceFlow tutorial
lede: The extraction prompt pins a fifty-field nested payload by showing one complete example rather than declaring a schema. That is an effective technique with a specific failure mode, and it is worth knowing both.
source: picoflow-demo/src/myflow/invoice-flow/prompt/invoice-prompt.ts, picoflow-demo/src/myflow/invoice-flow/prompt/invoice.md, picoflow-demo/src/myflow/invoice-flow/prompt/invoice-example.json
---

An invoice has a vendor, a bill number, two addresses, nested banking details
for both wire and ACH, a line-item array with nine fields per row, and a dozen
monetary totals. Writing that as a Zod schema is a hundred lines. InvoiceFlow
takes the other route: it shows the model one filled-in example and says
"produce this shape".

## The goal

- Compose a persona, a workflow, and an example payload into one prompt.
- Understand why a complete example constrains shape more effectively than
  prose for deeply nested output.
- See precisely what this technique does not guarantee.
- Know when to replace it with a real tool schema plus code validation.

## Composing the prompt

`picoflow-demo/src/myflow/invoice-flow/prompt/invoice-prompt.ts`:

```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class InvoicePrompt {
  public static AbruptEnd = `
   Nicely tell the user this is the end of conversation as they requested, you MUST NOT talk other things!
  `.trim();

  public static FromAddressEnd = `
  Tell the user you have collected the address and end the conversation.
 `.trim();

  private static InvoiceExample = readFileSync(
    path.join(__dirname, 'invoice-example.json'),
    'utf-8',
  );

  private static Invoice = readFileSync(
    path.join(__dirname, 'invoice.md'),
    'utf-8',
  );

  public static ExtractInvoicePrompt = `
  ${this.Invoice}
  ## Data Extraction JSON Example
  ${this.InvoiceExample}
  `;
}
```

Two files are read at class-initialisation time and concatenated under a
heading that the workflow section refers to by name. The example is not
described; it is pasted in whole.

This module reads its files with `readFileSync` and an explicit `__dirname`
rather than with `Prompt.file()`. Both work. The difference is that
`Prompt.file()` caches by absolute path across the process, which matters when
several modules load the same partial — HotelFlow's shared `role.md` is the
case that benefits. Here each file has exactly one reader.

## The workflow half

`prompt/invoice.md` is short, because the shape is carried by the example:

```text
## Persona
You are an automated data extraction engine. Your sole purpose is to analyze invoice
files, extract specific data points according to a predefined schema, and output that
data using the provided `capture_json` tool. You are an expert in both printed text
and handwriting recognition.

## Available Tools
- `fetch_file(name: string)`: Fetches the content of a file.
- `capture_json(json: object)`: Takes a JSON object and submits it as the final output
  for the extraction task.

## Core Workflow
  - **Fetch File:** immediately call `fetch_file` tool with set property `name` to {% raw %}{{FileName}}{% endraw %}.
  - **Analyze & Extract:** Once you have the file content, silently analyze it. Extract
    all data points using the section `Data Extraction JSON Example` as example for all
    needed to be collected. Adhere strictly to the formatting rules.
  - **Generate & Submit JSON:** After extracting all data, construct a single JSON
    object the same format as in `Data Extraction JSON Example`. Your must call the tool
    `capture_json` with this completed JSON object set to `json` property, DO NOT send
    the JSON as a response to a user. If you find input file is missing , report so, do
    not make up any values.
```

Four things are being pinned here, and only one of them is the data shape:

1. **The tool order.** `fetch_file` first, always, and immediately.
2. **The output channel.** Call `capture_json`; do not print the JSON as chat.
3. **The shape.** By reference to the example section.
4. **The failure mode.** Report a missing file rather than inventing values.

Point 4 is the one most extraction prompts forget. A model that cannot read the
document will produce a plausible invoice if you do not tell it not to.

## The example payload

`prompt/invoice-example.json`, abbreviated:

```json
{
  "vendor_name": "ACME Inc",
  "vendor_id": "bdfe173e-9d5e-4f2a-a2fb-273954d21444",
  "bill_number": "INV-2025-019",
  "bill_date": "2025-06-03",
  "due_date": "2025-06-16",
  "po_number": "24-WGM-035",
  "payment_terms": "40% Deposit, 60% Before Dispatch",
  "banking_info": {
    "banking_institution": "Bank of America",
    "wire": {
      "banking_account": "87654321098",
      "banking_routing": "026009593",
      "swift": "BOFAUS3N"
    },
    "ach": {
      "banking_account": "87654321099",
      "banking_routing": "026009597",
      "swift": "BOFAUS3N"
    }
  },
  "currency": "USD",
  "bill_to_address": {
    "company_name": "Marriott",
    "address_line_1": "10400 Fernwood Road",
    "address_line_2": "Suite 400",
    "city": "Bethesda",
    "state": "Maryland",
    "zip": 20817
  },
  "invoice_items": [
    {
      "spec_tag": "FCH-003B.F4",
      "description": "Upholstery for lounge chair CH-003B",
      "quantity": 30,
      "overage": 1.3,
      "units": "YD",
      "unit_price": 9.50,
      "discount": 0.00,
      "extended_price": 285.00,
      "fob": "South Carolina"
    }
  ],
  "subtotal": 5295.00,
  "packing_fee": 1523.25,
  "freight": 0.00,
  "sales_tax": 483.45,
  "sales_tax_rate": 0.00675,
  "total": 7301.70,
  "prepayment": 2000.00,
  "balance_due": 5301.70
}
```

Every field carries information beyond its name:

- `bill_date` and `due_date` demonstrate ISO `YYYY-MM-DD`, not a locale format.
- `zip` is a number, `banking_account` is a string. The example settles both.
- `unit_price` and `extended_price` are plain numbers, not `"$9.50"`.
- `sales_tax_rate` is a fraction, not a percentage.
- `banking_info` shows that wire and ACH are separate objects with identical
  inner shapes.
- `invoice_items` shows the row shape and, by being an array, that there can be
  more than one.

Writing all of that as prose would take a page and still be ambiguous. The
example is unambiguous by construction, and it is checked by the second fixture
in the repository: `data/evergreen.json` is the expected extraction of
`data/Evergreen.png` and has exactly the same keys.

<div class="callout callout--tip"><span class="callout__title">Keep the example and fixture aligned</span><p>The example and the Evergreen fixture use the canonical key <code>banking_institution</code>. Keep both files aligned when changing the extraction shape so the prompt example and fixture describe the same contract.</p></div>

## What this does not give you

The tool that receives the result declares nothing:

```ts
{
  name: "capture_json",
  description: "Capture json structure",
  schema: z.object({
    json: z.object({}).describe("The json structure captured"),
  }),
}
```

`z.object({})` accepts any object. An extraction that omits `balance_due`,
returns `total` as `"7,301.70"`, or drops half the line items passes validation
and is written to state and returned to the caller as a 200.

So the technique gives you a strong prior and no guarantee. The end-to-end spec
compensates by asserting the contract itself:

```ts
function expectInvoiceContract(invoice: InvoiceDocument): void {
  assert.equal(invoice.vendor_name, expectedInvoice.vendor_name);
  assert.equal(invoice.bill_number, expectedInvoice.bill_number);
  assert.equal(invoice.currency, expectedInvoice.currency);
  assert.equal(invoice.total, expectedInvoice.total);
  assert.equal(invoice.balance_due, expectedInvoice.balance_due);
  assert.ok(Array.isArray(invoice.invoice_items));
  assert.equal(
    invoice.invoice_items.length,
    expectedInvoice.invoice_items.length,
  );
}
```

Assertions in a test are not the same as a runtime guarantee, but they do catch
drift when a model version changes.

## When to use a real schema instead

Replace the empty schema with a declared one as soon as any of these are true:

| Condition | Why |
| --- | --- |
| A downstream system consumes the output | A missing key becomes someone else's runtime error |
| Numbers are used in arithmetic | `"7,301.70"` and `7301.70` are not interchangeable |
| The result is stored as a typed record | Writes will fail long after the extraction succeeded |
| A field is legally or financially load-bearing | `balance_due` deserves a check, not a hope |

The upgrade path is mechanical:

```ts
const InvoiceItem = z.object({
  spec_tag: z.string(),
  description: z.string(),
  quantity: z.number(),
  units: z.string(),
  unit_price: z.number(),
  extended_price: z.number(),
});

const InvoiceSchema = z.object({
  vendor_name: z.string(),
  bill_number: z.string(),
  currency: z.string().length(3),
  invoice_items: z.array(InvoiceItem).min(1),
  subtotal: z.number(),
  total: z.number(),
  balance_due: z.number(),
});

// then, in defineTool():
schema: z.object({ json: InvoiceSchema })
```

Keep the example in the prompt even after you add the schema. They do different
jobs: the schema rejects bad output, and the example tells the model what good
output looks like — including conventions a schema cannot express, such as
"dates are ISO" or "rates are fractions".

And keep the arithmetic checks in the handler. No schema will tell you that
`subtotal + packing_fee + freight + sales_tax` does not equal `total`; that
check is three lines of TypeScript and catches a whole class of misreads.

## Why it is written this way

Example-as-schema is the cheapest way to get a wide, deeply nested extraction
working, and it degrades gracefully — a model that misses a field usually still
produces the right shape for everything else. It is a reasonable starting point
for a demo, and a reasonable *first* iteration in production, provided the
second iteration adds the schema.

What makes it defensible here is that the example is a file, not a string in a
prompt. It can be linted, diffed, validated against real extractions, and
reused as a test fixture — which is exactly what `invoice-example.json` is used
for.

## Common mistakes

- **Shipping `z.object({})` to production.** It validates that an object
  arrived. Nothing else.
- **Describing the shape in prose instead of showing it.** Prose leaves date
  formats, string-versus-number, and nesting ambiguous.
- **Omitting the failure instruction.** Without "do not make up any values", a
  model that cannot read the file will invent one.
- **Letting the example and the fixtures drift.** They are the same contract in
  two places; change them together.
- **Dropping the example once a schema exists.** The schema rejects; the
  example teaches.

## Next

[4. Multimodal file uploads](/docs/tutorials/invoice-flow/multimodal-files/) follows
`fetch_file` through the provider upload and back into the same step.
