export default {
  nav: [
    { label: "Why conversational apps", href: "/why/" },
    { label: "Use cases", href: "/use-cases/" },
    { label: "How it works", href: "/product/" },
    { label: "Docs", href: "/docs/" },
    { label: "Licensing", href: "/license/" },
    { label: "Contact", href: "/contact/" },
  ],
  pillars: [
    {
      number: "01",
      title: "Durable conversation state",
      body: "One versioned JSON document per conversation holds the active stage, business state, memory, token totals, and structured logs. A customer can leave and come back; the application resumes exactly where the task paused.",
    },
    {
      number: "02",
      title: "Connected to real systems",
      body: "Define a tool once with a Zod schema, decorate a handler with @Tool, and the runtime dispatches the model's call into your code — where it can hit pricing, booking, CRM, and policy systems with validated arguments.",
    },
    {
      number: "03",
      title: "Business rules the model cannot skip",
      body: "Transitions are return values in typed handlers, not instructions buried in prompt prose. Confirmation before commitment, validation before persistence, and escalation paths are enforced by code, not requested of a model.",
    },
    {
      number: "04",
      title: "Production storage, not chat history",
      body: "Memory, SQLite, MongoDB, and Cosmos DB adapters ship with the runtime and implement the same compare-and-swap contract. Swap stores with an environment variable instead of writing another adapter by hand.",
    },
    {
      number: "05",
      title: "Safe under concurrency",
      body: "Turns for one session are serialised in-process, and every store rejects a stale revision with a conflict error. Two browser tabs — or a duplicate request — cannot silently overwrite a customer's in-flight task.",
    },
    {
      number: "06",
      title: "Testable like an application",
      body: "Scripted deterministic models assert transitions, persistence, and business state; live scenarios and model judges cover response quality. A conversational application gets regression coverage, not vibes.",
    },
  ],
  useCases: [
    {
      tag: "Reservations & commerce",
      title: "Hotel reservation",
      body: "Understand the request, check availability, capture preferences, present priced options, obtain explicit confirmation, and book. Built as a complete tutorial application.",
      link: "/docs/tutorials/hotel-flow/",
      linkLabel: "Explore the reservation flow",
    },
    {
      tag: "Support resolution",
      title: "Customer support that completes",
      body: "Verify the customer, inspect account data, execute approved actions with holds, and hand off to a human with a complete case record when needed.",
      link: "/docs/tutorials/support-flow/",
      linkLabel: "Explore the support flow",
    },
    {
      tag: "Claims & document intake",
      title: "Claims and document processing",
      body: "Collect incident details, receive documents, extract structured facts with AI, validate them deterministically, and route exceptions to human review.",
      link: "/docs/tutorials/invoice-flow/",
      linkLabel: "Explore the document flow",
    },
    {
      tag: "Customer onboarding",
      title: "Onboarding without the form maze",
      body: "Guide setup in one conversation: gather missing information, verify it, call backend services, handle exceptions, and activate the account.",
      link: "/use-cases/#onboarding",
      linkLabel: "See the onboarding pattern",
    },
    {
      tag: "Procurement",
      title: "Procurement requests with policy",
      body: "Capture purchase intent, apply vendor and policy rules in code, route approvals, create the request, and track status — without a portal.",
      link: "/use-cases/#procurement",
      linkLabel: "See the procurement pattern",
    },
    {
      tag: "Your workflow",
      title: "The process your customers dread",
      body: "If a task takes your customers multiple screens, forms, and a support ticket today, it is a candidate for a conversational application.",
      link: "/demo/",
      linkLabel: "Book a walkthrough",
    },
  ],
  faqGroups: [
    {
      label: "Start here",
      items: [
        {
          question: "What is PicoFlow?",
          answer:
            'PicoFlow is a platform for building customer-facing AI conversational applications \u2014 software where the customer\'s interface is a guided conversation instead of pages and forms. A flow models your business process in TypeScript; the runtime provides the durable session, tool dispatch, validation boundaries, storage, and concurrency safety that make the conversation a production application rather than a chatbot. <a href="/why/">Read why conversational applications</a>.',
          open: true,
        },
        {
          question: "How is this different from a chatbot?",
          answer:
            'A chatbot answers questions. A PicoFlow application completes a business process: it collects what it needs, validates it in code, calls your real systems, asks for confirmation before commitments, persists durable state, and escalates to a human with a full record. The conversation is the interface; the flow behind it is ordinary, testable application code. <a href="/why/">See the full comparison</a>.',
        },
        {
          question: "Is PicoFlow open source?",
          answer:
            'No. PicoFlow is a commercially licensed runtime distributed as the <a href="https://www.npmjs.com/package/@picoflow/core">@picoflow/core npm package</a>. Internal, non-production evaluation is free, including enterprise prototyping; production use requires a commercial agreement. If a permissively licensed dependency is a hard requirement for your organisation, LangGraph is the better choice and we would rather you know that now than after a proof of concept. <a href="/license/">Read the license</a>.',
        },
        {
          question: "Does PicoFlow stream responses?",
          answer:
            "No. A turn is one HTTP request and one complete JSON response; there is no server-sent events, token streaming, or partial-response API in the runtime today. If your interface needs token-by-token output, PicoFlow does not serve that surface yet \u2014 better to learn it on this page than after a prototype.",
        },
        {
          question: "What does PicoFlow need to run?",
          answer:
            'Node.js 22.5 or newer, TypeScript with <code>NodeNext</code> resolution, legacy decorators (<code>experimentalDecorators</code> and <code>emitDecoratorMetadata</code>), and Zod 4. The published 1.1.2 package supports both ESM <code>import</code> and CommonJS <code>require("@picoflow/core")</code> applications. It is designed to sit inside application frameworks such as NestJS. <a href="/docs/get-started/installation/">See installation</a>.',
        },
      ],
    },
    {
      label: "Evaluating PicoFlow",
      items: [
        {
          question: "Why not just give a model one big prompt and every tool?",
          answer:
            'That architecture is useful for prototypes and low-risk assistance, but for customer-facing business tasks the missing code gets replaced by hidden, less reliable control logic: the prompt becomes an implicit program, safety boundaries become probabilistic, and transactions lose deterministic control. PicoFlow\'s answer is bounded autonomy \u2014 the model reasons freely within each stage while the flow enforces the business envelope: what must be collected, what needs confirmation, what must never happen. <a href="/why/">Read the full argument</a>.',
        },
        {
          question:
            "How does PicoFlow compare with agent frameworks like LangGraph?",
          answer:
            'Agent frameworks orchestrate model and tool calls; PicoFlow orchestrates applications. It operates at the layer above: modelling the customer-facing business flow, managing durable conversation state, enforcing validation and transitions in code, and shipping the session storage and HTTP boundary you would otherwise build by hand. <a href="/compare/langgraph/">See the scoped technical comparison, including where LangGraph is the better choice</a>.',
        },
        {
          question: "Is PicoFlow built on LangChain?",
          answer:
            "Yes, and we would rather say so than have you find it in a lockfile. <code>@picoflow/core</code> depends on <code>@langchain/core</code> and the LangChain provider packages, and a few LangChain types surface in the class you subclass \u2014 <code>MessageContent</code>, <code>ToolCall</code>, and <code>DynamicStructuredTool</code> all appear on <code>Step</code>. Persisted memory holds serialised LangChain messages. PicoFlow does not replace LangChain; it adds the durable session, step cursor, tool dispatch, and storage layer above it.",
        },
        {
          question: "What happens to my application if PicoFlow goes away?",
          answer:
            'A fair question for a closed-source runtime with one published release. What you keep: session documents are plain JSON in a database you control, and your flows are ordinary TypeScript classes holding your prompts, validation, tools, and business rules. What you would rebuild: the tool-dispatch loop, the durable step cursor, the store adapters, and the revision checks \u2014 broadly the layer the <a href="/compare/langgraph/">LangGraph comparison</a> measures. We publish that measurement partly so the exit cost is legible before you commit.',
        },
        {
          question: "Can PicoFlow pause a conversation for human approval?",
          answer:
            'At turn boundaries, yes. The support tutorial models an approval hold with ordinary step state, two explicit tools, and a restore hook that releases the hold after a timeout. There is no mid-execution interrupt primitive: the run status has no paused state, and a turn that fails partway through the tool loop is not resumed. If you need to suspend work inside a node and resume the same thread later, LangGraph\'s <code>interrupt()</code> with a checkpointer is the stronger mechanism. <a href="/docs/resources/interrupts-replay-and-operations/">Read the full comparison</a>.',
        },
        {
          question: "Which model providers and local models are supported?",
          answer:
            'Built-in adapters cover OpenAI, Azure OpenAI, Anthropic, Google, DeepSeek, Moonshot, Z.AI, Ollama, and OpenRouter, plus a custom adapter for any OpenAI-compatible or internal endpoint. Models and parameters are selected per flow or per step, while credentials stay in application bootstrap configuration. <a href="/docs/concepts/models-and-providers/">See providers and model selection</a>.',
        },
        {
          question:
            "How do I test and evaluate a non-deterministic application?",
          answer:
            'Use deterministic scripted models for transition and persistence checks, then add live scenarios or a model judge for response quality. The test guide shows how to assert the response, session ID, active step, run status, and persisted business state together. <a href="/docs/guides/testing/">Read the testing guide</a>.',
        },
      ],
    },
    {
      label: "Running it in production",
      items: [
        {
          question:
            "Where does my data go? Does PicoFlow receive prompts, session data, or telemetry?",
          answer:
            'Nothing leaves your infrastructure. Prompts and session documents stay between your application, the model provider you configure, and the session store you choose. The runtime ships no telemetry and no tracing or metrics integration that could carry data out. The license token is verified offline \u2014 with a signature check against a public key compiled into the package, performed on the first model call and cached for the life of the process. It makes no network request. <a href="/contact/">Contact us</a> for deployment-specific data-processing and residency questions.',
        },
        {
          question: "Can I run PicoFlow entirely in my own cloud or VPC?",
          answer:
            'Yes. PicoFlow is an npm runtime embedded in your Node.js application, so you can deploy it in your own cloud, VPC, or air-gapped infrastructure. Choose the session store that matches the deployment: memory for local work, SQLite for durable single-host use, or MongoDB/Cosmos DB for shared multi-instance deployments. <a href="/docs/guides/persistence/">See the persistence guide</a>.',
        },
        {
          question: "Can I run several instances behind a load balancer?",
          answer:
            'Yes, backed by SQLite on a shared filesystem, MongoDB, or Cosmos DB \u2014 never the memory store, which cannot coordinate separate processes. One caveat worth budgeting for: the FIFO turn lock is per process, so if two turns for the same session land on different instances, both will call the model and only one will be allowed to save. Correctness is protected by the revision check; the duplicated model call is not free. <a href="/docs/guides/concurrency/">Read the concurrency guide</a>.',
        },
        {
          question: "What happens when a model, tool, or database call fails?",
          answer:
            'Failures return through the flow\'s error contract, while persisted state and revision checks protect the session from being silently overwritten. Provider retry attempts are explicit, and PicoFlow does not automatically replay a losing turn because it may already have caused an external side effect. <a href="/docs/guides/error-handling/">Read the error-handling guide</a>.',
        },
        {
          question: "How is PicoFlow licensed?",
          answer:
            'Internal, non-production evaluation is free, including enterprise prototyping, proof-of-concept work, testing, and demos. Production use requires a commercial agreement. <a href="/license/">Read the PicoFlow Evaluation and Commercial License</a>.',
        },
      ],
    },
  ],
};
