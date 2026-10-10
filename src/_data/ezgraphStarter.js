import { readFileSync } from "node:fs";
const directory = new URL("../../examples/ezgraph-starter/", import.meta.url);
export default Object.fromEntries(["workflow.ts", "main.ts", "workflow.spec.ts", "tsconfig.json"].map((file) => [file, readFileSync(new URL(file, directory), "utf8")]));
