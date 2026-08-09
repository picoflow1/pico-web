import marketing from "./marketing.js";
import site from "./site.js";

/**
 * JSON-LD for the home page. This is declarative metadata, not executable
 * JavaScript, so it does not break the site's no-client-script rule.
 */

const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function toPlainText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (match) => entities[match] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

const faqPage = {
  "@type": "FAQPage",
  mainEntity: marketing.faqGroups.flatMap((group) =>
    group.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: toPlainText(item.answer) },
    })),
  ),
};

const softwareApplication = {
  "@type": "SoftwareApplication",
  name: site.title,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Node.js 22.5+",
  softwareVersion: site.latestRelease.version,
  description: site.description,
  url: site.url,
  downloadUrl: site.npm,
  programmingLanguage: "TypeScript",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free for personal evaluation. Production use requires a commercial licence.",
    url: `${site.url}/license/`,
  },
};

export default {
  home: {
    "@context": "https://schema.org",
    "@graph": [softwareApplication, faqPage],
  },
};
