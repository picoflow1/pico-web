import capture from "./twenty-two-turn-scenario.transcript.json" with { type: "json" };

export default {
  replay: {
    capturedAt: capture.testDate,
    turns: capture.turns.map(({ label, input, actualResponse, completed }) => ({
      stage: label,
      user: input,
      bot: actualResponse.replace("for EPO_VALUE in the fictional demo directory", "for Value EPO in the fictional demo directory"),
      completed,
    })),
  },
};
