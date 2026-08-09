# PicoFlow site

The unified public site for PicoFlow. It replaces the separate `pico-web` marketing site and `pico-docs` documentation site with one Eleventy build, while preserving a dedicated documentation experience under `/docs/`.

## What lives here

- `/` — product-led marketing site
- `/product/` — PicoFlow's execution model and platform capabilities
- `/compare/langgraph/` — an honest, scoped comparison for evaluators
- `/docs/` — the migrated reference, guides, concepts, and tutorials
- `/docs/search/` — client-side search across the documentation
- `/license/` and `/contact/` — commercial inquiry paths

The production output is written to `_site/`. `src/public/CNAME` preserves the existing `www.picoflow.io` custom domain when the output is deployed to GitHub Pages or another compatible static host.

## Develop

```sh
cd pico-site
npm install
npm run dev
```

Eleventy serves the local site and rebuilds it as source files change.

## Verify a release

```sh
npm run build
```

The build runs Eleventy and then checks generated internal links, canonical metadata, documentation navigation, the docs search index, and the intentionally limited JavaScript surface. The only `<script>` tags permitted in the output are the deferred docs-search bundle on `/docs/search/` and `application/ld+json` blocks, which the checker parses to confirm they are valid JSON.

The social preview card at `src/assets/img/og-card.png` must stay a 1200x630 PNG. Twitter/X, LinkedIn, Slack, and iMessage do not render SVG `og:image` values, so an SVG card silently produces no preview.

## Content and design conventions

Marketing pages use the shared `marketing.njk` layout and styles in `src/assets/css/site.css`. Documentation keeps its own focused layout (`doc.njk`) and information architecture, using the source documents under `src/docs/`. Both areas share the same header/footer system, domain, analytics/deployment surface, redirects, and build pipeline.

The docs search is deliberately small and privacy-friendly: its static index is generated at build time and searched in the visitor's browser. There are no third-party search services or analytics scripts in this project.

## Migration and redirects

`src/public/_redirects` retains the previous marketing comparison and licensing routes and forwards the former documentation root paths into `/docs/`. Before replacing a live deployment, add any routes that exist only in production analytics or in external links, then validate them against the generated `_site/` output.

## Deployment

`.github/workflows/site.yml` validates every pull request and push to `main`. It deliberately does not publish; connect `_site/` to the team's chosen static host (or add a host-specific deployment workflow) after DNS and repository ownership are confirmed.
