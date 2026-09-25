---
layout: layouts/ezgraph.njk
title: 3. Validated collection and catalog lookup
description: Use model-facing schemas while keeping age, licence, and catalog rules in application code.
permalink: /ezgraph/docs/tutorials/quote-graph/validated-tools/
ezgraph: true
ezgraphDocument: true
---

# 3. Validated collection and catalog lookup

## The goal

Let the model collect customer language, but accept only facts the application has checked.

## A schema is the tool interface, not the policy

`DriverNode` exposes `capture_driver` with a Zod object schema. Its handler then uppercases and
checks the state code, rejects a suspended licence, parses a real calendar date, calculates age,
and checks that years licensed are plausible before saving anything.

```ts
this.saveState({ driver });
return go(VehicleNode);
```

On a failed rule it returns `stay(JSON.stringify({ accepted: false, error }))`. The model gets
precise corrective feedback while the durable cursor remains in `DriverNode`.

## Resolve before you capture use

`VehicleNode` deliberately uses two tools. `resolve_vehicle` searches the ratable catalog by
year, make, model, and optional trim. It saves only `resolvedVehicleId` and stays in the node.
`capture_vehicle_use` then refuses an ID other than that resolved catalog record before it saves
ownership, mileage, and parking.

This avoids a plausible-sounding vehicle becoming a rating input merely because a model emitted
its name. When the catalog has several trims, the tool returns the candidates and asks the
customer to choose; it never picks one silently.

## Why it is written this way

The model can decide when enough information is present to call a tool. It does not decide
whether a licence, date, catalog record, or vehicle/ownership combination is acceptable. Those
are business decisions that must be reproducible in a unit test.

## Next

Continue to [4. Session lifetime and history spaces](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/).
