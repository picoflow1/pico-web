---
title: 4. Memory compaction and erasure
eyebrow: HotelFlow tutorial
lede: Criteria collection takes eight or more turns, so its history is summarised as it grows. The presentation and comparison stages take the opposite approach and throw their history away on entry.
source: pico-demo/src/myflow/hotel-flow/hotel-flow.ts, pico-demo/src/myflow/hotel-flow/present-step.ts, pico-demo/src/myflow/hotel-flow/compare-step.ts
---

Long conversations grow their context window until they become slow, expensive,
and unfocused. PicoFlow offers two answers, and HotelFlow uses both in the same
session: rolling summarisation for the stage that genuinely needs its history,
and outright erasure for the stages that do not.

## The goal

- Enable rolling compaction on one memory namespace from the flow constructor.
- Understand `minMessages` and `recentMessages`, and the defaults when you
  configure nothing.
- Know exactly when compaction runs and how the summary reaches the model.
- Use `eraseMemory()` in `onEnter()` for stages that must start clean.

## Configuring compaction

From `pico-demo/src/myflow/hotel-flow/hotel-flow.ts`:

```ts
public constructor() {
  super();

  //configure memory compaction, if no configuration is provided, the default is
  // to summarize after 16 messages, keeping the most recent 8 messages in memory
  this.getMemory()
    .setSummaryModel({ provider: 'openai', name: 'gpt-4o' })
    .setSummaryConfig({ minMessages: 8, recentMessages: 4 })
    .enableSummary('hotel-explore');
}
```

Three chained calls on the flow's `Memory`, each returning `this`:

| Call | Effect |
| --- | --- |
| `setSummaryModel({...})` | Selects the model used to write the summary. Compaction is skipped entirely if this is never set. |
| `setSummaryConfig({ minMessages, recentMessages })` | Sets the threshold and the size of the retained tail. |
| `enableSummary(ns)` | Opts one namespace in. Namespaces are opt-in individually. |

`super()` must run first — it constructs the `Memory` instance that
`getMemory()` returns.

The namespace string has to match the one a step declares. `ExploreStep` is
registered with `.useMemory('hotel-explore')`, which is why that exact string
appears in the constructor. Compaction is configured on the flow because the
`Memory` object is flow-scoped; it is enabled per namespace because summarising
a two-turn presentation stage would be pure overhead.

## What the two numbers mean

From the framework's `Memory` class:

```ts
export type SummaryConfig = {
  /** Compact after this many raw messages, including the system prompt slot. */
  minMessages?: number;
  /** Keep this many newest raw messages verbatim after compaction. */
  recentMessages?: number;
};

export const DEFAULT_SUMMARY_MIN_MESSAGES = 16;
export const DEFAULT_SUMMARY_RECENT_MESSAGES = 8;
```

So a namespace with `enableSummary(ns)` and no `setSummaryConfig(...)`
summarises once its history reaches sixteen messages and keeps the newest
eight. HotelFlow halves both, to eight and four, because `ExploreStep`'s turns
are short question-and-answer exchanges and the useful signal is the
accumulated criteria rather than the wording.

`minMessages` counts the system-prompt slot at index 0. The system prompt is
rewritten on every turn — `getPrompt()` runs each time — so it is never
summarised; compaction always slices from index 1.

The configuration is validated eagerly:

```text
minMessages must be an integer >= 8
recentMessages must be an integer from 1 to (minMessages - 2)
```

The upper bound guarantees there is at least one non-system message left to
summarise. `{ minMessages: 8, recentMessages: 4 }` sits comfortably inside the
recommended range of one quarter to one half of `minMessages`.

## When compaction runs

Not mid-turn. It runs at the end of a turn, as the first thing `saveSession()`
does:

```ts
public async saveSession() {
  await this.compactMemory();
  const flowDoc = this.requireFlowDoc();
  const sessionDoc = this.requireSessionDoc();
  this.memory.writeDoc(flowDoc.memory);
  ...
}
```

`compactMemory()` returns immediately if no summary model is configured, and
wraps the whole operation in a `try`/`catch` that logs a warning:

```text
Memory compaction skipped: <error message>
```

A failing summariser degrades to an uncompacted history rather than failing the
user's turn.

Inside `Memory.compact`, each enabled namespace whose history has reached
`minMessages` is cut at a boundary, the evicted slice is summarised, and the
history is spliced:

```ts
const cut = this.findCompactionBoundary(entry.history);
if (cut <= 1) {
  continue;
}

const evicted = entry.history.slice(1, cut);
```

`findCompactionBoundary` starts at `history.length - recentMessages` and walks
backwards until the cut does not land between an assistant tool call and its
tool result. A tool transaction is never split, because a history containing a
`tool` message with no preceding `tool_calls` is rejected by most providers.

The summariser is not asked to summarise the new slice in isolation. Its system
instruction asks for an **updated cumulative** memory that merges the previous
summary with the newly evicted messages, so facts confirmed twenty turns ago
survive repeated compactions unless something later supersedes them.

## How the summary reaches the model

At request time, if the executing step's namespace has a summary, the runner
inserts it as a second system message rather than editing the history:

```ts
const summary = flow.getMemory().getSummary(step.getMemorySpace());
const requestHistory = summary
  ? [
      systemMessage,
      new SystemMessage({
        content: `Conversation memory for this step:\n${summary}`,
        id: step.genMessageId(),
      }),
      ...history.slice(1),
    ]
  : history;
```

The model therefore sees: the stage prompt, a compact memory block, then the
verbatim recent tail. Nothing else changes — tools, state, and routing are
unaffected by compaction.

## The opposite policy

`PresentStep` and `CompareStep` never enabled summarisation. They do this
instead. From `present-step.ts`:

```ts
protected async onEnter() {
  //switch from active to inactive, erase memory
  this.eraseMemory();
}
```

And identically in `compare-step.ts`:

```ts
protected async onEnter() {
  this.eraseMemory();
}
```

`eraseMemory()` is a protected `Step` method that truncates the namespace's
history array in place:

```ts
protected eraseMemory(): MessageTypes[] {
  const mem = this.flow.getMemory(this.memorySpace);
  mem.length = 0;
  return mem;
}
```

This is safe here only because both steps use their class-name default
namespace. Neither called `.useMemory(...)`, so `PresentStep`'s history is
`PresentStep`'s alone, and erasing it cannot destroy anything `ExploreStep`
needs.

The reason to erase is behavioural. `PresentStep` is re-entered every time the
user comes back from a comparison or a new search, and each entry presents a
*different* result list. Leaving the previous list in history invites the model
to mix old hotel names and old prices into the new presentation. The data it
actually needs is not in the history at all — it is in `hotelFound`, injected
into the prompt as JSON on every turn.

That is the rule of thumb the two policies express:

- History matters, and the stage is long — **summarise**.
- The stage's data lives in state and is re-injected each turn — **erase**.

<div class="callout callout--note"><span class="callout__title">Erasure and summaries are independent</span><p><code>eraseMemory()</code> clears the raw message array. It does not clear a namespace&rsquo;s stored summary, which lives in a separate field of the memory entry. It happens not to matter in HotelFlow, because the two erasing steps never had summarisation enabled — but if you enable both on one namespace, expect the summary to survive the erase and keep being injected.</p></div>

## Why it is written this way

Compaction is a flow-level policy applied to namespaces, not to steps, because
several steps can legitimately share one conversation. Making it opt-in per
namespace means the cost — one extra model call at the end of a qualifying turn
— lands only where it buys something.

Putting `eraseMemory()` in `onEnter()` rather than in a tool handler ties it to
the transition rather than to a particular caller. `PresentStep` is reachable
from `ExploreStep` and from `CompareStep`; both paths get the same clean start
without either handler knowing about it.

One consequence of that placement is worth internalising: `flow.gotoByName`
short-circuits when the target is already the current step.

```ts
const currentStep = this.getCurrentStep();
if (currentStep?.getName() === stepName) return nextStep;
```

So a self-transition — `stay(...)` in `ExploreStep`, or the `direct(...)` in
`CompareStep` — does **not** re-run `onEnter()`. Comparison history therefore
accumulates across repeated comparisons within one visit, and is cleared only
when the user leaves and comes back.

## Common mistakes

- **Calling `enableSummary` for a namespace no step declares.** It silently
  does nothing; the string must match a `.useMemory(...)` argument exactly.
- **Forgetting `setSummaryModel`.** Without it, `compactMemory()` returns
  early and history grows forever.
- **Setting `recentMessages` too close to `minMessages`.** The constructor
  throws if it exceeds `minMessages - 2`.
- **Erasing a shared namespace.** `eraseMemory()` clears the namespace, not the
  step. If two steps share one via `.useMemory(...)`, both lose their history.
- **Expecting `onEnter()` on a self-transition.** It does not fire; the cursor
  never moved.
- **Relying on history to carry data across a transition.** Use state and
  re-inject it into the prompt, which is exactly what `hotelFound` does.

## Next

[5. Branch, forward, and return](/docs/tutorials/hotel-flow/branch-and-return/)
follows the three transitions out of `PresentStep` and shows how a user's
sentence is carried across a step boundary.
