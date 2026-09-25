---
layout: layouts/ezgraph.njk
title: 6. Catalog lookup and disambiguation
description: Resolve a vehicle against a catalog before capturing how it is used, disambiguate trims without guessing, and make the second tool refuse anything the first did not resolve.
permalink: /ezgraph/docs/tutorials/quote-graph/vehicle-catalog/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 6. Catalog lookup and disambiguation

A car insurance quote is only as good as its vehicle. "A 2019 Camry" is not a rating input; a
specific catalog record with a risk group and a price is. `VehicleNode` makes that distinction
explicit with two tools. One finds the exact vehicle; the other records how it is used, and it
refuses to run until the first has succeeded.

## The goal

- Look up a record before capturing facts that depend on it.
- Return several candidates to the model instead of choosing one.
- Keep a lookup result in node state between turns.
- Make a second tool check that the first one really ran.

## The catalog

`backend/vehicle-catalog.ts` loads `data/vehicles.json` once and imports nothing from EZGraph:

```ts
export type CatalogVehicle = {
  id: string;          // e.g. "2019-toyota-camry-se"
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  riskGroup: number;   // 1 (lowest premium impact) to 5 (highest)
  msrp: number;
};

export class VehicleCatalog {
  static search(criteria: { year: number; make: string; model: string; trim?: string }): CatalogVehicle[];
  static fetch(id: string): CatalogVehicle | undefined;
  static yearsFor(make: string, model: string): number[];
  static summarize(): string;
}
```

`search()` compares make, model, and trim after trimming and lower-casing, so "toyota camry" and
"Toyota Camry" match. The demo catalog has twelve vehicles. The 2019 Toyota Camry appears three
times, as the LE, SE, and XSE trims, which is what produces the replay's disambiguation turn.

## Two tools, in order

```ts
{
  name: "resolve_vehicle",
  description: "Look the vehicle up in the ratable-vehicle catalog by year, make, and model.",
  schema: z.object({
    year: z.number().int().min(1990).max(2035),
    make: z.string().min(1),
    model: z.string().min(1),
    trim: z.string().min(1).optional(),
  }),
},
{
  name: "capture_vehicle_use",
  description: "Capture ownership, mileage, and parking for the resolved vehicle.",
  schema: z.object({
    vehicleId: z.string().min(1),
    ownership: z.enum(["own", "finance", "lease"]),
    annualMileage: z.number().int().min(1000).max(60000),
    parking: z.enum(["garage", "driveway", "street"]),
  }),
},
```

`vehicle.md` gives the order: ask for year, make, and model; call `resolve_vehicle` as soon as
all three are known, including `trim` only if the customer volunteered it; then collect
ownership, mileage, and parking; then call `capture_vehicle_use` with the resolved ID.

## Resolving: every outcome is a stay()

```ts
@Tool("resolve_vehicle")
async resolveVehicle(input: ResolveVehicleInput): Promise<ToolResponse> {
  const matches = VehicleCatalog.search(input);
  if (matches.length === 0) {
    const years = VehicleCatalog.yearsFor(input.make, input.model);
    if (years.length > 0) {
      return reject(
        `No ${input.year} ${input.make} ${input.model} is in the catalog; supported years for that model: ${years.join(", ")}.`,
      );
    }
    return reject(`That vehicle cannot be rated. Supported vehicles: ${VehicleCatalog.summarize()}.`);
  }
  if (matches.length > 1) {
    return stay(JSON.stringify({
      accepted: false,
      needsTrim: true,
      candidates: matches.map((candidate) => ({ vehicleId: candidate.id, trim: candidate.trim })),
      error: "Several trims match; ask the customer which one.",
    }));
  }
  const vehicle = matches[0]!;
  this.saveState({ resolvedVehicleId: vehicle.id });
  return stay(JSON.stringify({ accepted: true, vehicle }));
}
```

| Outcome | State | What the model gets |
| --- | --- | --- |
| no match, but the model exists in other years | unchanged | the supported years |
| no match at all | unchanged | the list of every supported vehicle |
| several trims | unchanged | `needsTrim: true` and the candidate IDs and trims |
| exactly one | `resolvedVehicleId` saved | `accepted: true` and the full record |

Resolving never leaves the node. Even success returns `stay()`, because the stage is not finished:
the model still has to ask how the car is used. The tool result is written for the model's next
step. An unsupported vehicle comes back with the alternatives, so the model can offer them, as
`vehicle.md` step 3 instructs.

The trim case is the important one. The handler could pick the cheapest or the first trim and move
on, and most customers would never notice. Instead it returns the candidates and saves nothing,
and the model asks. In the replay that is turn 4, "Which one is yours: LE, SE, or XSE?", and turn 5
resolves the SE.

## Capturing use: prove the lookup happened

```ts
@Tool("capture_vehicle_use")
async captureVehicleUse(input: CaptureVehicleUseInput): Promise<ToolResponse> {
  const local = this.getState() as QuoteGraphNodeState<"VehicleNode">;
  if (input.vehicleId !== local.resolvedVehicleId) {
    return reject("Resolve the vehicle with resolve_vehicle before capturing its use.");
  }
  const vehicle = {
    vehicleId: input.vehicleId,
    ownership: input.ownership,
    annualMileage: input.annualMileage,
    parking: input.parking,
  };
  this.saveState({ resolvedVehicleId: vehicle.vehicleId, vehicle });
  return go(HistoryNode).withMessage(new HumanMessage("Collect the driving and insurance history."));
}
```

The model supplies a `vehicleId`, but the handler accepts only the one `resolve_vehicle` saved. A
plausible ID the model made up, or a trim the customer mentioned but never confirmed, is refused.
Because `resolvedVehicleId` is in node state, the check works across turns: in the replay, the
vehicle was resolved on turn 5 and its use captured on turn 7.

## The prompt knows what has been resolved

`VehicleNode.getPrompt()` fills `{{RESOLVED_VEHICLE}}` with the resolved catalog record, or `null`:

```ts
const local = this.state(state) as QuoteGraphNodeState<"VehicleNode">;
const resolved = local.resolvedVehicleId ? VehicleCatalog.fetch(local.resolvedVehicleId) : undefined;
```

On a later turn, the model can see that the vehicle is already settled, and ask only about use.
The same method adds the one-time acknowledgement of the saved driver described in
[lesson 4](/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/).

## Why it is written this way

The graph separates "which thing is this?" from "what does the customer tell us about it?". The
first is a lookup with a deterministic answer or a set of candidates. The second is conversation.
Tying the second tool to the first tool's saved result means a rating input can only ever be a
catalog record the application resolved, never a vehicle the model described convincingly.

## Common mistakes

- **Picking one of several matches silently.** Return the candidates and let the customer choose.
- **Ending the stage on a successful lookup.** Return `stay()` when there is more to collect.
- **Trusting an ID the model supplies.** Compare it with the ID your lookup saved.
- **Keeping lookup results only in the conversation.** Save them in node state so later turns and
  tools can check them.
- **Unhelpful "not found" results.** Return what *is* supported, so the model can offer it.

## Next

Continue to [7. Time, sessions, and history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/).
