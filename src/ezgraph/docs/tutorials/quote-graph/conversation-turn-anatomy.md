---
layout: layouts/ezgraph.njk
title: 3. Anatomy of a conversation turn
description: Follow one QuoteGraph turn from the customer's message through the engine, the node, the agent loop, tool validation, the handler, and two checkpoints to the reply.
permalink: /ezgraph/docs/tutorials/quote-graph/conversation-turn-anatomy/
ezgraph: true
ezgraphDocument: true
templateEngineOverride: md
---

# 3. Anatomy of a conversation turn

A `ConversationNode` is a prompt, some tool definitions, and some handlers. Everything else, from
loading the session to saving it again, is framework code. This lesson follows turn 3 of the live
replay through all of it. It is a good turn to follow because one message crosses a stage
boundary: `DriverNode` saves the driver, and `VehicleNode` writes the reply.

## The goal

- Know what the engine does before and after your node runs.
- Understand the agent loop: rounds, tool batches, and when it stops.
- Know what happens to tool arguments before a handler sees them.
- Know what each response builder does to the turn.
- Understand why a failure late in a turn does not lose work done earlier in it.

## The turn at a glance

The customer has given a name and birth date, and now sends "Licensed in Oregon, valid license,
for about 10 years."

| Step | Who | What happens |
| --- | --- | --- |
| 1 | `GraphEngine` | Takes the session's turn lease, loads the document, and runs `onRestoreSessionDoc()` |
| 2 | `BaseGraph.prepareInput()` | Appends the message to the history space of the current node, `quote-intake` |
| 3 | START branch | Reads `currentNode: "DriverNode"` and enters `DriverNode` |
| 4 | `ConversationRunner` | Calls the model with `DriverNode`'s prompt, the intake history, and its tools |
| 5 | `GraphNode.handleTool()` | Validates the `capture_driver` arguments against the Zod schema |
| 6 | your handler | Checks business rules, calls `saveState({ driver })`, returns `go(VehicleNode)` |
| 7 | `ConversationNode` | Turns `go()` into a LangGraph `Command` targeting `VehicleNode` |
| 8 | `GraphEngine` | Checkpoints the completed step |
| 9 | `VehicleNode` | Runs in the same turn; its model writes the reply |
| 10 | `GraphEngine` | Checkpoints again, saves the final state, releases the lease, and returns the reply |

## Before the node: engine and input

`GraphEngine.run()` owns the request boundary. It takes an exclusive lease on the session, so a
second message for the same session gets `SESSION_BUSY` instead of racing this one. Then it loads
the document and calls the graph's restore policy; for QuoteGraph that is the idle check in
[lesson 7](/ezgraph/docs/tutorials/quote-graph/sessions-and-history/). Finally it prepares the input:

```ts
const graphInput = {
  ...graph.prepareInput(oldState, new HumanMessage(userMessage)),
  config: { ...(oldState?.config ?? {}), ...(input.config ?? {}) },
  inputConsumed: false,
  response: "",
};
```

`prepareInput()` appends the customer's message to the history space of the persisted
`currentNode`. `inputConsumed: false` and an empty `response` reset the per-turn fields. The
START branch built by `registerTurnNodes()` then enters the node named by `currentNode`.

## Inside the node: the agent loop

`ConversationNode.run()` hands the work to `ConversationRunner`, the one agent loop every
conversational node shares. It passes:

- the system prompt from `getPrompt(state)`;
- this node's history space, including the new message;
- the tools this node handles with `@Tool`, with `terminate_session` sorted last;
- the model configuration: the graph default, merged with the node's `getLlmConfig()`.

Each round is one model call. What happens next depends on the reply:

| The model returns | The loop |
| --- | --- |
| text, and no tool calls | stops; the text is the node's reply |
| one or more tool calls | runs every call in order, adds a tool message for each, then stops if any handler returned something other than `stay()`, or starts another round |
| nothing at all | nudges the model with an internal message and retries, twice by default, then calls `onEmptyModelResponse()` |

A node gets eight rounds per invocation by default (`maxAgentRounds`). A model that keeps
calling tools without finishing makes the loop throw, which fails the turn instead of
spending money forever. If the history space is empty when a node starts, the runner seeds it
with an internal `"Start"` message, because some providers reject a request with no messages.

On turn 3, round one returns a single `capture_driver` call.

## Tool arguments: validated before your handler runs

`handleTool()` sits between the model and your method:

1. It finds the method decorated with `@Tool("capture_driver")`.
2. It parses the arguments if the provider sent them as a JSON string.
3. It validates them with the tool's Zod schema.
4. If either step fails, the model gets `{ "accepted": false, "error": "yearsLicensed: Invalid input: expected number, received string" }`
   as the tool result, a warning is logged, and your handler never runs.
5. Otherwise the handler receives the *parsed* value, so defaults, transforms, and stripped
   unknown keys have already been applied.

The handler signature is `(input, context, state)`. `input` is the parsed arguments. `state` is
the graph state as it was when this node started. To see writes staged earlier in the same
invocation, call `this.graph.graphState()` instead. `CoverageNode` and `QuoteNode` use
`graphState()` for exactly that reason.

## The handler: rules, a write, and a transition

```ts
@Tool("capture_driver")
async captureDriver(input: DriverInput): Promise<ToolResponse> {
  const licenseState = input.licenseState.toUpperCase();
  if (!US_STATE_CODES.has(licenseState)) {
    return reject(`'${input.licenseState}' is not a U.S. state code.`);
  }
  // ... suspended licence, real date, age 16–100, plausible years licensed ...
  this.saveState({ driver });
  return go(VehicleNode);
}
```

`saveState()` does not write to the database. It stages a patch to this node's channel, and
EZGraph applies the whole channel when the node's step completes. `go(VehicleNode)` is a plain
value, not a call that moves anything yet. The loop records a tool message whose content is the
response's feedback, or `"OK"` when there is none, and then stops, because `go()` is not `stay()`.

## From builder to Command

`ConversationNode` turns the handler's response into a LangGraph update:

| Response | `currentNode` becomes | `response` | Then |
| --- | --- | --- | --- |
| text reply (no tool) | this node | the text | the turn ends |
| `stay(feedback)` | — | — | the feedback goes back to the model and the loop continues |
| `go(Target)` | `Target` | empty | `Target` runs immediately |
| `direct(text)` | this node | `text` | the turn ends; no further model call |
| `directTo(Target, text)` | `Target` | `text` | the turn ends; `Target` handles the next message |
| `finish(text)` | `end` | `text` | the graph completes |

Every update also appends this node's new messages to its history space and adds the round's
token usage to `state.tokens`. For `go()`, any `withState()` patch is saved to the target's
channel and any `withMessage()` is appended to the target's history space.

Several tool calls in one model message are allowed. Each gets its own tool message; any
transition wins over `stay()`; and two *different* transitions in one batch throw, because the
graph cannot go two places at once.

## Two nodes, one turn, two checkpoints

After `DriverNode`'s step completes, LangGraph applies its update: the new `driver` channel, the
history, `currentNode: "VehicleNode"`, and `inputConsumed: true`. The engine sees a step with
`inputConsumed` set and saves a checkpoint of the session.

LangGraph then runs `VehicleNode` with the updated state. Its prompt notices `inputConsumed` and
tells the model to confirm the saved driver before asking about the vehicle.
[Lesson 4](/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/) covers that technique. The
model replies with text, so `VehicleNode` returns `currentNode: "VehicleNode"` with the reply, and
the graph ends the turn. The engine checkpoints again, writes the final state, releases the lease,
and returns:

```json
{ "success": true, "completed": false, "message": "Thanks — I’ve saved Jamie Rivera, born 1993-04-12, … What’s the vehicle’s year, make, and model?" }
```

The first checkpoint matters when something fails. If `VehicleNode`'s model call had timed out, the
turn would fail and the error would be logged on the session, but the driver saved by
`DriverNode` would already be durable, with `VehicleNode` as the resume point. The customer's next
message starts where the graph actually got to.

## Why it is written this way

The framework takes on everything that must be the same for every stage: leases, restore, input
placement, the agent loop and its limits, argument validation, builder semantics, token
accounting, and checkpoints. A stage is left with the parts that are specific to it: what to ask,
what to accept, what to save, and where to go next. That is why QuoteGraph's five stages are each
about a hundred lines, most of them business rules.

## Common mistakes

- **Validating arguments by hand that the schema already checks.** The handler receives parsed,
  schema-valid input; spend handler code on business rules.
- **Reading the `state` parameter after staging writes.** It is the state at node start; use
  `this.graph.graphState()` to see staged writes.
- **Expecting `saveState()` to be a database write.** It is staged and applied with the node's step.
- **Returning two different transitions in one tool batch.** The turn fails; give each tool one
  job.
- **Assuming a failed turn loses everything.** Completed steps are checkpointed; design the next
  turn to resume from them.

## Next

Continue to [4. Prompts and stage handoffs](/ezgraph/docs/tutorials/quote-graph/prompts-and-handoffs/).
