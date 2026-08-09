---
title: Tool loops and validation
eyebrow: Compare
lede: The direct demo implements more hotel-specific checks, while PicoFlow supplies a reusable Step-level acceptance gate that can reject and regenerate any model result before it has effects.
source: picoflow/src/picoflow/flow/llm-runner.ts, picoflow/src/picoflow/flow/step.ts, picoflow/src/picoflow/utils/retry.ts, picoflow/src/picoflow/utils/tool-response.ts, picoflow-demo/src/myflow/hotel-flow/, picoflow-demo/src/myflow/hotel-langgraph/hotel-langgraph.ts
---

Tool calling has four separate responsibilities: tell the model which tools exist, validate the
arguments, execute domain code, and decide whether to call the model again. Saying that both
implementations “use tools” obscures who owns each responsibility.

## Tool declaration and dispatch

In PicoFlow, a step returns `ToolType[]` from `defineTool()` and marks matching methods with
`@Tool`. At bootstrap the framework validates and registers the definitions. During execution
`LlmRunner` matches model tool calls to decorated handlers, invokes them, creates
`ToolMessage`s, applies transitions, and either loops or returns.

The direct implementation creates seven LangChain tools with `tool(...)` and binds stage-
specific arrays to each model. The functions passed to `tool(...)` simply return their input;
the graph never invokes those tool objects. Their practical role is model-facing name,
description, and schema metadata. Actual execution is manual branching inside
`exploreTools`, `presentTools`, and `compareTools`.

```text
model-facing declaration       runtime execution

captureChoicesTool      --->   if call.name === "capture_choices" ...
chosenHotelTool         --->   if call.name === "chosen_hotel" ...
generateComparisonTool  --->   if call.name === "generate_comparison" ...
```

That duplication is not required by LangGraph; a direct application could invoke the tool
objects or use a prebuilt tool node. It is, however, the architecture of the implementation
being measured.

## Loop control

PicoFlow tool outcomes form a small control language:

- `go(Step)` switches stages and normally continues the model loop;
- `stay(feedback)` keeps the current stage and gives corrective tool feedback;
- `direct(content)` returns exact content without another model call;
- `.withState()`, `.withMessage()`, `.withPrompt()`, and `.withContentType()` add effects.

The direct graph expresses the same decisions through state. `route` chooses the next agent or
`end`; `response` carries the eventual HTTP response; `phase` becomes the durable stage; and
message-array updates provide tool feedback.

## Multiple tool calls

PicoFlow's runner walks every returned tool call in order. It also supports an `@Tools`
batch handler when one method must own a multi-call turn. Missing and hallucinated handlers are
converted to tool messages and session warnings.

The direct hotel graph deliberately narrows the policy: `latestToolCall()` chooses
`terminate_session` if present, otherwise the first tool call on the latest AI message. Other
parallel tool calls are ignored. This keeps a hotel stage deterministic, but it should be
enforced at the model binding level or documented as a contract; otherwise a model that emits
two legitimate calls receives only one result.

## A PicoFlow advantage: the Step is the final acceptance gate

The validators below measure what the two hotel demos currently implement. They do not capture
an additional PicoFlow engine capability. Every model invocation runs inside the shared
`Retry.goTry()` loop. After the empty-response check, `LlmRunner` passes the complete model
result to the active step's `checkResponse()` **before** dispatching tool calls or accepting a
normal or structured response.

`checkResponse()` has intentionally inverted acceptance semantics:

```text
false  -> accept this model result
true   -> reject it and invoke the model again
```

This makes the step the last responsible authority over model output. Because the step also
owns the prompt, domain state, memory namespace, and flow context, its decision can be semantic
and state-aware rather than limited to static JSON shape. A step can veto:

- syntactically valid JSON that violates a business invariant;
- an incomplete provider-normalized structured result;
- a prohibited or policy-inconsistent free-form answer;
- a tool call whose arguments conflict with the current step state; or
- output that is technically valid but not good enough to advance the flow.

For example, `ExploreStep` could inspect the raw `capture_choices` call before its handler runs:

```ts
public override checkResponse(result: string | object): boolean {
  const message = result as {
    tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>;
  };
  const call = message.tool_calls?.find(
    ({ name }) => name === "capture_choices",
  );
  if (!call) return false;

  try {
    const criteria = JSON.parse(String(call.args?.json));
    return !isAcceptableCriteria(criteria); // true asks PicoFlow to retry
  } catch {
    return true;
  }
}
```

The direct `HotelLanggraph` has no equivalent application-wide response-acceptance hook. A
non-tool AI response becomes the turn response and routes to `END`; tool arguments are checked
later inside hand-written tool nodes. LangGraph can implement an equivalent validation node,
conditional retry edge, or model-call wrapper, but the application must design its state,
routing, retry accounting, and observability. PicoFlow centralizes that policy behind the
regular `Step` contract.

This produces three complementary validation layers in a well-built PicoFlow flow:

| Layer | Responsibility |
| --- | --- |
| Zod tool or structured schema | Reject the wrong data shape |
| `Step.checkResponse()` | Veto a contextually unacceptable model result before it has effects and regenerate it |
| Tool handler plus `stay(reason)` | Recheck authoritative domain invariants at the side-effect boundary and give explicit corrective feedback |

The middle layer is the distinctive PicoFlow advantage. Automatic schema validation answers
“does this value have the expected shape?” The step acceptance gate answers “given everything
this stage knows right now, is this result worthy of being accepted?”

There are four current caveats. `true` means retry, which is easy to misread; the hook is
synchronous and should be deterministic; rejected attempts still consume and tally model
tokens; and the retry currently reuses the same request history without adding a reason-specific
correction. Use `stay(reason)` when the model needs explicit feedback rather than a fresh
regeneration. The runtime currently passes the raw AI response object for normal/tool output
and the provider-normalized object for structured output, despite the broad `string | object`
signature, so implementations must extract raw message content deliberately. Empty no-tool
responses and invocation or structured-parser exceptions take the engine's own retry path
before this hook. The default limit is three total attempts, and rejected output is not appended
to step memory. When the step—not the provider wrapper—must decide whether raw JSON is
acceptable, it should inspect and parse the response content in `checkResponse()`.

## Domain validation implemented in these demos

The direct graph validates considerably more than the PicoFlow demo:

| Boundary | PicoFlow HotelFlow | Direct HotelLanggraph |
| --- | --- | --- |
| Whole-response acceptance | Framework provides `Step.checkResponse()` veto and retry, but HotelFlow does not override it | No shared acceptance hook in this implementation; non-tool output is accepted and ends the run |
| `capture_choices.json` | Catches parse failure, then dereferences the possibly undefined result | Rejects invalid JSON with tool feedback |
| Dates | Reads start/end and sends them to pricing | Requires both, parses both, requires checkout after check-in |
| Room and amenities values | Trusts submitted arrays | Filters values against the template's allowlists |
| Comparison feature | Any string | Zod enum: price, room type, amenities, or distance |
| Hotels to compare | Trusts names and may produce undefined rows | Deduplicates and rejects names outside current results |
| Booking | Saves the model-provided name | Requires an exact member of current results |
| Confirmation | Number exists only inside a generated terminal prompt | Persists booked hotel and confirmation number |

The direct demo currently implements more hotel-specific checks. Framework-level Zod
validation only proves that an argument has the declared shape; it does not prove that a hotel
exists, a date range is sensible, or a requested item belongs to the current search. Those
invariants still belong in application code. PicoFlow, however, provides the stronger reusable
whole-response acceptance boundary; this HotelFlow simply has not used it yet.

## Where each can fail

The current PicoFlow HotelFlow does not yet use that acceptance gate. Its `capture_choices`
handler catches a JSON parse error and then dereferences the undefined result; other handlers
can accept an invented hotel, an unsupported comparison feature, or build rows containing
`undefined`. These are demo-level validation gaps, not the limit of PicoFlow's lifecycle.
`ExploreStep` could reject malformed or semantically incomplete output in `checkResponse()`
before dispatch and let the engine regenerate it. Handlers should still enforce authoritative
business invariants and return `stay(reason)` when corrective feedback is more useful than a
blind regeneration. If neither layer catches the error, the engine aborts the turn and the user
receives a generic failure.

The direct graph has its own gap: most validation failures route back to the model, but
unexpected exceptions return HTTP 400 without persisting an error record or aborted status.
Its validation also normalizes unsupported room types and amenities by filtering them out;
depending on product policy, silently dropping a value may be worse than explicitly rejecting
it.

## Models and provider boundaries

Both implementations use the same effective stage models: GPT-5.1 with low reasoning effort
for explore and compare, and GPT-4o at temperature 0.5 for presentation.

PicoFlow resolves those selections through a shared model catalog and provider adapters. A flow
declares its default with `configModel()`, and steps override with `useModel()`. The engine
validates supported model parameters during registration and records the effective model in the
session.

The direct graph constructs `ChatOpenAI` instances in `createOpenAiModel()` and binds tools
there. This is straightforward and exposes every provider option immediately. Its
`HotelModelFactory` seam is also excellent for deterministic testing. Supporting another
provider, standardizing retries, or recording model metadata remains application work unless
the team extracts a shared factory.

This is another mixed result: PicoFlow has the stronger portfolio-wide provider contract; the
direct implementation has the cleaner application-level model-test seam.

## The lesson

PicoFlow reduces execution-loop code without taking the validation decision away from the
domain-owning step. Direct LangGraph makes the tool trust boundary visible because the tool node
owns it, but that safety came from implementation effort, not from the graph primitive itself.
The strongest PicoFlow version combines its native response veto/retry hook with the direct
demo's explicit handler validators: less orchestration, contextual last-moment acceptance, and
authoritative checks before side effects.
