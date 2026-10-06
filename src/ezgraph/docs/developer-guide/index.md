---
layout: layouts/ezgraph.njk
title: Developer guide | EZGraph
description: Explore EZGraph node contracts, state, tool responses, model recovery, topology, decision nodes, attachments, and testing.
permalink: /ezgraph/docs/developer-guide/
ezgraph: true
ezgraphDocument: true
ezgraphGuide: true
---

# EZGraph developer guide

EZGraph is a TypeScript layer for durable LangGraph applications, including
one-request extraction workflows, multi-turn chat, and internal model work.
Use the same `LlmNode` for conversation, nested calls, and sequential or parallel
workers. Each node owns its prompt, tools, configuration, entry/response/error hooks,
and local state; its graph or caller owns execution and continuation.
LangGraph owns execution; EZGraph supplies the contracts that keep a conversation
resumable and auditable.

The node contract has one rule worth remembering:

> A node saves the state it owns, then returns an outcome permitted by its execution placement.

Conversational handlers select replies, transitions, or completion. Internal
workers save accepted output in `onResponse()` and leave continuation to their
caller. `await this.runNode(Child1Node, Child2Node)` returns child results to the
parent's current method. `fanout(Child1Node, Child2Node)` selects concurrent
graph branches; an explicit array-source edge joins them before the next stage.

Read the guide by topic. Start with [Nodes and execution](/ezgraph/docs/developer-guide/nodes-and-execution/), or use [the first-graph tutorial](/ezgraph/tutorial/) for a small complete example.

## Nodes and execution

Use one LlmNode contract for conversation, batch input, nested calls, and parallel work, with shared entry, response, and error hooks.

[Read this topic →](/ezgraph/docs/developer-guide/nodes-and-execution/)

- <a id="the-node-contract" href="/ezgraph/docs/developer-guide/nodes-and-execution/#the-node-contract">The node contract</a>
- <a id="choose-a-node-base-class" href="/ezgraph/docs/developer-guide/nodes-and-execution/#choose-a-node-base-class">Choose a node base class</a>
- <a id="prepare-input-with-onenter" href="/ezgraph/docs/developer-guide/nodes-and-execution/#prepare-input-with-onenter">Prepare input with onEnter</a>
- <a id="handle-accepted-output-with-onresponse" href="/ezgraph/docs/developer-guide/nodes-and-execution/#handle-accepted-output-with-onresponse">Handle accepted output with onResponse</a>
- <a id="execution-ownership" href="/ezgraph/docs/developer-guide/nodes-and-execution/#execution-ownership">Execution ownership</a>
- <a id="await-registered-children-with-runnode" href="/ezgraph/docs/developer-guide/nodes-and-execution/#await-registered-children-with-runnode">Await registered children with runNode</a>
- <a id="nested-calls" href="/ezgraph/docs/developer-guide/nodes-and-execution/#nested-calls">Nested calls</a>
- <a id="llmrunner-and-custom-execution" href="/ezgraph/docs/developer-guide/nodes-and-execution/#llmrunner-and-custom-execution">LlmRunner and custom execution</a>

## State, context, and history

Choose the initial node, route history, and manage durable node state and graph context.

[Read this topic →](/ezgraph/docs/developer-guide/state-context-and-history/)

- <a id="initial-node-and-history-routing" href="/ezgraph/docs/developer-guide/state-context-and-history/#initial-node-and-history-routing">Initial node and history routing</a>
- <a id="graph-wide-runtime-context" href="/ezgraph/docs/developer-guide/state-context-and-history/#graph-wide-runtime-context">Graph-wide runtime context</a>
- <a id="state-belongs-to-the-node-that-owns-it" href="/ezgraph/docs/developer-guide/state-context-and-history/#state-belongs-to-the-node-that-owns-it">State belongs to the node that owns it</a>

## Tool responses and transitions

Choose conversational responses, conditional fan-out, or typed task output, and attach explicit state, messages, and usage.

[Read this topic →](/ezgraph/docs/developer-guide/tool-responses/)

- <a id="return-one-direct-tool-response" href="/ezgraph/docs/developer-guide/tool-responses/#return-one-direct-tool-response">Return one direct tool response</a>
- <a id="fan-out-response-effects" href="/ezgraph/docs/developer-guide/tool-responses/#fan-out-response-effects">Fan-out response effects</a>
- <a id="typed-task-output" href="/ezgraph/docs/developer-guide/tool-responses/#typed-task-output">Typed task output</a>

## Models, retries, and error handling

Validate model candidates, configure retries, handle blocked responses, and recover with a temporary alternate model.

[Read this topic →](/ezgraph/docs/developer-guide/models-and-error-handling/)

- <a id="error-handling" href="/ezgraph/docs/developer-guide/models-and-error-handling/#error-handling">Error handling</a>
- <a id="validate-candidates-before-tools-run" href="/ezgraph/docs/developer-guide/models-and-error-handling/#validate-candidates-before-tools-run">Validate candidates before tools run</a>
- <a id="set-retry-and-graph-wide-recovery-policy" href="/ezgraph/docs/developer-guide/models-and-error-handling/#set-retry-and-graph-wide-recovery-policy">Set retry and graph-wide recovery policy</a>
- <a id="inspect-failure-context-and-choose-a-response" href="/ezgraph/docs/developer-guide/models-and-error-handling/#inspect-failure-context-and-choose-a-response">Inspect failure context and choose a response</a>
- <a id="recover-with-one-temporary-alternate-model" href="/ezgraph/docs/developer-guide/models-and-error-handling/#recover-with-one-temporary-alternate-model">Recover with one temporary alternate model</a>

## Graph topology and deterministic policy

Register conversation ownership, schedule internal LLM work, and use conditional fan-out with an explicit join.

[Read this topic →](/ezgraph/docs/developer-guide/topology/)

- <a id="build-topology-explicitly" href="/ezgraph/docs/developer-guide/topology/#build-topology-explicitly">Build topology explicitly</a>
- <a id="conditional-fan-out-and-join" href="/ezgraph/docs/developer-guide/topology/#conditional-fan-out-and-join">Conditional fan-out and join</a>
- <a id="await-children-with-runnode" href="/ezgraph/docs/developer-guide/topology/#await-children-with-runnode">Await children with runNode</a>
- <a id="runnode-versus-fanout" href="/ezgraph/docs/developer-guide/topology/#runnode-versus-fanout">runNode versus fanout</a>
- <a id="sequential-and-fixed-entry-workers" href="/ezgraph/docs/developer-guide/topology/#sequential-and-fixed-entry-workers">Sequential and fixed-entry workers</a>
- <a id="keep-policy-deterministic" href="/ezgraph/docs/developer-guide/topology/#keep-policy-deterministic">Keep policy deterministic</a>

## Decision nodes

Declare decision questions, route typed answers in code, and configure Jev providers, fallbacks, and usage.

[Read this topic →](/ezgraph/docs/developer-guide/decision-nodes/)

- <a id="decision-nodes-with-jev" href="/ezgraph/docs/developer-guide/decision-nodes/#decision-nodes-with-jev">Decision nodes with Jev</a>
- <a id="declare-questions-then-route-in-code" href="/ezgraph/docs/developer-guide/decision-nodes/#declare-questions-then-route-in-code">Declare questions, then route in code</a>
- <a id="what-jev-receives" href="/ezgraph/docs/developer-guide/decision-nodes/#what-jev-receives">What Jev receives</a>
- <a id="configure-and-register-the-provider" href="/ezgraph/docs/developer-guide/decision-nodes/#configure-and-register-the-provider">Configure and register the provider</a>
- <a id="failures-retries-and-fallbacks" href="/ezgraph/docs/developer-guide/decision-nodes/#failures-retries-and-fallbacks">Failures, retries, and fallbacks</a>
- <a id="usage-and-audit" href="/ezgraph/docs/developer-guide/decision-nodes/#usage-and-audit">Usage and audit</a>
- <a id="porting-a-picoflow-decisionstep" href="/ezgraph/docs/developer-guide/decision-nodes/#porting-a-picoflow-decisionstep">Porting a PicoFlow DecisionStep</a>

## Attachments and testing

Handle temporary file attachments and verify graphs with deterministic tests and opt-in provider evaluation.

[Read this topic →](/ezgraph/docs/developer-guide/attachments-and-testing/)

- <a id="file-attachments" href="/ezgraph/docs/developer-guide/attachments-and-testing/#file-attachments">File attachments</a>
- <a id="test-in-two-tiers" href="/ezgraph/docs/developer-guide/attachments-and-testing/#test-in-two-tiers">Test in two tiers</a>
- <a id="verify-internal-work-and-fan-out" href="/ezgraph/docs/developer-guide/attachments-and-testing/#verify-internal-work-and-fan-out">Verify internal work and fan-out</a>
