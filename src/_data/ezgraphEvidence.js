import { readFileSync } from "node:fs";
const evidence = JSON.parse(readFileSync(new URL("../assets/ezgraph/quotegraph-code-counts.json", import.meta.url), "utf8"));
export default {
  ...evidence,
  ezgraphLines: evidence.quoteGraph.normalized.toLocaleString("en-US"),
  langgraphLines: evidence.quoteLanggraph.normalized.toLocaleString("en-US"),
  difference: evidence.quoteLanggraph.normalized - evidence.quoteGraph.normalized,
  reduction: ((1 - evidence.quoteGraph.normalized / evidence.quoteLanggraph.normalized) * 100).toFixed(1),
  barWidth: (evidence.quoteGraph.normalized / evidence.quoteLanggraph.normalized * 100).toFixed(1),
};
