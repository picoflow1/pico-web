---
title: Testing and evaluation
eyebrow: Compare
lede: The two 14-turn scenarios establish semantic parity, but their fast-test stories and untested failure surfaces differ sharply.
source: picoflow-demo/test/hotel-flow/, picoflow-demo/test/hotel-langgraph/, picoflow-demo/src/myflow/hotel-flow/, picoflow-demo/src/myflow/hotel-langgraph/
---

The scenarios are almost identical: only `flowName: "HotelFlow"` versus
`graphName: "HotelLanggraph"` differs. Each drives 14 turns through greeting, dates, budget,
room type, amenities, distance, search, a changed search, three comparisons, resume, and
booking. Both use the same expected semantic descriptions and score threshold.

## What the shared scenario proves

Passing the scenario is evidence that both implementations can support:

- stable session identity across many HTTP turns;
- stage-specific conversational prompts;
- search criteria accumulation and correction;
- a transition from results to comparison using one user request;
- reuse of prior selected hotels for a second feature;
- a return from comparison to booking; and
- a completed terminal response with a confirmation number.

It is not proof of equivalent architectures, identical prices on every date, failure recovery,
safe concurrent writes, or production quality.

## Direct LangGraph test layers

The direct implementation has three useful layers:

1. `hotel-langgraph.spec.ts` injects a scripted model factory and deterministically completes
   the entire workflow without network access. It then asserts final graph state.
2. `hotel-langgraph.e2e.spec.ts` boots Nest/Fastify and verifies graph discovery, request and
   session headers, continuation, and deletion.
3. `hotel-langgraph.live.eval.ts` uses real OpenAI models and an LLM judge. It refuses to
   silently skip when explicitly invoked without credentials.

This separation is strong. The model factory is a particularly effective seam: each stage gets
the same tool metadata as production while tests control which AI or tool-call message returns.

## PicoFlow test layers

HotelFlow's main E2E test boots the HTTP application, uses live configured models, runs the
14-turn scenario, applies an LLM judge, and inspects the framework session document. It skips
when the OpenAI and PicoFlow credentials are absent.

The final-state assertions are valuable, but there is no deterministic HotelFlow model seam
equivalent to `HotelModelFactory`. A normal local `npm test` can therefore report no HotelFlow
failure while the live scenario was skipped. PicoFlow has framework contract tests elsewhere,
but those do not prove this demo's prompts, handlers, and hotel invariants.

## Verified during this audit

The current `picoflow-demo` passed:

```text
npm run typecheck
npm run test:hotel-langgraph:unit
```

The direct suite executed three tests: full multi-turn behavior, termination/deletion, and the
HTTP controller boundary. The live model suites were not run because they incur external model
calls and require credentials.

## Missing tests worth adding

| Risk | Test to add |
| --- | --- |
| Same-session race | Fire two turns concurrently and assert one conflict or an intentional merge—not silent last-write-wins |
| Malformed tool JSON | Make the scripted model return broken `capture_choices` input and assert corrective feedback |
| Response admission retry | Override `checkResponse()`, reject the first raw and structured result, and assert bounded retry, token accounting, warning logging, and exhaustion behavior |
| Invented hotel booking | Attempt a hotel outside the current results |
| Multiple tool calls | Return two calls in one AI message and assert the declared policy |
| Store conformance | Run create/get/update/delete, expiry, stale-write, and serialization cases against every adapter |
| History growth | Re-enter search/present/compare many times and assert compaction or a hard size policy |
| Provider failure | Throw from the model and verify status, saved diagnostics, and safe retry semantics |
| Booking idempotency | Repeat the final booking turn and prove no duplicate external effect |
| Prompt parity | Hash or compare the duplicated prompt/catalog assets in CI |
| Price parity | Run a table of dates, rooms, holidays, budgets, and time zones through both helpers |

## How to compare fairly over time

Keep a shared black-box contract suite whose adapter only translates the two HTTP envelopes.
Use the same scripted model decisions, catalog fixture, clock, random-number source, and pricing
backend. Then separately run framework-specific tests for checkpoints, session revisions,
interrupts, stores, and memory compaction.

That split prevents a common evaluation mistake: attributing a better prompt, validator, or
helper implementation to the orchestration framework. It also turns this comparison from a
one-time line-count article into a regression benchmark.
