export default {
  nav: [
    { label: "How it works", href: "/product/" },
    { label: "vs LangGraph", href: "/compare/langgraph/" },
    { label: "Docs", href: "/docs/" },
    { label: "Licensing", href: "/license/" },
    { label: "Contact", href: "/contact/" },
  ],
  pillars: [
    {
      number: "01",
      title: "The tool loop",
      body: "Define a tool once with a Zod schema, decorate a handler with @Tool, and the runtime dispatches the model's call to it. No name-matching switch statement, no manual message assembly, no re-prompting logic to maintain.",
    },
    {
      number: "02",
      title: "The session document",
      body: "One JSON document per conversation holds the active step, step state, memory namespaces, token totals, and structured logs. It is versioned, so you can migrate a schema without silently restarting in-flight conversations.",
    },
    {
      number: "03",
      title: "The storage layer",
      body: "Memory, SQLite, MongoDB, and Cosmos DB adapters ship with the runtime and implement the same compare-and-swap contract. Swap stores with an environment variable instead of writing a fourth adapter by hand.",
    },
    {
      number: "04",
      title: "Concurrent-write safety",
      body: "Turns for one session are serialised in-process by a FIFO lock, and every store rejects a stale revision with a conflict error. Two browser tabs cannot silently overwrite each other's turn.",
    },
  ],
  useCases: [
    {
      tag: "Booking and guided sales",
      title: "Conversations that lead to a decision",
      body: "Collect intent, validate information, call your systems, compare options, and resume exactly where the customer conversation paused.",
      link: "/docs/tutorials/hotel-flow/",
      linkLabel: "Explore HotelFlow",
    },
    {
      tag: "Support and account service",
      title: "Conversations that safely reach resolution",
      body: "Route requests, place approval holds, track durable case state, and hand work between customer-facing stages without hand-building a session engine.",
      link: "/docs/tutorials/support-flow/",
      linkLabel: "Explore SupportFlow",
    },
  ],
  faqGroups: [
    {
      label: "Start here",
      items: [
        {
          question: "What is PicoFlow, and how is it different from LangGraph?",
          answer: "LangGraph gives you graph and state primitives; you still build the durable session, the store adapters, the concurrency policy, and the HTTP envelope around it. PicoFlow ships that layer and asks you to write conversation stages as ordinary TypeScript classes. Both can orchestrate nested, sequential, parallel, and tool-driven work \u2014 the difference is which layer your team ends up owning. <a href=\"/compare/langgraph/\">See the scoped comparison, including where LangGraph is the better choice</a>.",
          open: true,
        },
        {
          question: "Is PicoFlow open source?",
          answer: "No. PicoFlow is a commercially licensed runtime distributed as the <a href=\"https://www.npmjs.com/package/@picoflow/core\">@picoflow/core npm package</a>. Personal evaluation is free, and production use requires commercial terms. If a permissively licensed dependency is a hard requirement for your organisation, LangGraph is the better choice and we would rather you know that now than after a proof of concept. <a href=\"/license/\">See licensing</a>.",
        },
        {
          question: "Does PicoFlow stream responses?",
          answer: "No. A turn is one HTTP request and one complete JSON response; there is no server-sent events, token streaming, or partial-response API in the runtime today. If your interface needs token-by-token output, PicoFlow does not serve that surface yet \u2014 better to learn it on this page than after a prototype.",
        },
        {
          question: "What does PicoFlow need to run?",
          answer: "Node.js 22.5 or newer, TypeScript with <code>NodeNext</code> resolution, legacy decorators (<code>experimentalDecorators</code> and <code>emitDecoratorMetadata</code>), and Zod 4. The published 1.1.1 package is ESM-only: a CommonJS application cannot <code>require(\"@picoflow/core\")</code> and has to reach it through a dynamic <code>import()</code>. It is designed to sit inside application frameworks such as NestJS. <a href=\"/docs/get-started/installation/\">See installation</a>.",
        },
      ],
    },
    {
      label: "Evaluating PicoFlow",
      items: [
        {
          question: "Is PicoFlow built on LangChain?",
          answer: "Yes, and we would rather say so than have you find it in a lockfile. <code>@picoflow/core</code> depends on <code>@langchain/core</code> and the LangChain provider packages, and a few LangChain types surface in the class you subclass \u2014 <code>MessageContent</code>, <code>ToolCall</code>, and <code>DynamicStructuredTool</code> all appear on <code>Step</code>. Persisted memory holds serialised LangChain messages. PicoFlow does not replace LangChain; it adds the durable session, step cursor, tool dispatch, and storage layer above it. That is also why the LangGraph comparison is about which layer you own rather than which library is faster.",
        },
        {
          question: "What happens to my application if PicoFlow goes away?",
          answer: "A fair question for a closed-source runtime with one published release. What you keep: session documents are plain JSON in a database you control, and your flows are ordinary TypeScript classes holding your prompts, validation, tools, and business rules. What you would rebuild: the tool-dispatch loop, the durable step cursor, the store adapters, and the revision checks \u2014 broadly the layer the <a href=\"/compare/langgraph/\">LangGraph comparison</a> measures. We publish that measurement partly so the exit cost is legible before you commit.",
        },
        {
          question: "Can PicoFlow pause a conversation for human approval?",
          answer: "At turn boundaries, yes. The support tutorial models an approval hold with ordinary step state, two explicit tools, and a restore hook that releases the hold after a timeout. There is no mid-execution interrupt primitive: the run status has no paused state, and a turn that fails partway through the tool loop is not resumed. If you need to suspend work inside a node and resume the same thread later, LangGraph's <code>interrupt()</code> with a checkpointer is the stronger mechanism. <a href=\"/docs/resources/interrupts-replay-and-operations/\">Read the full comparison</a>.",
        },
        {
          question: "Which model providers and local models are supported?",
          answer: "Built-in adapters cover OpenAI, Azure OpenAI, Anthropic, Google, DeepSeek, Moonshot, Z.AI, Ollama, and OpenRouter, plus a custom adapter for any OpenAI-compatible or internal endpoint. Models and parameters are selected per flow or per step, while credentials stay in application bootstrap configuration. <a href=\"/docs/concepts/models-and-providers/\">See providers and model selection</a>.",
        },
        {
          question: "How do I test and evaluate a non-deterministic agent?",
          answer: "Use deterministic scripted models for transition and persistence checks, then add live scenarios or a model judge for response quality. The test guide shows how to assert the response, session ID, active step, run status, and persisted business state together. <a href=\"/docs/guides/testing/\">Read the testing guide</a>.",
        },
      ],
    },
    {
      label: "Running it in production",
      items: [
        {
          question: "Where does my data go? Does PicoFlow receive prompts, session data, or telemetry?",
          answer: "Nothing leaves your infrastructure. Prompts and session documents stay between your application, the model provider you configure, and the session store you choose. The runtime ships no telemetry and no tracing or metrics integration that could carry data out. The license token is verified offline \u2014 an Ed25519 signature check against a public key compiled into the package, performed on the first model call and cached for the life of the process. It makes no network request. <a href=\"/contact/\">Contact us</a> for deployment-specific data-processing and residency questions.",
        },
        {
          question: "Can I run PicoFlow entirely in my own cloud or VPC?",
          answer: "Yes. PicoFlow is an npm runtime embedded in your Node.js application, so you can deploy it in your own cloud, VPC, or air-gapped infrastructure. Choose the session store that matches the deployment: memory for local work, SQLite for durable single-host use, or MongoDB/Cosmos DB for shared multi-instance deployments. <a href=\"/docs/guides/persistence/\">See the persistence guide</a>.",
        },
        {
          question: "Can I run several instances behind a load balancer?",
          answer: "Yes, backed by SQLite on a shared filesystem, MongoDB, or Cosmos DB \u2014 never the memory store, which cannot coordinate separate processes. One caveat worth budgeting for: the FIFO turn lock is per process, so if two turns for the same session land on different instances, both will call the model and only one will be allowed to save. Correctness is protected by the revision check; the duplicated model call is not free. <a href=\"/docs/guides/concurrency/\">Read the concurrency guide</a>.",
        },
        {
          question: "What happens when a model, tool, or database call fails?",
          answer: "Failures return through the flow's error contract, while persisted state and revision checks protect the session from being silently overwritten. Provider retry attempts are explicit, and PicoFlow does not automatically replay a losing turn because it may already have caused an external side effect. <a href=\"/docs/guides/error-handling/\">Read the error-handling guide</a>.",
        },
        {
          question: "How is PicoFlow licensed, and what does it cost?",
          answer: "Personal evaluation is free: request a key on the <a href=\"/license/\">licensing page</a> and it is normally returned the same working day. Production is licensed per application and priced against the deployment rather than seat count. There is no public price list \u2014 a quote needs a short conversation about where and how it runs.",
        },
      ],
    },
  ],
};
