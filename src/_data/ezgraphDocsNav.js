const guide = "/ezgraph/docs/developer-guide/";

export default [
  {
    label: "Start here",
    items: [
      { title: "Build your first EZGraph", url: "/ezgraph/tutorial/" },
    ],
  },
  {
    label: "Tutorials",
    tracks: [
      {
        title: "QuoteGraph",
        items: [
          { title: "Track overview", url: "/ezgraph/docs/tutorials/quote-graph/" },
          { title: "1. A fifteen-turn live replay", url: "/ezgraph/docs/tutorials/quote-graph/live-replay/" },
          { title: "2. Graph, state, and ownership", url: "/ezgraph/docs/tutorials/quote-graph/graph-and-state/" },
          { title: "3. Anatomy of a conversation turn", url: "/ezgraph/docs/tutorials/quote-graph/conversation-turn-anatomy/" },
          { title: "4. Prompts and stage handoffs", url: "/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/" },
          { title: "5. Validated collection", url: "/ezgraph/docs/tutorials/quote-graph/validated-tools/" },
          { title: "6. Catalog lookup and disambiguation", url: "/ezgraph/docs/tutorials/quote-graph/vehicle-catalog/" },
          { title: "7. Time, sessions, and history spaces", url: "/ezgraph/docs/tutorials/quote-graph/sessions-and-history/" },
          { title: "8. Deterministic rating", url: "/ezgraph/docs/tutorials/quote-graph/deterministic-rating/" },
          { title: "9. Revisions, direct responses, and acceptance", url: "/ezgraph/docs/tutorials/quote-graph/revise-and-accept/" },
          { title: "10. Testing the whole quote", url: "/ezgraph/docs/tutorials/quote-graph/testing/" },
        ],
      },
      {
        title: "DecisionHotelGraph",
        items: [
          { title: "Track overview", url: "/ezgraph/docs/tutorials/decision-hotel-graph/" },
          { title: "1. A sixteen-turn live replay", url: "/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/" },
          { title: "2. Graph, state, and history spaces", url: "/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/" },
          { title: "3. Anatomy of a decision node", url: "/ezgraph/docs/tutorials/decision-hotel-graph/decision-node-anatomy/" },
          { title: "4. Questions, prompts, and thresholds", url: "/ezgraph/docs/tutorials/decision-hotel-graph/questions-and-prompts/" },
          { title: "5. The router's policy", url: "/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/" },
          { title: "6. Criteria collectors and corrections", url: "/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/" },
          { title: "7. Readiness and deterministic search", url: "/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/" },
          { title: "8. Grounded presentation and booking", url: "/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/" },
          { title: "9. Fallbacks, usage, and cost", url: "/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-cost/" },
          { title: "10. Testing decision graphs", url: "/ezgraph/docs/tutorials/decision-hotel-graph/testing/" },
        ],
      },
    ],
  },
  {
    label: "Developer guide",
    items: [
      { title: "Overview", url: guide },
      { title: "Node contract", url: `${guide}#the-node-contract` },
      { title: "State and ownership", url: `${guide}#state-belongs-to-the-node-that-owns-it` },
      { title: "Tool responses", url: `${guide}#return-one-direct-tool-response` },
      { title: "Topology", url: `${guide}#build-topology-explicitly` },
      { title: "Decision nodes (Jev)", url: `${guide}#decision-nodes-with-jev` },
      { title: "Testing", url: `${guide}#test-in-two-tiers` },
      { title: "Migration checklist", url: `${guide}#migration-checklist` },
    ],
  },
  {
    label: "Architecture",
    items: [
      { title: "Application layer above LangGraph", url: "/ezgraph/docs/langgraph-pain-points/" },
      { title: "EZGraph vs. LangGraph", url: "/ezgraph/compare/langgraph/" },
    ],
  },
];
