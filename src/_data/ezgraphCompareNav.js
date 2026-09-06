const architecture = "/ezgraph/compare/langgraph/";
const caseStudy = `${architecture}quotegraph-case-study/`;

export default [
  {
    label: "Architecture & operating model",
    items: [
      { title: "Architecture and operating model", url: architecture },
      { title: "The ownership choice", url: `${architecture}#ownership` },
      { title: "State, memory, and sessions", url: `${architecture}#state-and-sessions` },
      { title: "Conversation contracts", url: `${architecture}#conversation-contracts` },
      { title: "Choosing the application layer", url: `${architecture}#choosing` },
    ],
  },
  {
    label: "QuoteGraph case study & evidence",
    items: [
      { title: "One chatbot, built twice", url: caseStudy },
      { title: "Code counts and scope", url: `${caseStudy}#headline` },
      { title: "Where the code reduction comes from", url: `${caseStudy}#concerns` },
      { title: "Modularity and edit sites", url: `${caseStudy}#modularity` },
      { title: "Tool-loop and boilerplate evidence", url: `${caseStudy}#patterns` },
      { title: "Method and limitations", url: `${caseStudy}#method` },
      { title: "Primary sources", url: `${caseStudy}#references` },
    ],
  },
];
