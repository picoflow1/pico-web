import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.resolve(process.argv[2] ?? path.join(siteRoot, "../ezgraph-demo"));

function normalizedLines(file) {
  let total = 0;
  let inBlockComment = false;
  let inImport = false;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (inImport) {
      if (/from\s+["'].+["']/.test(line) || /;\s*$/.test(line)) inImport = false;
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("*")) continue;
    if (/^import\b/.test(line)) {
      if (!/from\s+["'].+["']\s*;?\s*$/.test(line)) inImport = true;
      continue;
    }
    total += 1;
  }
  return total;
}

function rawLines(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).length - 1;
}

function measure(files) {
  return files.reduce(
    (total, file) => {
      const absolute = path.join(demoRoot, file);
      total.normalized += normalizedLines(absolute);
      total.raw += rawLines(absolute);
      total.files[file] = { normalized: normalizedLines(absolute), raw: rawLines(absolute) };
      return total;
    },
    { normalized: 0, raw: 0, files: {} },
  );
}

const quoteGraphFiles = [
  "src/graphs/quote-graph/quote-graph.ts",
  "src/graphs/quote-graph/quote-graph.state.ts",
  ...fs
    .readdirSync(path.join(demoRoot, "src/graphs/quote-graph/nodes"))
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => `src/graphs/quote-graph/nodes/${file}`),
];
const quoteLanggraphFiles = [
  "src/graphs/quote-langgraph/quote-langgraph.ts",
  "src/graphs/quote-langgraph/quote-langgraph.state.ts",
  "src/graphs/quote-langgraph/quote-session-store.ts",
  "src/graphs/quote-langgraph/quote-types.ts",
];
const controllers = {
  ezgraph: measure(["src/controllers/ai-controller.ts"]),
  langgraph: measure(["src/controllers/ai-langgraph-controller.ts"]),
};
const backend = {
  ezgraph: measure(fs.readdirSync(path.join(demoRoot, "src/graphs/quote-graph/backend")).filter((file) => file.endsWith(".ts")).sort().map((file) => `src/graphs/quote-graph/backend/${file}`)),
  langgraph: measure(fs.readdirSync(path.join(demoRoot, "src/graphs/quote-langgraph/backend")).filter((file) => file.endsWith(".ts")).sort().map((file) => `src/graphs/quote-langgraph/backend/${file}`)),
};

const result = {
  demoRoot,
  quoteGraph: measure(quoteGraphFiles),
  quoteLanggraph: measure(quoteLanggraphFiles),
  controllers,
  backend,
};
console.log(JSON.stringify(result, null, 2));
