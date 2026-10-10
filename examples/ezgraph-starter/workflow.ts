import { END } from "@langchain/langgraph";
import { z } from "zod";
import {
  BaseGraph, LlmNode, Tool, ModelCatalog, TerminateSessionNode,
  GRAPH_END_NODE, createGraphStateAnnotation, go, stay, finish,
  type GraphDefinition, type LlmGateway, type NodeStateValue,
  type ToolDefinition, type ToolResponse,
} from "@picoflow/ezgraph";

type StarterNodes = {
  CityNode?: NodeStateValue<{ city?: string }>;
  SummaryNode?: NodeStateValue<{ plan?: string }>;
};
export const StarterState = createGraphStateAnnotation(
  "CityNode", () => ({} as StarterNodes),
);
export type StarterStateType = typeof StarterState.State;

export class CityNode extends LlmNode<StarterStateType, { city?: string }> {
  getPrompt() {
    return "Ask for a destination city, then call capture_city. To stop, call terminate_session.";
  }

  defineTool(): readonly ToolDefinition[] {
    return [{
      name: "capture_city",
      description: "Save a valid destination city.",
      schema: z.object({ city: z.string().min(2) }),
    }];
  }

  @Tool("capture_city")
  async captureCity({ city }: { city: string }): Promise<ToolResponse> {
    const value = city.trim();
    if (value.length < 2 || !/^[\p{L} .'-]+$/u.test(value)) {
      return stay("Ask for a city name using letters, rather than a number.");
    }
    this.saveState({ city: value });
    return go(SummaryNode);
  }
}

export class SummaryNode extends LlmNode<StarterStateType, { plan?: string }> {
  getPrompt(state: StarterStateType) {
    return `The saved city is ${state.nodes.CityNode?.city}. Call make_plan.`;
  }

  defineTool(): readonly ToolDefinition[] {
    return [{
      name: "make_plan",
      description: "Create the trip card for the saved city.",
      schema: z.object({}),
    }];
  }

  @Tool("make_plan")
  async makePlan(): Promise<ToolResponse> {
    const city = this.graph.graphState().nodes.CityNode?.city;
    if (!city) return stay("A valid destination must be saved first.");
    const plan = `Trip to ${city}: choose your dates, then book transport.`;
    this.saveState({ plan });
    return finish(plan);
  }
}

export class StarterGraph extends BaseGraph<StarterStateType> {
  static getGraphDefinition(): GraphDefinition {
    return {
      llmConfig: ModelCatalog.model("scripted:scripted-model", { retries: 0 }),
      endNode: GRAPH_END_NODE,
      historySpaces: [[CityNode, "intake"], [SummaryNode, "summary"]],
    };
  }

  constructor(gateway: LlmGateway) {
    super(gateway, StarterGraph.getGraphDefinition());
  }

  protected buildGraph() {
    const graph = this.createStateGraph(StarterState);
    graph.registerTurnNodes(CityNode, SummaryNode, TerminateSessionNode);
    graph.addEdge(TerminateSessionNode, END);
    return graph.compile();
  }
}
