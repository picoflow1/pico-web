import "reflect-metadata";
import { createTurnHarness, scriptedGateway } from "@picoflow/ezgraph/testing";
import { StarterGraph, type StarterStateType } from "./workflow.js";

// Script the model's responses; the real graph, tools and session engine run.
const gateway = scriptedGateway()
  .text("Which city would you like to visit?")
  .callsTool("capture_city", { city: "Lisbon" })
  .callsTool("make_plan");
const harness = createTurnHarness<StarterStateType>({
  graph: StarterGraph, gateway, sessionId: "first-workflow",
});

try {
  console.log("You: Hi");
  console.log("EZGraph:", (await harness.send("Hi")).response);
  console.log("You: Lisbon");
  const result = await harness.send("Lisbon");
  console.log("EZGraph:", result.response);
  console.log("Completed:", result.completed);
  console.log("\nSession document:");
  console.log(JSON.stringify(result.document, null, 2));
} finally {
  await harness.close();
}
