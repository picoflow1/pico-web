import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import docsNav from "../src/_data/docsNav.js";
import ezgraphDocsNav from "../src/_data/ezgraphDocsNav.js";

const siteDirectory = path.resolve("_site");
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

async function checkPublicDocumentationContracts() {
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
  ];

  for (const file of docsFiles) {
    const content = await readFile(file, "utf8");
    const relativeFile = path.relative(process.cwd(), file);
    // Source front matter is provenance metadata; this standalone site must not
    // resolve paths in sibling repositories during its build.

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

await checkPublicDocumentationContracts();

if (process.argv.includes("--source-only")) {
  if (problems.length) {
    console.error(`\n${problems.length} public documentation problem(s):`);
    for (const problem of problems) console.error(`  FAIL  ${problem}`);
    process.exit(1);
  }
  console.log("OK — public documentation contracts passed.");
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

const ezgraphNavUrls = new Set();
const linkedEzgraphPages = new Map();

async function checkEzgraphDestination(url, source) {
  const targetFile = urlToFile(url);
  if (!existsSync(targetFile)) {
    fail(`${source}: EZGraph link points at a page that was not built → ${url}`);
    return;
  }
  const fragment = url.split("#")[1];
  if (!fragment) return;
  if (!linkedEzgraphPages.has(targetFile)) {
    const html = await readFile(targetFile, "utf8");
    linkedEzgraphPages.set(targetFile, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
  }
  if (!linkedEzgraphPages.get(targetFile).has(decodeURIComponent(fragment))) {
    fail(`${source}: EZGraph link points at a missing heading → ${url}`);
  }
}

for (const group of ezgraphDocsNav) {
  for (const item of group.items ?? group.tracks.flatMap((track) => track.items)) {
    ezgraphNavUrls.add(item.url);
    await checkEzgraphDestination(item.url, `EZGraph navigation (${item.title})`);
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

  for (const match of html.matchAll(/href="(\/ezgraph\/[^"\s]*|#[^"\s]+)"/g)) {
    const url = match[1];
    if (url.startsWith("/ezgraph/")) {
      await checkEzgraphDestination(url, relativeFile);
    } else if (relativeFile.startsWith(`ezgraph${path.sep}`)) {
      const pageUrl = `/${relativeFile.split(path.sep).join("/").replace(/index\.html$/, "")}`;
      await checkEzgraphDestination(pageUrl + url, relativeFile);
    }
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

console.log(`Checked ${htmlFiles.length} HTML pages, ${navUrls.size} docs navigation entries, and ${ezgraphNavUrls.size} EZGraph navigation entries and their headings.`);
for (const warning of warnings) console.log(`  warn  ${warning}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  FAIL  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nOK — public documentation contracts, internal links, SEO basics, docs migration, and script-free output passed.");
}
