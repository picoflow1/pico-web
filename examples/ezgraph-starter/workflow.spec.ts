import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnHarness, scriptedGateway } from "@picoflow/ezgraph/testing";
import { StarterGraph, type StarterStateType } from "./workflow.js";

test("continues a second turn, saves both node channels, and completes", async () => {
  const gateway = scriptedGateway().text("Which city?")
    .callsTool("capture_city", { city: "Lisbon" }).callsTool("make_plan");
  const harness = createTurnHarness<StarterStateType>({ graph: StarterGraph, gateway });
  try {
    const first = await harness.send("Hi");
    assert.equal(first.currentNode, "CityNode");
    assert.equal(first.completed, false);
    const second = await harness.send("Lisbon");
    assert.equal(second.status, 200);
    assert.equal(second.completed, true);
    assert.equal(second.response, "Trip to Lisbon: choose your dates, then book transport.");
    assert.equal(second.document?.graph.nodes?.CityNode?.city, "Lisbon");
    assert.equal(second.document?.graph.nodes?.SummaryNode?.plan, second.response);
    assert.equal(second.document?.status, "completed");
    assert.ok(second.document?.graph.histories.intake);
    assert.ok(second.document?.graph.histories.summary);
    assert.equal(gateway.drained, true);
  } finally { await harness.close(); }
});

test("repairs invalid schema arguments and a rejected city before advancing", async () => {
  const gateway = scriptedGateway()
    .callsTool("capture_city", { city: 42 })
    .callsTool("capture_city", { city: "42" })
    .callsTool("capture_city", { city: "Portland" })
    .callsTool("make_plan");
  const harness = createTurnHarness<StarterStateType>({ graph: StarterGraph, gateway });
  try {
    const result = await harness.send("42, then Portland");
    assert.equal(result.status, 200);
    assert.equal(result.completed, true);
    assert.equal(result.state?.nodes.CityNode?.city, "Portland");
    assert.ok(result.warnings.length > 0);
    assert.equal(gateway.calls.length, 4);
    assert.equal(gateway.drained, true);
  } finally { await harness.close(); }
});

test("offers each stage its own application tool", async () => {
  const gateway = scriptedGateway()
    .callsTool("capture_city", { city: "Lisbon" }).callsTool("make_plan");
  const harness = createTurnHarness({ graph: StarterGraph, gateway });
  try {
    await harness.send("Lisbon");
    assert.ok(gateway.calls[0]?.tools.includes("capture_city"));
    assert.ok(!gateway.calls[0]?.tools.includes("make_plan"));
    assert.ok(gateway.calls[1]?.tools.includes("make_plan"));
    assert.ok(!gateway.calls[1]?.tools.includes("capture_city"));
  } finally { await harness.close(); }
});
