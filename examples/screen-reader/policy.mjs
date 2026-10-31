/** A small deterministic DecisionPolicy that acts only on what the screen reader says. No model, SDK or API key is needed. */
export default {
  decide({ observation, history, allowedActions }) {
    const last = history.at(-1)?.decision?.action;
    if (last?.kind === "intent" && last.intent === "activate") return { stop: "success", rationale: "Pressed the button the speech named; the verifier decides." };
    if (history.length >= 20) return { stop: "stuck", rationale: "Reached the example policy's step limit." };
    const heard = observation.kind === "screenreader" ? observation.speech.join(" ") : "";
    if (/get started/i.test(heard) && allowedActions.intents.includes("activate")) return { action: { kind: "intent", intent: "activate" }, rationale: "The screen reader named the requested button." };
    if (allowedActions.intents.includes("next")) return { action: { kind: "intent", intent: "next" }, rationale: "Listen to the next item." };
    return { stop: "stuck", rationale: "The profile allows no way to move item by item." };
  }
};
