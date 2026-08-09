---
title: What is PicoFlow
eyebrow: Get started
lede: PicoFlow is a framework for building durable, multi-turn LLM workflows out of explicit steps, typed tools, and one versioned session document.
source: pf/README.md
---

PicoFlow turns a conversation into a small number of named stages. Each stage is a
`Step` class that owns its own prompt, its own tool definitions, its own typed state,
and its own slice of conversation memory. A `Flow` registers those steps, declares a
default model, and binds the whole thing to exactly one persisted session document.

PicoFlow provides graph-level orchestration without requiring an application to be modelled as
a graph. `Step` code can compose nested, sequential, parallel, and tool-driven work through
the normal program stack. Its strongest opinion is the durable contract for long-running,
resumable conversations that teams must read, extend, and debug months later.

## What it is for

Use PicoFlow when your workflow has these properties:

- **It spans many turns.** The user answers, leaves, and comes back tomorrow.
- **It must survive a restart.** Progress lives in a database, not in process memory.
- **It calls tools that matter.** Bookings, payments, record updates — things you
  cannot let a model retry blindly.
- **It has stages.** Collecting search criteria is a different job from presenting
  results, which is a different job from confirming a purchase.

If you need only a single stateless prompt-and-response call, PicoFlow may be more machinery
than you need. PicoFlow also supports one-turn stack-based orchestration; choose a graph-first
library when your team specifically wants to own graph topology, reducers, and checkpointing
directly.

## Architecture

```text
Flow -> registered Step -> prompt, tools, typed state, and memory
                      -> go(...) / stay(...) / direct(...)
                      -> one versioned session document
```

Three ideas carry most of the weight.

### Domain-oriented steps

A `Step` is the unit of customization. It is a class, so it has a name that appears in
stack traces, a file you can open, and methods you can override. The step boundary is
also the persistence boundary: `flow.currentStep` names the step that will handle the
next user turn, and it is the only durable conversation cursor.

### Explicit transitions

Handlers return a transition value rather than mutating a shared graph:

- `go(TargetStep)` advances to another registered step.
- `stay("feedback")` keeps the current step active and hands corrective text back to
  the model. Valid only inside a tool handler.
- `direct(content)` returns content to the caller without another model call.

Because the transition is a return value, control flow is visible in the same function
as the validation that decided it.

### Shared agent and tool runtime

Tool definitions are Zod schemas gathered into one flow-wide registry. A step selects
which of them the model may call, and decorates a method with `@Tool` to handle the
call. The model never decides routing; the handler does.

## What is in this documentation

<div class="cards">
	<a class="card" href="/docs/get-started/installation/">
		<span class="card__title">Installation</span>
		<span class="card__body">Install <code>@picoflow/core</code>, set a license key, and understand the ESM requirement.</span>
	</a>
	<a class="card" href="/docs/get-started/first-flow/">
		<span class="card__title">Your first flow</span>
		<span class="card__body">A working flow, step, provider registration, and HTTP call.</span>
	</a>
	<a class="card" href="/docs/concepts/">
		<span class="card__title">Concepts</span>
		<span class="card__body">The mental model: lifecycle, routing, and the four kinds of data.</span>
	</a>
	<a class="card" href="/docs/tutorials/">
		<span class="card__title">Tutorials</span>
		<span class="card__body">Four tracks built line by line from the flows in <code>picoflow-demo/src/myflow</code>.</span>
	</a>
</div>

## License

PicoFlow is proprietary. A license key is required at runtime; see
[Installation](/docs/get-started/installation/).
