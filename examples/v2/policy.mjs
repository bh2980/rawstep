/** A small deterministic DecisionPolicy. No model, SDK, or API key is needed. */
export default {
  decide({ observation, history, allowedActions }) {
    if (history.length >= 10) return { stop: "stuck", rationale: "Reached the example policy's exploration limit." };
    if (observation.kind === "screenreader" && observation.speech.some(text => /get started/i.test(text)) && allowedActions.intents.includes("activate")) {
      return { action: { kind: "intent", intent: "activate" }, rationale: "The actual screen reader output mentioned the requested button." };
    }
    if (allowedActions.keys.includes("Tab")) return { action: { kind: "key", key: "Tab" }, rationale: "Listen to the next focusable control." };
    return { stop: "stuck", rationale: "The backend does not expose the required navigation action." };
  }
};
