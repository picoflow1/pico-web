import path from "node:path";
import { readFileSync } from "node:fs";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);

const highlightedFences = new Set(["ts", "typescript", "json"]);
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

function highlightTypescript(source, language) {
  const normalizedLanguage = language?.toLowerCase();
  if (!highlightedFences.has(normalizedLanguage)) return "";

  try {
    const html = hljs.highlight(decodeHtmlEntities(source), {
      language: normalizedLanguage === "ts" ? "typescript" : normalizedLanguage,
      ignoreIllegals: true,
    }).value;
    return `<pre class="hljs"><code class="hljs language-${normalizedLanguage}">${html}</code></pre>`;
  } catch {
    return "";
  }
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
