---
title: Release notes
eyebrow: Releases
lede: Published changes to @picoflow/core, with migration steps and compatibility guidance for teams shipping durable agent flows.
source: picoflow/README.md, picoflow/npmlib/package.json
---

<div class="callout callout--tip"><span class="callout__title">Latest stable release</span><p><code>@picoflow/core@1.1.2</code> was published on <time datetime="2026-08-09">August 9, 2026</time>. Pin this version while you evaluate the runtime and review the changes below.</p></div>

## 1.1.2 — August 9, 2026

PicoFlow 1.1.2 is a compatibility and runtime-refinement release following the
Flow / Step architecture introduced in 1.1.1. It makes the package usable from
both ESM and CommonJS applications and exposes more of the provider/runtime
contract to application code.

### Highlights

- The published package now includes both ESM (`import`) and CommonJS (`require`) entries.
- The model catalog is exported for applications that need to inspect or validate available model selections.
- The last-response utility is exported for response inspection at application boundaries.
- Provider adapter registration, model selection, grouped tool handlers, and response handling have been refined for the current Flow / Step runtime.

### Upgrade

```bash
npm install @picoflow/core@1.1.2
```

Review your provider registrations and run the flow contract and end-to-end
tests after upgrading. Applications that were using a local staging build should
rebuild the library before rebuilding the demo or service that consumes it.

### Compatibility

| Requirement | 1.1.2 behavior |
| --- | --- |
| Node.js | `>=22.5` |
| Module format | ESM and CommonJS package entries are published. |
| TypeScript setup | Use `module: "NodeNext"`, `moduleResolution: "NodeNext"`, and explicit `.js` extensions on relative imports in ESM TypeScript source. |
| Zod | `zod@4` is required; the published runtime uses `4.4.3`. |
| LangChain core | The published runtime uses `@langchain/core@1.2.3`. |
| License | A valid `PICOFLOW_KEY` is required when a real model/tool turn executes. |

## 1.1.1 — August 5, 2026

PicoFlow 1.1.1 makes the multi-turn conversation model the center of the runtime: your application defines `Flow` and `Step` classes, while PicoFlow owns the repeated model, tool, session, and response machinery around them.

### Breaking changes

- The published package is `@picoflow/core`. Update imports and dependency declarations from older package names before rebuilding.
- Application code is organized around registered `Flow` and `Step` classes. A step owns its prompt, tools, validation, state, and routing; the containing flow owns topology and model policy.
- Transitions are explicit: use `go(...)` to move to another step, `stay(...)` to keep the current step active with feedback, and `direct(...)` to return a response without another model call.
- Session documents now carry the active flow and step, per-step state, memory, model metadata, logs, token totals, timestamps, and revision information as one durable contract.

If you are upgrading from an earlier release, treat this as a migration rather than a drop-in dependency update.

### Migration steps

1. Install and pin the package while you update the application:

   ```bash
   npm install @picoflow/core@1.1.1
   ```

2. Update imports to `@picoflow/core`, then move conversation stages into `Flow` and `Step` classes.
3. Replace implicit routing with explicit `go(...)`, `stay(...)`, or `direct(...)` outcomes.
4. Review persisted sessions before deploying. If a release changes a step name, state shape, memory namespace, or session schema, implement an idempotent `onRestoreSessionDoc()` migration. See the [session document migration guide](/docs/guides/migration/).
5. Run a real end-to-end turn in CI, including the response, active step, session ID, persisted state, and error path. The [testing guide](/docs/guides/testing/) shows the contract to assert.

### Bug fixes and reliability work

- Durable sessions preserve the active cursor, state, memory, logs, token usage, and revisions across turns.
- Same-session locking and revision checks make concurrent requests fail explicitly instead of silently overwriting a newer document.
- Provider and model selection is explicit at the flow and step boundaries, with built-in adapters for the supported providers.
- Response handling keeps tool feedback, state changes, prompts, content types, and direct responses in one inspectable outcome contract.
- Tool handlers can be grouped and dispatched as a batch while keeping validation and business rules in application-owned TypeScript.

### Compatibility

| Requirement | 1.1.1 behavior |
| --- | --- |
| Node.js | `>=22.5` |
| Module format | The published package currently exposes an ESM entry (`import`). |
| TypeScript setup | Use `module: "NodeNext"`, `moduleResolution: "NodeNext"`, and explicit `.js` extensions on relative imports. |
| Zod | `zod@4` is required; the published runtime uses `4.4.3`. |
| LangChain core | The published runtime uses `@langchain/core@1.2.3`. |
| License | A valid `PICOFLOW_KEY` is required when a real model/tool turn executes. |

The package's CommonJS build is not included in the published 1.1.1 artifact. CommonJS applications must use a dynamic `import()` until a release with a `require` export is published.

### Related docs

- [Install PicoFlow](/docs/get-started/installation/)
- [Build your first flow](/docs/get-started/first-flow/)
- [Understand the session document](/docs/concepts/session-document/)
- [Read the migration guide](/docs/guides/migration/)
- [View @picoflow/core on npm](https://www.npmjs.com/package/@picoflow/core)
