import {
  buildPromptParts,
  parseExperienceSummary,
  buildSystemPrompt,
  buildUserPromptText,
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
    memory: [{
      step: 0,
      action: "key(Tab)",
      outcome: "continued"
    }]
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
      expect("key" in decision.action).toBe(true);
      if ("key" in decision.action) {
        expect(decision.action.key).toBe("Tab");
      }
    }
  });

  it("parses valid task text input JSON", () => {
    const decision = parseDecision('{"action":{"typeText":"task"},"rationale":"Type the task text."}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("typeText" in decision.action).toBe(true);
      if ("typeText" in decision.action) {
        expect(decision.action.typeText).toBe("task");
      }
    }
  });

  it("parses valid screen reader command JSON", () => {
    const decision = parseDecision('{"action":{"srCommand":"nextItem"},"rationale":"Move to the next announced item."}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("srCommand" in decision.action).toBe(true);
      if ("srCommand" in decision.action) {
        expect(decision.action.srCommand).toBe("nextItem");
      }
    }
  });

  it("parses valid action JSON without rationale", () => {
    const decision = parseDecision('{"action":{"key":"Tab"}}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect(decision.rationale).toBeUndefined();
      expect("key" in decision.action).toBe(true);
    }
  });

  it("parses valid verdict JSON without rationale", () => {
    const decision = parseDecision('{"verdict":"success"}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("success");
      expect(decision.rationale).toBeUndefined();
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

  it("parses a valid experience summary JSON payload", () => {
    const summary = parseExperienceSummary(
      '{"overall":"The run completed.","biggestFriction":"The initial guidance was weak.","nextChecks":["Check the initial guidance.","Check the post-action feedback.","Extra"]}'
    );

    expect(summary).toEqual({
      overall: "The run completed.",
      biggestFriction: "The initial guidance was weak.",
      nextChecks: ["Check the initial guidance.", "Check the post-action feedback."]
    });
  });

  it("treats mixed key and typeText actions as malformed", () => {
    const decision = parseDecision('{"action":{"key":"Tab","typeText":"task"},"rationale":"Invalid."}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("treats mixed key and srCommand actions as malformed", () => {
    const decision = parseDecision('{"action":{"key":"Tab","srCommand":"nextItem"},"rationale":"Invalid."}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("builds the keyboard system prompt with constraints", () => {
    const prompt = buildSystemPrompt("keyboard");

    expect(prompt).toContain("keyboard");
    expect(prompt).toContain("Tab");
    expect(prompt).toContain("focus ring");
    expect(prompt).toContain("Enter / Space");
    expect(prompt).toContain("상태 변화");
    expect(prompt).toContain("JSON만 반환하라");
    expect(prompt).not.toContain('"typeText":"task"');
    expect(prompt).not.toContain("rationale");
  });

  it("includes task-scoped text input rules only when input text is provided", () => {
    const prompt = buildSystemPrompt("keyboard", { text: "passport" });

    expect(prompt).toContain('"typeText":"task"');
    expect(prompt).toContain("고정 문자열");
    expect(prompt).toContain('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    expect(prompt).toContain("typeText는 task에 제공된 고정 문자열만 입력한다");
  });

  it("builds the screenreader-strict system prompt without raw key examples", () => {
    const prompt = buildSystemPrompt("screenreader-strict");

    expect(prompt).toContain("screenreader-strict");
    expect(prompt).toContain("announcement");
    expect(prompt).toContain("screenreader command");
    expect(prompt).toContain("nextItem");
    expect(prompt).not.toContain('"action":{"key":"Tab"}');
    expect(prompt).not.toContain("focus ring");
  });

  it("builds the screenreader-hybrid system prompt with raw key examples", () => {
    const prompt = buildSystemPrompt("screenreader-hybrid");

    expect(prompt).toContain("screenreader-hybrid");
    expect(prompt).toContain("announcement");
    expect(prompt).toContain("함께 사용할 수 있다");
    expect(prompt).toContain('{"action":{"key":"Tab"}}');
    expect(prompt).toContain("nextHeading");
    expect(prompt).toContain("JSON만 반환하라");
  });

  it("builds rationale-on prompts with rationale examples", () => {
    const prompt = buildSystemPrompt("keyboard", undefined, undefined, true);

    expect(prompt).toContain('"rationale":"..."');
    expect(prompt).toContain("rationale 필드에 짧은 이유를 포함하라");
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
        announcement: "Submit button",
        announcementCapture: "log"
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

describe("buildUserPromptText", () => {
  it("previousScreenshot 있으면 현재/직전 이미지 설명이 포함된다", () => {
    const text = buildUserPromptText(makeKeyboardContext(), makeKeyboardObservation());

    expect(text).toContain("현재 스크린샷");
    expect(text).toContain("직전 스크린샷");
    expect(text).toContain("focus ring");
  });

  it("previousScreenshot 없으면 첫 번째 스텝 설명이 포함된다", () => {
    const obs: Observation = {
      kind: "keyboard",
      screenshot: { pngBase64: "current-image", viewport: { w: 1280, h: 720 } },
      browserChrome: { title: "Page", urlPath: "/" },
    };
    const text = buildUserPromptText(makeKeyboardContext(), obs);

    expect(text).toContain("첫 번째 스텝");
    expect(text).not.toContain("두 번째 이미지는 직전 스크린샷");
  });

  it("screenreader observation에는 이미지 설명이 포함되지 않는다", () => {
    const obs: Observation = { kind: "screenreader", announcement: "Submit button", announcementCapture: "log" };
    const text = buildUserPromptText(makeKeyboardContext(), obs);

    expect(text).not.toContain("images:");
    expect(text).toContain('"announcement":"Submit button"');
    expect(text).toContain("agent memory:");
    expect(text).toContain('observation: {"kind":"screenreader"');
  });

  it("task input text가 있으면 user prompt에 포함된다", () => {
    const text = buildUserPromptText(makeKeyboardContext(), makeKeyboardObservation(), { text: "passport" });

    expect(text).toContain('task input text: "passport"');
  });

  it("agent memory는 step/action/outcome 텍스트 블록으로 prompt에 포함된다", () => {
    const ctx: AgentContext = {
      goal: "Finish the task.",
      allowedKeys: ["Tab", "Enter"],
      memory: [{
        step: 0,
        action: "key(Tab)",
        outcome: "continued"
      }]
    };
    const text = buildUserPromptText(ctx, makeKeyboardObservation());

    expect(text).toContain('agent memory:\n- step 0: action="key(Tab)", outcome="continued"');
  });

  it("keyboard prompt에는 observation JSON이 포함된다", () => {
    const text = buildUserPromptText(makeKeyboardContext(), makeKeyboardObservation());

    expect(text).toContain('observation: {"kind":"keyboard"');
    expect(text).toContain('"urlPath":"/fixture"');
    expect(text).toContain("agent memory:");
  });
});
