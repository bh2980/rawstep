import {
  buildPromptParts,
  buildSystemPrompt,
  parseDecision,
  resolveAgentConfig,
  toAnthropicMessageContent,
  toOpenAICompatibleMessageContent,
  type PromptPart
} from "@a11y-task/agent";
import type { AgentContext, Observation } from "@a11y-task/core";
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeKeyboardContext(): AgentContext {
  return {
    goal: "Finish the task.",
    allowedKeys: ["Tab", "Enter"],
    history: [{ stepIndex: 0, action: { key: "Tab" }, rationale: "Move forward." }]
  };
}

function makeKeyboardObservation(): Observation {
  return {
    kind: "keyboard",
    screenshot: {
      pngBase64: "current-image",
      viewport: { w: 1280, h: 720 }
    },
    previousScreenshot: {
      pngBase64: "previous-image"
    },
    browserChrome: {
      title: "Simple CTA Fixture",
      urlPath: "/fixture"
    },
    scrollHint: "middle"
  };
}

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

  it("resolves anthropic config from the shared env vars", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "anthropic";
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";
    process.env.A11Y_TASK_AGENT_MODEL = "claude-custom";

    expect(resolveAgentConfig()).toEqual({
      provider: "anthropic",
      apiKey: "shared-key",
      model: "claude-custom"
    });
  });

  it("falls back from the legacy stub env flag", () => {
    process.env.A11Y_TASK_AGENT_MODE = "stub";

    expect(resolveAgentConfig()).toEqual({ provider: "stub" });
  });

  it("requires a model for the openai-compatible provider", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "openai-compatible";
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";

    expect(() => resolveAgentConfig()).toThrow("requires a model");
  });

  it("builds provider-neutral prompt parts for keyboard observations", () => {
    const promptParts = buildPromptParts(makeKeyboardContext(), makeKeyboardObservation());

    expect(promptParts).toHaveLength(3);
    expect(promptParts[0]).toMatchObject({ type: "text" });
    expect(promptParts[1]).toEqual({
      type: "image",
      mediaType: "image/png",
      base64: "current-image"
    });
    expect(promptParts[2]).toEqual({
      type: "image",
      mediaType: "image/png",
      base64: "previous-image"
    });
  });

  it("builds text-only prompt parts for screenreader observations", () => {
    const promptParts = buildPromptParts(
      makeKeyboardContext(),
      {
        kind: "screenreader",
        announcement: "Submit button"
      }
    );

    expect(promptParts).toHaveLength(1);
    expect(promptParts[0]).toMatchObject({ type: "text" });
  });

  it("converts prompt parts into Anthropic content blocks", () => {
    const content = toAnthropicMessageContent([
      { type: "text", text: "hello" },
      { type: "image", mediaType: "image/png", base64: "abc123" }
    ]);

    expect(content).toEqual([
      { type: "text", text: "hello" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "abc123"
        }
      }
    ]);
  });

  it("converts prompt parts into OpenAI-compatible content blocks", () => {
    const content = toOpenAICompatibleMessageContent([
      { type: "text", text: "hello" },
      { type: "image", mediaType: "image/png", base64: "abc123" }
    ] satisfies PromptPart[]);

    expect(content).toEqual([
      { type: "text", text: "hello" },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,abc123"
        }
      }
    ]);
  });
});
