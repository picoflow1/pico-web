# Your first EZGraph workflow

Requires Node.js 22.5 or later. No model credentials or EZGraph account needed.

```sh
npm install
npm start
npm test
```

`main.ts` scripts the model's replies using `@picoflow/ezgraph/testing`.
The actual GraphEngine, compiled LangGraph, tool schemas, handlers, histories,
and in-memory session store execute. Scripted replies make this a reproducible
introduction, not a live model evaluation. Sessions last for this process.

`workflow.ts` contains two LlmNodes. CityNode validates and saves the destination;
SummaryNode reads it and finishes with a code-owned trip card. The tests cover
two-turn continuation, invalid tool arguments, domain validation, and tool scope.

To use a live model, replace the scripted model configuration and testing harness
with GraphEngine.create and a model-provider adapter. See:
https://www.picoflow.io/ezgraph/docs/developer-guide/models-and-error-handling/

For database clients, configure GraphEngine in your application entrypoint:
https://www.picoflow.io/ezgraph/docs/developer-guide/state-context-and-history/

EZGraph uses the Commercial Runtime License:
https://www.picoflow.io/ezgraph/license/
