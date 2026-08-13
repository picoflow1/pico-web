/**
 * Single source of truth for the site's information architecture.
 *
 * `tabs`   -> the top row of product-level links in the header.
 * `groups` -> the categories rendered in the left-hand sidebar for that tab.
 *
 * Every `url` here must match a page's permalink exactly (trailing slash
 * included) or the build check in `npm run build` will report a dead link.
 */
export default {
	tabs: [
		{
			key: "get-started",
			label: "Get started",
			url: "/docs/get-started/",
			groups: [
				{
					label: "Introduction",
					items: [
						{ title: "What is PicoFlow", url: "/docs/get-started/" },
						{ title: "Installation", url: "/docs/get-started/installation/" },
						{ title: "Why PicoFlow", url: "/docs/get-started/why-picoflow/" },
					],
				},
				{
					label: "Quickstart",
					items: [
						{ title: "Your first flow", url: "/docs/get-started/first-flow/" },
						{ title: "Run the demo app", url: "/docs/get-started/run-the-demo/" },
						{ title: "Your first request", url: "/docs/get-started/first-request/" },
					],
				},
			],
		},
		{
			key: "concepts",
			label: "Concepts",
			url: "/docs/concepts/",
			groups: [
				{
					label: "Core model",
					items: [
						{ title: "Flows and steps", url: "/docs/concepts/" },
						{ title: "The session document", url: "/docs/concepts/session-document/" },
						{
							title: "Annotated BasicFlow session",
							url: "/docs/concepts/basic-flow-session/",
						},
						{
							title: "One flow per session",
							url: "/docs/concepts/one-flow-per-session/",
						},
					],
				},
				{
					label: "Execution",
					items: [
						{ title: "Flow lifecycle", url: "/docs/concepts/flow-lifecycle/" },
						{ title: "Step lifecycle", url: "/docs/concepts/step-lifecycle/" },
						{ title: "Routing", url: "/docs/concepts/routing/" },
					],
				},
				{
					label: "Data",
					items: [
						{
							title: "State, memory, context, transient",
							url: "/docs/concepts/state-memory-context/",
						},
						{
							title: "Models and providers",
							url: "/docs/concepts/models-and-providers/",
						},
					],
				},
			],
		},
		{
			key: "tutorials",
			label: "Tutorials",
			url: "/docs/tutorials/",
			groups: [
				{
					label: "Overview",
					items: [{ title: "Choose a track", url: "/docs/tutorials/" }],
				},
				{
					label: "BasicFlow \u2014 the complete tour",
					items: [
						{ title: "Track overview", url: "/docs/tutorials/basic-flow/" },
						{
							title: "1. Bootstrapping PicoFlow in NestJS",
							url: "/docs/tutorials/basic-flow/bootstrapping/",
						},
						{
							title: "2. Your first flow",
							url: "/docs/tutorials/basic-flow/first-flow/",
						},
						{
							title: "3. Your first step",
							url: "/docs/tutorials/basic-flow/first-step/",
						},
						{ title: "4. Tools and Zod", url: "/docs/tutorials/basic-flow/tools/" },
						{
							title: "5. Routing with go() and stay()",
							url: "/docs/tutorials/basic-flow/routing/",
						},
						{
							title: "6. Validation belongs in code",
							url: "/docs/tutorials/basic-flow/validation/",
						},
						{
							title: "7. Prompt files and templates",
							url: "/docs/tutorials/basic-flow/prompts/",
						},
						{
							title: "8. Reading another step's state",
							url: "/docs/tutorials/basic-flow/cross-step-state/",
						},
						{
							title: "9. Deterministic LogicStep",
							url: "/docs/tutorials/basic-flow/logic-steps/",
						},
						{
							title: "10. Response-driven steps",
							url: "/docs/tutorials/basic-flow/response-driven-steps/",
						},
						{
							title: "11. Structured output",
							url: "/docs/tutorials/basic-flow/structured-output/",
						},
						{
							title: "12. Nested execution: runStep()",
							url: "/docs/tutorials/basic-flow/nested-runstep/",
						},
						{
							title: "13. Parallel children: runSteps()",
							url: "/docs/tutorials/basic-flow/parallel-runsteps/",
						},
						{
							title: "14. Transient state and context",
							url: "/docs/tutorials/basic-flow/transient-state/",
						},
						{
							title: "15. Memory namespaces and model overrides",
							url: "/docs/tutorials/basic-flow/memory-and-models/",
						},
						{
							title: "16. @Tools batching",
							url: "/docs/tutorials/basic-flow/mcp-and-multi-tool/",
						},
						{
							title: "17. Sessions, migration, batch mode",
							url: "/docs/tutorials/basic-flow/sessions-and-batch/",
						},
						{
							title: "18. Testing a flow end to end",
							url: "/docs/tutorials/basic-flow/testing/",
						},
					],
				},
				{
					label: "HotelFlow \u2014 multi-turn assistant",
					items: [
						{ title: "Track overview", url: "/docs/tutorials/hotel-flow/" },
						{
							title: "1. Designing a multi-stage workflow",
							url: "/docs/tutorials/hotel-flow/multi-stage-design/",
						},
						{
							title: "2. Big prompts as spec files",
							url: "/docs/tutorials/hotel-flow/prompt-files/",
						},
						{
							title: "3. MCP-backed hotel search",
							url: "/docs/tutorials/hotel-flow/backend-tools/",
						},
						{
							title: "4. Memory compaction and erasure",
							url: "/docs/tutorials/hotel-flow/memory-compaction/",
						},
						{
							title: "5. Branch, forward, and return",
							url: "/docs/tutorials/hotel-flow/branch-and-return/",
						},
						{
							title: "6. Answering without an LLM",
							url: "/docs/tutorials/hotel-flow/direct-responses/",
						},
						{
							title: "7. Present and book",
							url: "/docs/tutorials/hotel-flow/present-and-book/",
						},
					],
				},
				{
					label: "InvoiceFlow \u2014 one-shot extraction",
					items: [
						{ title: "Track overview", url: "/docs/tutorials/invoice-flow/" },
						{
							title: "1. The one-shot flow shape",
							url: "/docs/tutorials/invoice-flow/one-shot-flows/",
						},
						{
							title: "2. A step with no tools",
							url: "/docs/tutorials/invoice-flow/no-tool-step/",
						},
						{
							title: "3. Example-as-schema prompting",
							url: "/docs/tutorials/invoice-flow/example-as-schema/",
						},
						{
							title: "4. Multimodal file uploads",
							url: "/docs/tutorials/invoice-flow/multimodal-files/",
						},
						{
							title: "5. Raw JSON and batch fan-out",
							url: "/docs/tutorials/invoice-flow/json-and-batch/",
						},
					],
				},
				{
					label: "SupportFlow \u2014 guided support case",
					items: [
						{ title: "Track overview", url: "/docs/tutorials/support-flow/" },
						{
							title: "1. Designing a support case",
							url: "/docs/tutorials/support-flow/case-shape/",
						},
						{
							title: "2. Verifying and routing requests",
							url: "/docs/tutorials/support-flow/verify-and-route/",
						},
						{
							title: "3. Deterministic return policy",
							url: "/docs/tutorials/support-flow/return-policy/",
						},
						{
							title: "4. Approval holds and session restoration",
							url: "/docs/tutorials/support-flow/approval-holds/",
						},
						{
							title: "5. Billing disputes and escalation",
							url: "/docs/tutorials/support-flow/billing-escalation/",
						},
						{
							title: "6. Memory and durable case state",
							url: "/docs/tutorials/support-flow/memory-and-case-state/",
						},
						{
							title: "7. Testing a support case",
							url: "/docs/tutorials/support-flow/testing/",
						},
					],
				},
			],
		},
		{
			key: "guides",
			label: "Guides",
			url: "/docs/guides/",
			groups: [
				{
					label: "Building a flow",
					items: [
						{ title: "Create and register a flow", url: "/docs/guides/" },
						{ title: "The Flow subclass contract", url: "/docs/guides/flow-contract/" },
						{
							title: "Register providers and models",
							url: "/docs/guides/providers-and-models/",
						},
						{
							title: "Choosing a workflow shape",
							url: "/docs/guides/workflow-shapes/",
						},
					],
				},
				{
					label: "Steps and tools",
					items: [
						{ title: "Authoring a step", url: "/docs/guides/authoring-a-step/" },
						{ title: "Defining and handling tools", url: "/docs/guides/tools/" },
						{
							title: "Multi-tool batch handlers",
							url: "/docs/guides/multi-tool-handlers/",
						},
						{ title: "Prompts and prompt files", url: "/docs/guides/prompts/" },
						{
							title: "Structured output and responses",
							url: "/docs/guides/structured-output/",
						},
					],
				},
				{
					label: "Composition",
					items: [
						{
							title: "Nested execution: runStep / runSteps",
							url: "/docs/guides/nested-execution/",
						},
						{
							title: "Concurrent batch mode",
							url: "/docs/guides/concurrent-steps/",
						},
					],
				},
				{
					label: "Production",
					items: [
						{
							title: "Persistence and session stores",
							url: "/docs/guides/persistence/",
						},
						{ title: "Session document migration", url: "/docs/guides/migration/" },
						{
							title: "Concurrency and session conflicts",
							url: "/docs/guides/concurrency/",
						},
						{
							title: "Error handling and completion",
							url: "/docs/guides/error-handling/",
						},
						{ title: "Testing a flow", url: "/docs/guides/testing/" },
					],
				},
			],
		},
		{
			key: "reference",
			label: "Reference",
			url: "/docs/reference/",
			groups: [
				{
					label: "API",
					items: [
						{ title: "Flow", url: "/docs/reference/" },
						{ title: "Step", url: "/docs/reference/step/" },
						{
							title: "go() / stay() / direct()",
							url: "/docs/reference/response-builders/",
						},
						{ title: "@Tool and @Tools", url: "/docs/reference/decorators/" },
						{
							title: "LogicStep and TerminateSessionStep",
							url: "/docs/reference/logic-and-terminal-steps/",
						},
						{ title: "FlowEngine", url: "/docs/reference/flow-engine/" },
					],
				},
				{
					label: "Models",
					items: [
						{ title: "Model catalog", url: "/docs/reference/model-catalog/" },
						{ title: "Providers", url: "/docs/reference/providers/" },
					],
				},
				{
					label: "Runtime",
					items: [
						{
							title: "Session document schema",
							url: "/docs/reference/session-document/",
						},
						{ title: "Session stores", url: "/docs/reference/session-stores/" },
						{ title: "HTTP API", url: "/docs/reference/http-api/" },
						{
							title: "Environment variables",
							url: "/docs/reference/environment-variables/",
						},
					],
				},
			],
		},
		{
			key: "resources",
			label: "Compare",
			url: "/docs/resources/",
			groups: [
				{
					label: "PicoFlow and LangGraph",
					items: [
						{ title: "Overview and decision guide", url: "/docs/resources/" },
						{
							title: "Architecture and routing",
							url: "/docs/resources/architecture-and-routing/",
						},
						{
							title: "One turn, traced twice",
							url: "/docs/resources/one-turn-traced-twice/",
						},
						{
							title: "Tool loops and validation",
							url: "/docs/resources/tool-loops-and-validation/",
						},
						{
							title: "State, memory, and persistence",
							url: "/docs/resources/state-memory-and-persistence/",
						},
						{
							title: "Interrupts, replay, and operations",
							url: "/docs/resources/interrupts-replay-and-operations/",
						},
						{
							title: "Parallelism and fan-out",
							url: "/docs/resources/parallelism-and-fanout/",
						},
						{
							title: "Reliability and production gaps",
							url: "/docs/resources/reliability-and-production-gaps/",
						},
						{
							title: "Testing and evaluation",
							url: "/docs/resources/testing-and-evaluation/",
						},
					],
				},
			],
		},
		{
			key: "releases",
			label: "Releases",
			url: "/docs/releases/",
			groups: [
				{
					label: "Release notes",
					items: [
						{ title: "Latest release", url: "/docs/releases/" },
					],
				},
			],
		},
	],
};
