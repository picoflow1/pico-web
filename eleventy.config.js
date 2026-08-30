import path from "node:path";
import { readFileSync } from "node:fs";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);

const highlightedFences = new Set([
  "ts",
  "typescript",
  "js",
  "javascript",
  "json",
  "jsonc",
  "bash",
  "shell",
  "sh",
]);
const transcriptMarkdown = markdownIt({ typographer: true, linkify: true });
const docsRoots = new Set([
  "get-started",
  "concepts",
  "tutorials",
  "guides",
  "reference",
  "resources",
  "releases",
]);

function decodeHtmlEntities(source) {
  return String(source ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#([0-9]+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function highlightTypescriptSource(source) {
  return hljs.highlight(decodeHtmlEntities(source), {
    language: "typescript",
    ignoreIllegals: true,
  }).value;
}

function normalizeCodeLanguage(language) {
  const normalizedLanguage = language?.toLowerCase();
  if (normalizedLanguage === "ts") return "typescript";
  if (normalizedLanguage === "js") return "javascript";
  if (["jsonc"].includes(normalizedLanguage)) return "json";
  if (["shell", "sh"].includes(normalizedLanguage)) return "bash";
  if (["typescript", "javascript", "json", "bash", "text"].includes(normalizedLanguage)) {
    return normalizedLanguage;
  }
  return undefined;
}

function highlightCodeSource(source, language) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || normalizedLanguage === "text") return null;

  try {
    return hljs.highlight(decodeHtmlEntities(source), {
      language: normalizedLanguage,
      ignoreIllegals: true,
    }).value;
  } catch {
    return null;
  }
}

function highlightTypescript(source, language) {
  const normalizedLanguage = language?.toLowerCase();
  if (!highlightedFences.has(normalizedLanguage)) return "";

  const languageName = normalizeCodeLanguage(normalizedLanguage);
  const html = highlightCodeSource(source, languageName);
  if (html === null) return "";
  return `<pre class="hljs"><code class="hljs language-${languageName}">${html}</code></pre>`;
}

function ezgraphCodeLanguage(codeAttributes, source) {
  const plainSource = decodeHtmlEntities(source.replace(/<[^>]+>/g, "")).trim();
  const dataLanguage = codeAttributes.match(/\bdata-lang=["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const classLanguage = codeAttributes.match(/\blanguage-([\w-]+)/i)?.[1]?.toLowerCase();

  // data-lang is authored by the page and is always authoritative.
  const explicitLanguage = normalizeCodeLanguage(dataLanguage);
  if (explicitLanguage) return explicitLanguage;

  // A previous HTML pass may have guessed Bash for a raw Nunjucks TypeScript
  // snippet. Do not preserve that inference when its source is plainly TS.
  const isStrongTypescript = /^(?:import\s|export\s+(?:type|class|interface|const|function)\s|(?:public |private |protected )?(?:async )?(?:class|interface|type|function|const|let)\s|@\w+\b)/m.test(plainSource);
  if (isStrongTypescript) return "typescript";

  const classHint = normalizeCodeLanguage(classLanguage);
  if (classHint) return classHint;

  if (/^export\s/m.test(plainSource)) return "typescript";

  if (/^(?:#|npm |npx |pnpm |yarn |curl |git |cd |cp |export |node )/m.test(plainSource)) return "bash";
  if (/^[{[]/.test(plainSource)) return "json";
  // EZGraph's unlabelled Nunjucks examples are source snippets. highlightAuto
  // frequently mistakes TypeScript imports and decorators for Bash, so use the
  // site convention as the stable fallback. Shell and JSON examples are
  // recognized above or carry an explicit language/data-lang attribute.
  return "typescript";
}

function ezgraphLineNumbers(source) {
  const lines = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n");
  return lines.map((_, index) => `<li>${index + 1}</li>`).join("");
}

function enhanceCodeBlocks(content, variant) {
  const bodyClass = variant === "ezgraph" ? "ezgraph-code-body" : "picoflow-code-body";
  const gutterClass = variant === "ezgraph" ? "ezgraph-code-gutter" : "picoflow-code-gutter";
  const preClass = variant === "ezgraph" ? "ezgraph-code-pre" : "picoflow-code-pre";

  return content.replace(
    /<pre([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (match, preAttributes, codeAttributes, source) => {
      if (/\b(?:ezgraph|picoflow)-code-pre\b/.test(preAttributes)) return match;

      const language = ezgraphCodeLanguage(codeAttributes, source);
      const plainSource = decodeHtmlEntities(source.replace(/<[^>]+>/g, ""));
      const highlightedSource =
        highlightCodeSource(plainSource, language) ?? source;

      return `<div class="${bodyClass}"><ol class="${gutterClass}" aria-hidden="true">${ezgraphLineNumbers(plainSource)}</ol><pre class="${preClass} hljs"><code class="hljs language-${language}">${highlightedSource}</code></pre></div>`;
    },
  );
}

function enhanceEzgraphCodeBlocks(content) {
  return enhanceCodeBlocks(content, "ezgraph");
}

function anchorSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function searchText(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?(?:\[[^\]]*\]\([^)]*\))/g, " ")
    .replace(/[>#*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/public": "." });
  eleventyConfig.addWatchTarget("src/assets/css/");

  eleventyConfig.amendLibrary("md", (mdLib) =>
    mdLib
      .set({ typographer: true, linkify: true, highlight: highlightTypescript })
      .use(markdownItAnchor, {
        level: [2, 3],
        permalink: markdownItAnchor.permalink.headerLink({
          safariReaderFix: true,
        }),
        slugify: anchorSlug,
      }),
  );

  eleventyConfig.addFilter("toc", (content) => {
    if (typeof content !== "string") return [];
    const headings = [];
    const headingPattern = /<h([23])\s+id="([^"]+)"[^>]*>(.*?)<\/h\1>/gis;
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      const text = match[3]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      if (text) headings.push({ level: Number(match[1]), id: match[2], text });
    }
    return headings;
  });

  eleventyConfig.addFilter("splitList", (value) =>
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

  eleventyConfig.addFilter("isRepoPath", (value) => String(value ?? "").startsWith("pico-demo/"));
  eleventyConfig.addFilter("repoUrl", (value) => {
    const repoPath = String(value ?? "");
    if (!repoPath.startsWith("pico-demo/")) return "";
    const path = repoPath.slice("pico-demo/".length).replace(/\/$/, "");
    const kind = !path || path.endsWith("/") || !path.split("/").at(-1).includes(".") ? "tree" : "blob";
    return `https://github.com/picoflowio/pico-demo/${kind}/main/${encodeURI(path)}`;
  });

  eleventyConfig.addFilter("isActive", (url, pageUrl) => Boolean(url && pageUrl && url === pageUrl));
  eleventyConfig.addFilter("groupHasUrl", (group, url) =>
    (group?.items ?? []).some((item) => item.url === url),
  );
  eleventyConfig.addFilter("sectionOf", (pageUrl, tabs) => {
    if (!pageUrl) return null;
    let result = null;
    for (const tab of tabs ?? []) {
      if (pageUrl.startsWith(tab.url) && (!result || tab.url.length > result.url.length)) {
        result = tab;
      }
    }
    return result;
  });
  eleventyConfig.addFilter("flattenNav", (tab) =>
    (tab?.groups ?? []).flatMap((group) =>
      (group.items ?? []).map((item) => ({ url: item.url, title: item.title })),
    ),
  );
  eleventyConfig.addFilter("prevPage", (pages, url) => {
    const index = (pages ?? []).findIndex((page) => page.url === url);
    return index > 0 ? pages[index - 1] : null;
  });
  eleventyConfig.addFilter("nextPage", (pages, url) => {
    const index = (pages ?? []).findIndex((page) => page.url === url);
    return index >= 0 && index < pages.length - 1 ? pages[index + 1] : null;
  });
  eleventyConfig.addFilter("json", (value) => JSON.stringify(value));
  eleventyConfig.addFilter("highlightTs", (value) => {
    try {
      return highlightTypescriptSource(value);
    } catch {
      return decodeHtmlEntities(value);
    }
  });
  eleventyConfig.addFilter("renderTranscriptMarkdown", (value) => {
    // Keep headings inside a chat bubble out of the page outline while preserving
    // the recorded response's Markdown structure.
    return transcriptMarkdown.render(String(value ?? "").replace(/^### /gm, "#### "));
  });

  eleventyConfig.addTransform("highlightRawTypescript", function (content) {
    if (!this.page?.outputPath?.endsWith(".html")) return content;
    return content.replace(
      /<pre><code class="language-typescript">([\s\S]*?)<\/code><\/pre>/g,
      (_match, source) =>
        `<pre class="hljs"><code class="hljs language-typescript">${highlightTypescriptSource(source)}</code></pre>`,
    );
  });

  eleventyConfig.addTransform("enhanceEzgraphCodeBlocks", function (content) {
    if (!this.page?.outputPath?.includes(`${path.sep}ezgraph${path.sep}`)) return content;
    return enhanceEzgraphCodeBlocks(content);
  });

  eleventyConfig.addTransform("enhancePicoflowCodeBlocks", function (content) {
    if (this.page?.outputPath?.includes(`${path.sep}ezgraph${path.sep}`)) return content;
    return enhanceCodeBlocks(content, "picoflow");
  });

  eleventyConfig.addCollection("docsSearch", (collectionApi) =>
    collectionApi
      .getAll()
      .filter((item) => item.url?.startsWith("/docs/") && item.url !== "/docs/search/" && item.data.title)
      .map((item) => ({
        title: item.data.title,
        url: item.url,
        lede: item.data.lede || item.data.description || "",
        section: item.url.split("/")[2]?.replace(/-/g, " ") || "Overview",
        text: searchText(readFileSync(item.inputPath, "utf8")),
      })),
  );

  // Existing documentation used root-relative internal URLs. Keep the source
  // readable while making the built docs work from their new /docs/ home.
  eleventyConfig.addTransform("prefixDocsLinks", function prefixDocsLinks(content, outputPath) {
    if (!outputPath || !outputPath.includes(`${path.sep}docs${path.sep}`)) return content;
    return content.replace(/href="\/([^"#?]+)([?#][^"]*)?"/g, (match, target, suffix = "") => {
      const root = target.split("/")[0];
      if (!docsRoots.has(root)) return match;
      return `href="/docs/${target}${suffix}"`;
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"],
  };
}
