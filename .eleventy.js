const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const MarkdownIt = require("markdown-it");

const md = new MarkdownIt({ html: true, linkify: true });

module.exports = function (eleventyConfig) {
  eleventyConfig.setDataDeepMerge(true);

  // Passthrough static assets
  eleventyConfig.addPassthroughCopy({ assets: "assets" });
  eleventyConfig.addPassthroughCopy("picoflow-static");

  // Custom filters
  eleventyConfig.addFilter("markdownify", (content) => {
    if (!content) return "";
    return md.render(String(content));
  });

  eleventyConfig.addFilter("relative_url", function (url = "") {
    if (!url) return "";
    const base = (this?.ctx?.site?.baseurl || "").replace(/\/$/, "");
    const normalized = url.startsWith("/") ? url : `/${url}`;
    return `${base}${normalized}`;
  });

  // Collections
  eleventyConfig.addCollection("portfolio", (collectionApi) =>
    collectionApi.getFilteredByGlob("portfolio/**/*.{md,markdown}")
  );

  eleventyConfig.addCollection("qna", (collectionApi) =>
    collectionApi.getFilteredByGlob("qna/**/*.{md,markdown}")
  );

  return {
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      layouts: "_layouts",
      output: "_site",
    },
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid",
    templateFormats: ["md", "html", "liquid", "njk"],
  };
};
