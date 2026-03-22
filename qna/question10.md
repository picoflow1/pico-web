---
question: "How does picflow work with OpenClaw"
emoji: "🦞"
anchor: "qna-openclaw"
answer: |
  OpenClaw drives PicoFlow across the whole bot lifecycle:
  <ul>
    <li><strong>Interactive build:</strong> OpenClaw uses PicoFlow skills to gather requirements and co-build flows with the developer.</li>
    <li><strong>Live proxying:</strong> During iteration, OpenClaw proxies chat traffic to and from the PicoFlow runtime.</li>
    <li><strong>Test capture:</strong> It turns completed sessions into reusable regression test cases.</li>
    <li><strong>Auto-construction vision:</strong> A curated “PicoFlow builder” instruction set plus rich examples lets OpenClaw draft new flows automatically.</li>
    <li><strong>Ship & monitor:</strong> OpenClaw can commit flows to Git for deployment and monitor production by reading documents written to the document DB.</li>
  </ul>
---
