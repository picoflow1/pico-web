# Picoflow Marketing Site (Eleventy)

This repo hosts the Picoflow marketing site built with [Eleventy](https://www.11ty.dev/) and a customized version of the Agency Bootstrap theme. All Ruby/Jekyll artifacts have been removed; the site is built and served with Node-only tooling.

## Prerequisites
- Node.js 18+ and npm (Eleventy 2.x target)

## Install & Run
```sh
npm install          # install dependencies
npm run dev          # local dev server with live reload (http://localhost:8080)
npm run build        # production build to `_site/`
```

## Project Layout
- `.eleventy.js` — Eleventy config (passthroughs, filters, collections).
- `_data/` — global data; `site.js` merges `sitetext.yml`, `style.yml`, and `navigation.yml`.
- `_includes/` — reusable fragments; `_layouts/` — page layouts.
- `portfolio/`, `qna/` — markdown content collections.
- `assets/` — images, CSS, JS copied through to the build.
- `_site/` — generated output (safe to delete/regenerate).

## Deployment
Run `npm run build` in CI/CD and publish the `_site/` directory to your static host (Netlify, Vercel, GitHub Pages, S3/CloudFront, etc.). No Ruby or Jekyll steps are required.

## License
MIT — see `license.md` for details.
