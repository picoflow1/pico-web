import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import docsNav from "../src/_data/docsNav.js";

const siteDirectory = path.resolve("_site");
const workspaceDirectory = path.resolve(process.cwd(), "..");
const sourceRoots = new Map([
  ["pf", "picoflow"],
  ["picoflow", "picoflow"],
  ["pico-demo", "pico-demo"],
]);
const problems = [];
const warnings = [];

function fail(message) {
  problems.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function collectHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtmlFiles(fullPath)));
    else if (entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

async function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(fullPath)));
    else if (entry.name.endsWith(".md") || entry.name.endsWith(".njk")) files.push(fullPath);
  }
  return files;
}

async function checkPublicSourceContracts() {
  const docsDirectory = path.resolve("src/docs");
  const docsFiles = await collectMarkdownFiles(docsDirectory);
  const stalePatterns = [
    {
      pattern: /getContext(?:<[^>\n]+>)?\(\s*["']myRunData["']\s*\)/,
      message: 'reads myRunData without the required config. prefix',
    },
    {
      pattern: /flow\.addContext\(\s*config\s*\)/,
      message: 'passes config to addContext without the context wrapper',
    },
    {
      pattern: /response\s*\[\s*["']message["']\s*\]/,
      message: 'reads the batch response envelope outside response.data',
    },
    {
      pattern: /path\.join\(\s*__dirname\s*,\s*fileName\s*\)/,
      message: 'opens a model-supplied filename without an allowlist',
    },
    {
      pattern: /BASIC_FLOW_TEST_DOCUMENT_DB|\bDOCUMENT_DB\b/,
      message: 'references the retired DOCUMENT_DB setting; use SESSION_STORE',
    },
    {
      pattern: /test:basic-flow:contract/,
      message: 'uses a test script that is not published by the demo package',
    },
  ];

  for (const file of docsFiles) {
    const content = await readFile(file, "utf8");
    const relativeFile = path.relative(process.cwd(), file);
    const sourceLine = content.match(/^source:\s*(.+)$/m)?.[1];
    if (sourceLine) {
      for (const source of sourceLine.split(",").map((value) => value.trim()).filter(Boolean)) {
        const [alias, ...segments] = source.split("/");
        const sourceRoot = sourceRoots.get(alias);
        if (!sourceRoot) continue;

        const rootDirectory = path.resolve(workspaceDirectory, sourceRoot);
        const sourcePath = path.resolve(workspaceDirectory, sourceRoot, ...segments);
        if (sourcePath !== rootDirectory && !sourcePath.startsWith(`${rootDirectory}${path.sep}`)) {
          fail(`${relativeFile}: source reference escapes its repository root: ${source}`);
        } else if (!existsSync(sourcePath)) {
          fail(`${relativeFile}: source-of-truth path does not exist: ${source}`);
        }
      }
    }

    for (const { pattern, message } of stalePatterns) {
      if (pattern.test(content)) fail(`${relativeFile}: ${message}.`);
    }
  }
}

function urlToFile(url) {
  const clean = url.split("#")[0].split("?")[0];
  if (clean.endsWith("/")) return path.join(siteDirectory, clean, "index.html");
  if (path.extname(clean)) return path.join(siteDirectory, clean);
  return path.join(siteDirectory, clean, "index.html");
}

await checkPublicSourceContracts();

if (process.argv.includes("--source-only")) {
  if (problems.length) {
    console.error(`\n${problems.length} public documentation problem(s):`);
    for (const problem of problems) console.error(`  FAIL  ${problem}`);
    process.exit(1);
  }
  console.log("OK — public source contracts passed.");
  process.exit(0);
}

if (!existsSync(siteDirectory)) {
  console.error("Build output is missing. Run `npm run build` first.");
  process.exit(1);
}

const navUrls = new Set();
for (const tab of docsNav.tabs) {
  navUrls.add(tab.url);
  for (const group of tab.groups) {
    for (const item of group.items) {
      navUrls.add(item.url);
      if (!existsSync(urlToFile(item.url))) {
        fail(`docs navigation points at a page that was not built: ${item.url} (${item.title})`);
      }
    }
  }
}

const htmlFiles = await collectHtmlFiles(siteDirectory);
const internalHref = /href="(\/[^"#][^"]*)"/g;
const legacyDocsHref = /href="\/(get-started|concepts|tutorials|guides|reference|resources)(?:\/|\")/;

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relativeFile = path.relative(siteDirectory, file);
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;

  if (h1Count !== 1) fail(`${relativeFile}: expected exactly one H1, found ${h1Count}.`);
  if (!/<meta name="description" content="[^"]+">/i.test(html)) fail(`${relativeFile}: missing meta description.`);
  if (!/<link rel="canonical" href="https:\/\/www\.picoflow\.io\//i.test(html)) fail(`${relativeFile}: missing canonical URL.`);
  // Every <script> on the page, including ones with a body. JSON-LD is declarative
  // metadata rather than executable code, so it is allowed; anything else is not.
  const scriptTags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const isDocsSearch = (tag) =>
    relativeFile === path.join("docs", "search", "index.html")
    && /^<script\s+src="\/assets\/js\/docs-search\.js"\s+defer><\/script>$/i.test(tag);
  const isJsonLd = (tag) => {
    if (!/^<script\s+type="application\/ld\+json">/i.test(tag)) return false;
    const body = tag.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      JSON.parse(body);
      return true;
    } catch (error) {
      fail(`${relativeFile}: JSON-LD block is not valid JSON (${error.message}).`);
      return true;
    }
  };
  for (const tag of scriptTags) {
    if (!isDocsSearch(tag) && !isJsonLd(tag)) {
      fail(`${relativeFile}: contains an unexpected client-side <script> tag.`);
    }
  }
  if (/\son[a-z]+="/i.test(html)) fail(`${relativeFile}: contains an inline event handler.`);

  for (const match of html.matchAll(internalHref)) {
    const url = match[1];
    if (!existsSync(urlToFile(url))) fail(`${relativeFile}: dead internal link → ${url}`);
  }

  if (relativeFile.startsWith(`docs${path.sep}`) && legacyDocsHref.test(html)) {
    fail(`${relativeFile}: still emits a legacy root-relative documentation link.`);
  }

  if (/\{\{|\{%/.test(html.replace(/<code[\s\S]*?<\/code>/gi, ""))) {
    warn(`${relativeFile}: possible unrendered template delimiter outside code.`);
  }
}

for (const asset of [
  "assets/css/site.css",
  "assets/css/tokens.css",
  "assets/css/app.css",
  "assets/img/logo.png",
  "assets/img/logo2.png",
  "assets/img/og-card.png",
  "assets/js/docs-search.js",
  "robots.txt",
  "sitemap.xml",
  "docs/search-index.json",
]) {
  if (!existsSync(path.join(siteDirectory, asset))) fail(`missing built asset: ${asset}`);
}

try {
  const searchIndex = JSON.parse(await readFile(path.join(siteDirectory, "docs/search-index.json"), "utf8"));
  if (!Array.isArray(searchIndex)) {
    fail("docs/search-index.json: expected an array.");
  } else {
    const indexedUrls = new Set(searchIndex.map((entry) => entry?.url));
    for (const url of new Set(["/docs/", ...navUrls])) {
      if (!indexedUrls.has(url)) fail(`docs/search-index.json: missing searchable page ${url}`);
    }
    for (const entry of searchIndex) {
      if (!entry?.title || !entry?.url || !existsSync(urlToFile(entry.url))) {
        fail(`docs/search-index.json: invalid search entry for ${entry?.url ?? "unknown URL"}`);
      }
    }
  }
} catch (error) {
  fail(`docs/search-index.json: could not parse generated search index (${error.message}).`);
}

console.log(`Checked ${htmlFiles.length} HTML pages and ${navUrls.size} docs navigation entries.`);
for (const warning of warnings) console.log(`  warn  ${warning}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nOK — public source contracts, internal links, SEO basics, docs migration, and script-free output passed.");
}
