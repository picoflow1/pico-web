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
          { title: "2. Graph and state ownership", url: "/ezgraph/docs/tutorials/quote-graph/graph-and-state/" },
          { title: "3. Validated collection and catalog lookup", url: "/ezgraph/docs/tutorials/quote-graph/validated-tools/" },
          { title: "4. Session lifetime and history spaces", url: "/ezgraph/docs/tutorials/quote-graph/sessions-and-history/" },
          { title: "5. Deterministic rating", url: "/ezgraph/docs/tutorials/quote-graph/deterministic-rating/" },
          { title: "6. Revisions, direct responses, and acceptance", url: "/ezgraph/docs/tutorials/quote-graph/revise-and-accept/" },
          { title: "7. Testing the whole quote", url: "/ezgraph/docs/tutorials/quote-graph/testing/" },
        ],
      },
      {
        title: "DecisionHotelGraph",
        items: [
          { title: "Track overview", url: "/ezgraph/docs/tutorials/decision-hotel-graph/" },
          { title: "1. A sixteen-turn live replay", url: "/ezgraph/docs/tutorials/decision-hotel-graph/live-replay/" },
          { title: "2. Graph and durable criteria", url: "/ezgraph/docs/tutorials/decision-hotel-graph/graph-and-criteria/" },
          { title: "3. Typed decision routing", url: "/ezgraph/docs/tutorials/decision-hotel-graph/decision-routing/" },
          { title: "4. Criteria ownership and corrections", url: "/ezgraph/docs/tutorials/decision-hotel-graph/criteria-and-corrections/" },
          { title: "5. Readiness before search", url: "/ezgraph/docs/tutorials/decision-hotel-graph/readiness-and-search/" },
          { title: "6. Grounded presentation and booking", url: "/ezgraph/docs/tutorials/decision-hotel-graph/grounded-presentation/" },
          { title: "7. Fallbacks and evaluation", url: "/ezgraph/docs/tutorials/decision-hotel-graph/fallbacks-and-testing/" },
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
