---
title: 5. Memory namespaces and expiry
eyebrow: HomeInsuranceQuoteFlow tutorial
lede: The long intake stages share a compacted conversation because corrections cross their seams. Narrow stages get isolated histories or no history at all, and idle sessions refuse to resume after thirty minutes.
source: pico-demo/src/myflow/home-insurance-flow/home-insurance-flow.ts, pico-demo/src/myflow/home-insurance-flow/review-step.ts, pico-demo/src/myflow/home-insurance-flow/present-quote-step.ts
---

Memory is scoped to a namespace, not magically to the entire conversation. The
right scope depends on the job: a customer correcting a roof needs their intake
context; a deterministic rating calculation needs none; an old quote table
should not bleed into a freshly re-rated one.

## The goal

- Share history only where a conversational task crosses step boundaries.
- Compact the one long-running namespace that benefits from it.
- Erase presentation history when a new quote becomes authoritative.
- Reject an idle durable session rather than quietly continuing it.

## One shared intake namespace

The constructor enables summary compaction only for `home-quote-intake`:

```ts
constructor() {
  super();
  this.getMemory()
    .setSummaryModel({ provider: "openai", name: "gpt-4o", retryAttempts: 3 })
    .setSummaryConfig({ minMessages: 12, recentMessages: 6 })
    .enableSummary("home-quote-intake");
}
```

Qualification, property, and risk all call `.useMemory("home-quote-intake")`.
They form one long interview, and a review correction can send the user back to
any of them. After twelve messages, PicoFlow creates a running summary and keeps
the newest six raw messages, so the early location and ownership facts remain
available without making every later prompt grow indefinitely.

## Isolation is a safety property

The remaining conversational stages use distinct namespaces:

| Namespace | Step | Why it is isolated |
| --- | --- | --- |
| `home-quote-coverage` | `CoverageStep` | Coverage choices should not become a general intake transcript. |
| `home-quote-review` | `ReviewStep` | Its authoritative data is injected from step state, not rebuilt from chat history. |
| `home-quote-options` | `PresentQuoteStep` | Old option tables must not mix with a re-rated quote. |
| `home-quote-contact` | `ContactStep` | Consent and contact details remain narrowly scoped. |
| `home-quote-referral` | `ReferralStep` | An ineligible path does not inherit quote-option context. |
| `home-quote-terminal` | `TerminateSessionStep` | The close is a final exchange, separate from the active job. |

`RateQuoteStep` has no `.useMemory(...)` because it is a `LogicStep`. Its input
is four typed state records, and its output is one typed result; no model sees
or needs a rating conversation.

## Start a presentation cleanly

`PresentQuoteStep` clears its own isolated namespace on entry:

```ts
protected async onEnter(): Promise<void> {
  this.eraseMemory();
  const quoteId = this.quoteResult().quoteId;
  if (this.getState<string>("presentedQuoteId") !== quoteId) {
    this.removeState("selectedOption");
    this.saveState({ presentedQuoteId: quoteId });
  }
}
```

This is safe because the input data is not in that history. The prompt injects
the current `quoteResult` on every turn. The same transition also clears
`selectedOption` if the quote ID changed, so a user cannot select Enhanced from
the old deductible's table after a re-rate.

Do not call `eraseMemory()` on a shared namespace unless you intend to clear it
for every step using it. The intake namespace is shared precisely because its
history is useful; the options namespace is isolated precisely because it is not.

## Durable session expiry belongs to the flow

The flow decides whether a stored session may be restored:

```ts
const SESSION_IDLE_MS = 30 * 60_000;

protected async onRestoreSessionDoc(session: SessionType): Promise<SessionType | null> {
  const restored = await super.onRestoreSessionDoc(session);
  if (!restored) return null;
  return this.sessionIdleMs(restored) >= SESSION_IDLE_MS ? null : restored;
}
```

Returning `null` declines restoration. The storage layer loads the durable
document, but the flow owns the business policy: an abandoned preliminary
application should not reappear indefinitely with old data or a stale quote.

## Next

[6. Correct, re-rate, and return](/docs/tutorials/home-insurance-flow/correct-and-rerate/)
uses these state owners and namespaces to handle a roof correction and deductible
change without duplicating or retaining stale data.
