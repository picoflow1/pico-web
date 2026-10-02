---
layout: layouts/ezgraph.njk
title: Models, retries, and error handling | EZGraph
description: Validate model candidates, configure retries, handle blocked responses, and recover with a temporary alternate model.
permalink: /ezgraph/docs/developer-guide/models-and-error-handling/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# Models, retries, and error handling

Validate model candidates, configure retries, handle blocked responses, and recover with a temporary alternate model.

## Error handling

`LlmNode` owns response validation and model-error policy in conversational,
nested, sequential, and parallel execution. Its three
error hooks also exist on `BaseGraph`, so a node can handle a failure locally or
delegate it to a graph-wide default.

Input preparation happens first through the node-only
[`onEnter()` hook](/ezgraph/docs/developer-guide/nodes-and-execution/#prepare-input-with-onenter).
It runs once on agent-loop entry; retries and temporary alternate-model
recovery reuse its prepared input. An entry-hook error propagates directly
without invoking model-error recovery.

| Hook | Called for | Return value |
| --- | --- | --- |
| `checkResponse(candidate)` | A non-empty, unblocked model candidate, before text acceptance or tool dispatch. The candidate is the raw `AIMessage`. | `true` rejects and retries; `false` accepts. This hook is node-only. |
| `onLlmBlocked(context)` | A thrown prompt block or a blocked candidate, including candidates containing text or tool calls. | Fixed text or a response builder handles the block; `null` delegates. |
| `shouldRetryLlmError(context)` | A thrown model invocation error. | `false` stops retries immediately; `true` allows retries within the configured budget; `undefined` delegates. |
| `onLlmError(context)` | A terminal invocation error, an exhausted empty response, or an exhausted rejected response. | Fixed text, a response builder, or `retryWithModel()` recovers; `null` delegates. |

For `onLlmBlocked()` and `onLlmError()`, EZGraph calls the node first, then the
graph only when the node returns `null`. If both return `null`, the failure
propagates. An unhandled block throws `LlmResponseBlockedError`.

For `shouldRetryLlmError()`, EZGraph calls the node first, then the graph only
when the node returns `undefined`. If both delegate, the configured retry
budget applies. Returning `true` never increases that budget.

### Validate candidates before tools run

A rejected or blocked candidate is never accepted into conversation history,
and its proposed tools never run. `checkResponse()` receives the complete AI
message, so validation can inspect both text and tool calls. It is not called
for thrown invocation errors, empty responses, or blocks.

For example, a collector can reject partial output that hit a token cap:

```ts
import { AIMessage } from "@langchain/core/messages";
import {
  LlmNode,
  direct,
  modelStopReason,
  type LlmBlockedContext,
  type LlmBlockedResponse,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";
import type { QuoteGraphStateType } from "../quote-graph.state.js";

export class DriverNode extends LlmNode<QuoteGraphStateType> {
  getPrompt(): string {
    return "Collect the driver's identity and licence details.";
  }

  override checkResponse(candidate: string | object): boolean {
    return AIMessage.isInstance(candidate)
      && modelStopReason(candidate).category === "truncated";
  }

  override async onLlmBlocked(
    _context: LlmBlockedContext,
  ): Promise<LlmBlockedResponse | null> {
    return direct("I cannot help with that request.");
  }

  override async onLlmError(
    context: LlmErrorContext,
  ): Promise<LlmErrorResponse | null> {
    if (context.kind === "response_rejected") {
      return direct("I could not complete the response. Please try again.");
    }
    return null; // Delegate other terminal failures to the graph.
  }
}
```

`MAX_TOKENS` and other token-cap reasons are not safety blocks. Partial text can
be accepted unless `checkResponse()` rejects it. An empty truncated response
enters `onLlmError()` without a corrective nudge. Provider refusals bypass
`checkResponse()`, ordinary retries, and `onLlmError()`; they enter
`onLlmBlocked()` instead.

### Set retry and graph-wide recovery policy

`params.retries` counts **additional** retries: `retries: 2` allows three
attempts for invocation errors or rejected candidates. `LlmNode`'s
runner supplies `retries: 0` to each gateway call and owns the retries itself,
so SDK retries cannot hide failures from your hooks. Retried invocations and
rejected candidates wait 500 ms between attempts.

A node or graph can stop invocation retries for an error it considers terminal.
The following override uses the numeric HTTP status when the gateway exposes
one, and delegates every other case:

```ts
import type { LlmAttemptErrorContext } from "@picoflow/ezgraph";

// Inside a LlmNode or BaseGraph subclass.
override shouldRetryLlmError(
  context: LlmAttemptErrorContext,
): boolean | undefined {
  const error = context.error as Error & { status?: number };
  if ([400, 401, 403].includes(error.status ?? 0)) return false;
  return undefined;
}
```

A graph-wide recovery override can give delegated failures a consistent reply:

```ts
import {
  direct,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";

// Inside your BaseGraph subclass.
override async onLlmError(
  context: LlmErrorContext,
): Promise<LlmErrorResponse | null> {
  if (context.kind === "invocation_error") {
    return direct("The service is unavailable. Please try again later.");
  }
  return direct("I could not produce a complete response. Please try again.");
}
```

Empty candidates keep the graph's `emptyResponseRecovery` policy: by default,
two retries with a corrective nudge. Disabling that policy with `null` skips
nudges and offers the empty result directly to `onLlmError()`. Empty recovery
is bounded by `maxAgentRounds`; model-error and rejection retries occur within
a round. Usage totals include empty and rejected candidates.

### Inspect failure context and choose a response

All error contexts include `nodeId`, `provider`, `model`, and the caller's
`signal` when supplied. The remaining fields distinguish the failure:

| Context | Additional fields |
| --- | --- |
| `LlmAttemptErrorContext` | `error`, one-based `attempt`, and `maxAttempts`. |
| `LlmErrorContext` | `error`, `attemptsMade`, `maxAttempts`, `kind`, and `stoppedBecause`. `kind` is `invocation_error`, `empty_response`, or `response_rejected`; the latter two retain `lastResponse`. Invocation errors stop because retries were declined or attempts were exhausted. |
| `LlmBlockedContext` | Normalized `reason`, provider `rawReason`, `phase` (`prompt` or `candidate`), and optional `safetyRatings` and `providerDetails`. |

Recovery can return a string or `direct()`, `directTo()`, `go()`, or `finish()`.
These use the same routing, target-state, and completion contracts as ordinary
conversational node responses. `taskResult(value)` recovers with typed,
code-owned output and delivers it to `onResponse()`.
`stay()`, tool feedback, attachments, and cleanup are tool-only and cannot
be returned by an error hook.

Internal recovery obeys the same ownership rules as normal worker output:
return fixed text, `direct()`, or `taskResult()`, not conversational routing or
completion. For example, a worker's `onLlmError()` can return a domain-specific
fallback for its output handler to save:

```ts
return taskResult({ summary: "Analysis unavailable", confidence: 0 });
```

The same node-first, graph-on-delegation precedence applies inside nested calls
and parallel branches. Recovery supplies accepted output to `onResponse()`;
it does not give a worker permission to change `currentNode`, graph context,
conversation history, or another node's state. Cancellation and unrecovered
failures still propagate to the caller.

Cancellation is checked before, between, and after hooks, as well as during
retry delays. A canceled turn cannot return fallback content. A thrown hook
exception propagates without calling the graph fallback. Setup failures,
tool-handler failures, and agent-round-limit errors also propagate outside
ordinary model recovery. Custom gateways should use `LlmSetupError` for
configuration or tool-binding failures and honor the supplied retry and
cancellation policy.

### Recover with one temporary alternate model

Return `retryWithModel()` from `LlmNode.onLlmError()` or
`BaseGraph.onLlmError()` to continue the active node with another model after
terminal failure. The helper validates the selected model and parameters
immediately; `LlmRunner` also validates manually constructed recovery results
before calling the gateway. Use EZGraph's `ModelCatalog.model(...)` configuration
format, and configure credentials for both providers.

This node tries an alternate provider after an invocation error, exhausted
empty responses, or rejected candidates on its primary model. If the alternate
also fails, it returns a fixed reply:

```ts
import {
  LlmNode,
  ModelCatalog,
  direct,
  retryWithModel,
  type GraphState,
  type LlmErrorContext,
  type LlmErrorResponse,
} from "@picoflow/ezgraph";

export class FallbackSupportNode extends LlmNode<GraphState> {
  getPrompt(): string {
    return "Help the customer with their request.";
  }

  override getLlmConfig() {
    return ModelCatalog.model("openai:gpt-5.4", { retries: 2 });
  }

  override async onLlmError(
    context: LlmErrorContext,
  ): Promise<LlmErrorResponse | null> {
    if (context.model === "openai:gpt-5.4") {
      return retryWithModel(ModelCatalog.model(
        "anthropic:claude-sonnet-4-5",
        { retries: 0 },
      ));
    }
    return direct("The service is unavailable. Please try again later.");
  }
}
```

To limit fallback to invocation errors, also check
`context.kind === "invocation_error"`. Return `null` to offer an unhandled
failure to the graph instead of returning a fixed reply.

The alternate remains active through tool follow-up and receives one attempt
per model call, regardless of its configured `params.retries`. It uses the
existing prompt, tools, conversation history, request signal, and per-call
timeout. Its failure context identifies the alternate provider and model,
with `maxAttempts: 1`; an empty alternate response gets no corrective nudge.
The hook can return an ordinary response or transition, or return `null` to
delegate. A second `retryWithModel()` in the same recovery sequence is rejected.

The selection is temporary: it is not saved as the node's configured model,
and a later user turn starts with the usual graph/node model selection.
Provider blocks continue through `onLlmBlocked()`, which cannot request an
alternate model. Cancellation propagates without starting another recovery or
returning fallback content.

Completed tool effects and their feedback remain in place during recovery;
EZGraph does not rerun those handlers. A newly generated tool call still
executes normally, so deterministic code should make durable side effects
idempotent. Use saved node state to decide whether recovery should offer a
fixed reply, hand off, or try another model.

These hooks apply to `LlmNode`'s shared loop in every execution placement.
Plain `GraphNode.runLlm()` calls use `onEmptyModelResponse()`; direct gateway calls
and typed `DecisionNode` validation use their own contracts.
