import {
  LLMAgent,
  buildExperienceSummarySystemPrompt,
  buildPromptParts,
  buildSystemPrompt,
  parseExperienceSummary,
  parseDecision,
  resolveAgentConfig,
  toLanguageModelContent,
  type AgentCompletionClient,
  type PromptPart
} from "@a11y-task/agent";
import type { AgentContext, Observation } from "@a11y-task/core";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPromptTemplateCache, loadPromptTemplates } from "../packages/agent/src/prompt-loader";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.chdir(ORIGINAL_CWD);
  clearPromptTemplateCache();
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

function createCompletionClient(responses: string[]): AgentCompletionClient {
  return {
    async complete() {
      return responses.shift() ?? "";
    }
  };
}

async function createPromptFixtureRoot(contents?: Partial<Record<
  "keyboard.system.md" | "screenreader-strict.system.md" | "screenreader-hybrid.system.md" | "experience-summary.system.md",
  string
>>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "a11y-prompt-fixture-"));
  const promptDir = join(rootDir, "prompt");
  await mkdir(promptDir, { recursive: true });

  const files = {
    "keyboard.system.md": "keys={{allowedKeys}}\n{{taskInputRule}}\n{{responseFormat}}\n{{rationaleRule}}",
    "screenreader-strict.system.md": "sr={{allowedScreenReaderCommands}}\n{{taskInputRule}}\n{{responseFormat}}\n{{rationaleRule}}",
    "screenreader-hybrid.system.md": "keys={{allowedKeys}}\nsr={{allowedScreenReaderCommands}}\n{{taskInputRule}}\n{{responseFormat}}\n{{rationaleRule}}",
    "experience-summary.system.md": "summary-template"
  } satisfies Record<string, string>;

  for (const [filename, content] of Object.entries({ ...files, ...contents })) {
    await writeFile(join(promptDir, filename), content, "utf8");
  }

  return rootDir;
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

  it("parses valid stuck verdict JSON with rationale", () => {
    const decision = parseDecision('{"verdict":"stuck","rationale":"No productive next action is visible."}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toBe("No productive next action is visible.");
    }
  });

  it("treats stuck verdicts without rationale as malformed", () => {
    const decision = parseDecision('{"verdict":"stuck"}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("re-requests a rationale when the model returns stuck without one", async () => {
    const responses = [
      '{"verdict":"stuck"}',
      '{"verdict":"stuck","rationale":"No productive next action is visible."}'
    ];
    let callCount = 0;

    const agent = new LLMAgent("keyboard", {
      provider: "openai-compatible",
      apiKey: "test-key",
      model: "test-model",
      baseURL: "https://example.test/v1",
      completionClient: {
        async complete(input) {
          callCount += 1;

          if (callCount === 2) {
            const retryPromptPart = input.promptParts.at(-1);
            expect(retryPromptPart?.type).toBe("text");
            if (retryPromptPart?.type === "text") {
              expect(retryPromptPart.text).toContain('verdict="stuck"');
              expect(retryPromptPart.text).toContain("rationale");
            }
          }

          return responses.shift() ?? "";
        }
      }
    });

    const decision = await agent.decide(makeKeyboardContext(), makeKeyboardObservation());

    expect(callCount).toBe(2);
    expect(decision).toEqual({
      verdict: "stuck",
      rationale: "No productive next action is visible."
    });
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

  it("requires an explicit provider", () => {
    expect(() => resolveAgentConfig()).toThrow("Missing agent provider");
  });

  it("requires a model for the anthropic provider", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "anthropic";
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";

    expect(() => resolveAgentConfig()).toThrow("Anthropic provider requires a model");
  });

  it("rejects the removed stub provider from env", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "stub";

    expect(() => resolveAgentConfig()).toThrow("Unsupported agent provider");
  });

  it("requires a model for the openai-compatible provider", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "openai-compatible";
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";

    expect(() => resolveAgentConfig()).toThrow("requires a model");
  });

  it("requires a base URL for the openai-compatible provider", () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "openai-compatible";
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";
    process.env.A11Y_TASK_AGENT_MODEL = "openrouter/auto";

    expect(() => resolveAgentConfig()).toThrow("requires a base URL");
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

  it("converts prompt parts into AI SDK content blocks", () => {
    const content = toLanguageModelContent([
      { type: "text", text: "hello" },
      { type: "image", mediaType: "image/png", base64: "abc123" }
    ]);

    expect(content[0]).toEqual({ type: "text", text: "hello" });
    expect(content[1]).toMatchObject({
      type: "image",
      mediaType: "image/png"
    });
    if (content[1]?.type === "image") {
      expect(Array.from(content[1].image)).toEqual(
        Array.from(Buffer.from("abc123", "base64"))
      );
    }
  });

  it("uses an injected completion client without provider-specific transport code", async () => {
    const agent = new LLMAgent("keyboard", {
      provider: "anthropic",
      apiKey: "shared-key",
      model: "claude-custom",
      completionClient: createCompletionClient(['{"action":{"key":"Tab"}}'])
    });

    const decision = await agent.decide(makeKeyboardContext(), makeKeyboardObservation());

    expect(decision).toEqual({
      action: { key: "Tab" }
    });
  });

  it("loads prompt templates from the root prompt directory", async () => {
    const rootDir = await createPromptFixtureRoot();

    const templates = loadPromptTemplates(rootDir);

    expect(templates.promptDir).toBe(join(rootDir, "prompt"));
    expect(templates.keyboardSystem).toContain("keys={{allowedKeys}}");
    expect(templates.experienceSummarySystem).toBe("summary-template");
  });

  it("fails when a required prompt file is missing", async () => {
    const rootDir = await createPromptFixtureRoot();

    await rm(join(rootDir, "prompt", "screenreader-hybrid.system.md"));

    expect(() => loadPromptTemplates(rootDir)).toThrow("Missing prompt file");
  });

  it("fails when a required prompt file is empty", async () => {
    const rootDir = await createPromptFixtureRoot();

    await writeFile(join(rootDir, "prompt", "screenreader-hybrid.system.md"), "", "utf8");

    expect(() => loadPromptTemplates(rootDir)).toThrow("Prompt file is empty");
  });

  it("fails when a system prompt template is missing a required placeholder", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.system.md": "keys={{allowedKeys}}"
    });

    expect(() => loadPromptTemplates(rootDir)).toThrow("must include {{taskInputRule}}");
  });

  it("renders keyboard system prompts from prompt files with code-generated JSON format", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt("keyboard", { text: "passport" }, undefined, undefined, true);

    expect(prompt).toContain("keys=Tab, Shift+Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Space, Escape");
    expect(prompt).toContain('{"action":{"typeText":"task"},"rationale":"..."}');
    expect(prompt).toContain("rationale 필드에 짧은 이유를 포함하라.");
  });

  it("renders screenreader prompts from prompt files with command placeholders", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt("screenreader-strict", undefined, undefined, ["nextItem", "act"], false);

    expect(prompt).toContain("sr=nextItem, act");
    expect(prompt).toContain('{"action":{"srCommand":"nextItem"}}');
  });

  it("renders experience summary prompts from prompt files", async () => {
    const rootDir = await createPromptFixtureRoot({
      "experience-summary.system.md": "custom-summary-template"
    });
    process.chdir(rootDir);

    expect(buildExperienceSummarySystemPrompt()).toBe("custom-summary-template");
  });
});
