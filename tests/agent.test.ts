import { buildSystemPrompt, parseDecision } from "@a11y-task/agent";
import { describe, expect, it } from "vitest";

describe("agent helpers", () => {
  it("parses valid action JSON", () => {
    const decision = parseDecision('{"action":{"key":"Tab"},"rationale":"Move forward."}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect(decision.action.key).toBe("Tab");
    }
  });

  it("turns malformed output into stuck verdict", () => {
    const decision = parseDecision("not valid json");

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("builds the keyboard system prompt with constraints", () => {
    const prompt = buildSystemPrompt("keyboard");

    expect(prompt).toContain("keyboard");
    expect(prompt).toContain("DOM");
    expect(prompt).toContain("Tab");
  });
});
