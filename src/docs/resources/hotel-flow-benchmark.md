---
title: HotelFlow benchmark
eyebrow: Compare
lede: A scoped, reproducible comparison of the same 14-turn hotel-reservation conversation implemented with PicoFlow and directly with LangGraph.
source: pico-demo/package.json, pico-demo/yarn.lock, pico-demo/src/myflow/hotel-flow/, pico-demo/src/myflow/hotel-langgraph/, pico-demo/test/hotel-flow/, pico-demo/test/hotel-langgraph/
---

This is a code-ownership case study, not a claim that either framework cannot express the
other implementation's behavior. Both versions collect search criteria, present priced hotels,
compare results, return to booking, and finish with a confirmation number.

## Scope and method

The consumer application resolves `@picoflow/core` to **1.1.12** and uses
`@langchain/langgraph` **1.4.8**. The comparison counts the application-owned workflow/runtime
files listed below with `wc -l`, including imports, comments, and blank lines. It excludes tests,
framework source, duplicated prompt/catalog assets, and domain backend/chart helpers.

The direct HotelLanggraph implementation calls `.compile()` without a LangGraph checkpointer and
persists its own session document through a custom memory, SQLite, and MongoDB store. Findings
about that store, its checkpoint history, and its write safety describe this implementation—not
LangGraph as a platform. A direct graph can instead choose LangGraph checkpointing, stores, and
observability integrations; that would be a different comparison implementation.

## Current measured boundary

<section class="line-reduction" aria-labelledby="line-reduction-title">
<div class="line-reduction__heading">
<div>
<p class="line-reduction__eyebrow">Same 14-turn hotel workflow</p>
<h3 id="line-reduction-title">One conversation, built twice.</h3>
<p class="line-reduction__label">Application-owned workflow/runtime code</p>
</div>
<div class="line-reduction__headline">
<strong>65.8%</strong>
<span>less code</span>
<small>618 vs. 1,809 lines</small>
</div>
</div>
<div class="line-reduction__stats">
<div class="line-reduction__stat line-reduction__stat--picoflow">
<span>PicoFlow</span>
<strong>618</strong>
<small>flow and step lines</small>
</div>
<div class="line-reduction__stat line-reduction__stat--langgraph">
<span>Direct LangGraph</span>
<strong>1,809</strong>
<small>graph, state, type, and store lines</small>
</div>
</div>
<div class="line-reduction__bars" aria-hidden="true">
<div class="line-reduction__bar line-reduction__bar--picoflow"><span></span></div>
<div class="line-reduction__bar line-reduction__bar--langgraph"><span></span></div>
</div>
<p class="line-reduction__note">Application-owned workflow/runtime scope; framework source, tests, prompts, catalog assets, and domain helpers excluded on both sides.</p>
</section>

| Application-owned workflow/runtime file | PicoFlow | Lines | Direct LangGraph | Lines |
| --- | --- | ---: | --- | ---: |
| Flow or graph implementation | `hotel-flow.ts` | 64 | `hotel-langgraph.ts` | 1,374 |
| Search stage | `explore-step.ts` | 178 | Custom session store | 312 |
| Present stage | `present-step.ts` | 183 | State channels | 97 |
| Compare stage | `compare-step.ts` | 193 | Supporting types | 26 |
| **Total** | **Four Flow/Step files** | **618** | **Graph, store, state, and types** | **1,809** |

For this boundary, the PicoFlow implementation has **1,191 fewer lines**: approximately
**65.8% fewer application-owned workflow/runtime lines**. The number does not measure runtime
performance, quality, delivery time, or every LangGraph application. It makes visible which
conversation infrastructure this direct implementation owns locally.

The direct version includes more hotel-specific defensive validation in its current source. The
PicoFlow runtime supplies reusable lifecycle behavior such as session locking, revision checks,
tool dispatch, and a Step-level response-acceptance hook; HotelFlow has not exercised every one
of those seams. Treat the source and tests below as the evidence, rather than inferring a
universal winner from the line count.

## Evidence to inspect

- [One turn, traced twice](/docs/resources/one-turn-traced-twice/) follows the same comparison
  request through both implementations, from HTTP input to the rendered hotel table.
- [Tool loops and validation](/docs/resources/tool-loops-and-validation/) separates the direct
  implementation's manual dispatch and validation from the reusable PicoFlow runner behavior.
- [Reliability and production gaps](/docs/resources/reliability-and-production-gaps/) documents
  observed session races, error records, history growth, and external-effect risks on both sides.
- [Testing and evaluation](/docs/resources/testing-and-evaluation/) explains what the shared
  14-turn scenario proves, the direct graph's deterministic test seam, and the remaining gaps.

## What this benchmark can support

It supports a focused discussion of this application's decomposition, source ownership, test
seams, and operational gaps. It does not replace the architectural decision: choose PicoFlow
when a portfolio benefits from a shared application-session and lifecycle convention; choose
direct LangGraph when graph topology, reducers, checkpoint behavior, or scheduler-level control
need to remain the primary application model.
