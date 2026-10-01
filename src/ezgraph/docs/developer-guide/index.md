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
one-request extraction workflows and multi-turn chat.
Each graph node owns its prompt, tools, state writes, and transition decision.
LangGraph owns execution; EZGraph supplies the contracts that keep a conversation
resumable and auditable.

The current API has one rule worth remembering:

> A tool handler writes durable state itself, then returns `go`, `stay`, `direct`, `directTo`, or `finish`.

Read the guide by topic. Start with [Nodes and execution](/ezgraph/docs/developer-guide/nodes-and-execution/), or use [the first-graph tutorial](/ezgraph/tutorial/) for a small complete example.

## Nodes and execution

Choose node base classes, define the node contract, and use LlmRunner for custom execution.

[Read this topic →](/ezgraph/docs/developer-guide/nodes-and-execution/)

- <a id="the-node-contract" href="/ezgraph/docs/developer-guide/nodes-and-execution/#the-node-contract">The node contract</a>
- <a id="choose-a-node-base-class" href="/ezgraph/docs/developer-guide/nodes-and-execution/#choose-a-node-base-class">Choose a node base class</a>
- <a id="llmrunner-and-custom-execution" href="/ezgraph/docs/developer-guide/nodes-and-execution/#llmrunner-and-custom-execution">LlmRunner and custom execution</a>

## State, context, and history

Choose the initial node, route history, and manage durable node state and graph context.

[Read this topic →](/ezgraph/docs/developer-guide/state-context-and-history/)

- <a id="initial-node-and-history-routing" href="/ezgraph/docs/developer-guide/state-context-and-history/#initial-node-and-history-routing">Initial node and history routing</a>
- <a id="graph-wide-runtime-context" href="/ezgraph/docs/developer-guide/state-context-and-history/#graph-wide-runtime-context">Graph-wide runtime context</a>
- <a id="state-belongs-to-the-node-that-owns-it" href="/ezgraph/docs/developer-guide/state-context-and-history/#state-belongs-to-the-node-that-owns-it">State belongs to the node that owns it</a>

## Tool responses and transitions

Return go, stay, direct, directTo, or finish and pass state or messages to the next node.

[Read this topic →](/ezgraph/docs/developer-guide/tool-responses/)

- <a id="return-one-direct-tool-response" href="/ezgraph/docs/developer-guide/tool-responses/#return-one-direct-tool-response">Return one direct tool response</a>

## Models, retries, and error handling

Validate model candidates, configure retries, handle blocked responses, and recover with a temporary alternate model.

[Read this topic →](/ezgraph/docs/developer-guide/models-and-error-handling/)

- <a id="error-handling" href="/ezgraph/docs/developer-guide/models-and-error-handling/#error-handling">Error handling</a>
- <a id="validate-candidates-before-tools-run" href="/ezgraph/docs/developer-guide/models-and-error-handling/#validate-candidates-before-tools-run">Validate candidates before tools run</a>
- <a id="set-retry-and-graph-wide-recovery-policy" href="/ezgraph/docs/developer-guide/models-and-error-handling/#set-retry-and-graph-wide-recovery-policy">Set retry and graph-wide recovery policy</a>
- <a id="inspect-failure-context-and-choose-a-response" href="/ezgraph/docs/developer-guide/models-and-error-handling/#inspect-failure-context-and-choose-a-response">Inspect failure context and choose a response</a>
- <a id="recover-with-one-temporary-alternate-model" href="/ezgraph/docs/developer-guide/models-and-error-handling/#recover-with-one-temporary-alternate-model">Recover with one temporary alternate model</a>

## Graph topology and deterministic policy

Build graph edges explicitly and keep validation, authorization, and commit decisions in code.

[Read this topic →](/ezgraph/docs/developer-guide/topology/)

- <a id="build-topology-explicitly" href="/ezgraph/docs/developer-guide/topology/#build-topology-explicitly">Build topology explicitly</a>
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
