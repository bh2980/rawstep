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
} from "@rawstep/agent";
import type {
  AgentContext,
  Observation,
  ResolvedPromptKeyboardAction,
  ResolvedPromptScreenReaderAction
} from "@rawstep/core";
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
    focusHint: 'input[type=email] "Work email"',
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
  "keyboard.system.md"
  | "keyboard.user.md"
  | "screenreader-strict.system.md"
  | "screenreader-strict.user.md"
  | "screenreader-hybrid.system.md"
  | "screenreader-hybrid.user.md"
  | "experience-summary.system.md",
  string
>>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "a11y-prompt-fixture-"));
  const promptDir = join(rootDir, "prompt");
  await mkdir(promptDir, { recursive: true });

  const files = {
    "keyboard.system.md": "system-keyboard\n{{outputBlock}}",
    "keyboard.user.md": "goal:\n{{goal}}\nagent memory:\n{{agentMemory}}\nfocus hint:\n{{focusHint}}\n이미지 안내문\navailable actions:\n{{availableActions}}",
    "screenreader-strict.system.md": "system-strict\n{{outputBlock}}",
    "screenreader-strict.user.md": "goal:\n{{goal}}\nagent memory:\n{{agentMemory}}\nannouncement:\n{{announcement}}\nreadbacks:\n{{readbacks}}\navailable actions:\n{{availableActions}}",
    "screenreader-hybrid.system.md": "system-hybrid\n{{outputBlock}}",
    "screenreader-hybrid.user.md": "goal:\n{{goal}}\nagent memory:\n{{agentMemory}}\nannouncement:\n{{announcement}}\nreadbacks:\n{{readbacks}}\navailable actions:\n{{availableActions}}",
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

  it("parses valid named input JSON", () => {
    const decision = parseDecision(
      '{"action":{"typeText":"email"},"rationale":"Type the email input."}',
      ["email", "password"]
    );

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("typeText" in decision.action).toBe(true);
      if ("typeText" in decision.action) {
        expect(decision.action.typeText).toBe("email");
      }
    }
  });

  it("rejects literal input values in typeText", () => {
    const decision = parseDecision(
      '{"action":{"typeText":"traveler@example.com"},"rationale":"Type the provided email."}',
      ["email"]
    );

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain('invalid typeText key "traveler@example.com"');
      expect(decision.rationale).toContain("Allowed input keys: email");
    }
  });

  it("parses valid screen reader action JSON", () => {
    const decision = parseDecision('{"action":{"srAction":{"kind":"invoke","method":"perform","command":{"source":"catalog","id":"commands.moveToNextHeading"}}},"rationale":"Move to the next announced item."}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("srAction" in decision.action).toBe(true);
      if ("srAction" in decision.action) {
        expect(decision.action.srAction).toEqual({
          kind: "invoke",
          method: "perform",
          command: {
            source: "catalog",
            id: "commands.moveToNextHeading"
          }
        });
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

  it("parses JSON when the model adds prose before the object", () => {
    const decision = parseDecision(
      'The current image shows focus on the "About" link.\n\n{"action":{"key":"Tab"}}'
    );

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("key" in decision.action).toBe(true);
      if ("key" in decision.action) {
        expect(decision.action.key).toBe("Tab");
      }
    }
  });

  it("parses JSON from fenced code blocks", () => {
    const decision = parseDecision(
      '```json\n{"action":{"key":"Tab"},"rationale":"Move forward."}\n```'
    );

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("key" in decision.action).toBe(true);
      if ("key" in decision.action) {
        expect(decision.action.key).toBe("Tab");
      }
      expect(decision.rationale).toBe("Move forward.");
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
    const decision = parseDecision('{"action":{"key":"Tab","typeText":"email"},"rationale":"Invalid."}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("treats mixed key and srAction actions as malformed", () => {
    const decision = parseDecision('{"action":{"key":"Tab","srAction":{"kind":"perform","id":"commands.moveToNextHeading"}},"rationale":"Invalid."}');

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
    const promptParts = buildPromptParts(
      "keyboard",
      makeKeyboardContext(),
      makeKeyboardObservation(),
      {
        email: "traveler@example.com",
        password: "super-secret"
      }
    );

    expect(promptParts).toHaveLength(3);
    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("goal:\nFinish the task.");
      expect(promptParts[0].text).toContain("available actions:");
      expect(promptParts[0].text).toContain('{"action":{"typeText":"email"}}');
      expect(promptParts[0].text).toContain('{"action":{"typeText":"password"}}');
      expect(promptParts[0].text).toContain("- Tab");
      expect(promptParts[0].text).toContain("- Enter");
      expect(promptParts[0].text).toContain('focus hint:\ninput[type=email] "Work email"');
      expect(promptParts[0].text).not.toContain("traveler@example.com");
      expect(promptParts[0].text).not.toContain("super-secret");
    }
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
      "screenreader-strict",
      makeKeyboardContext(),
      {
        kind: "screenreader",
        announcement: "Submit button",
        announcementCapture: "log"
      }
    );

    expect(promptParts).toHaveLength(1);
    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("announcement:\nSubmit button");
      expect(promptParts[0].text).toContain("available actions:");
    }
  });

  it("renders configured action hints in the user prompt instead of the system prompt", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const promptParts = buildPromptParts(
      "screenreader-hybrid",
      {
        goal: "Finish the task.",
        allowedKeys: ["Tab"],
        allowedScreenReaderActions: [{ kind: "invoke", method: "click" }],
        memory: []
      },
      {
        kind: "screenreader",
        announcement: "Submit button",
        announcementCapture: "log"
      },
      {
        email: "traveler@example.com"
      },
      {
        keyboardActions: [{ key: "Tab", hint: "다음 포커스로 이동" }],
        screenReaderActions: [
          {
            semantic: "click",
            hint: "현재 항목을 클릭할 때 사용",
            runtimeAction: { kind: "invoke", method: "click" }
          }
        ]
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("- Tab: 다음 포커스로 이동");
      expect(promptParts[0].text).toContain("- click: 현재 항목을 클릭할 때 사용");
      expect(promptParts[0].text).toContain('{"action":{"typeText":"email"}}');
    }
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

  it("rejects literal task values returned by the model", async () => {
    const agent = new LLMAgent("keyboard", {
      provider: "anthropic",
      apiKey: "shared-key",
      model: "claude-custom",
      taskInput: { email: "traveler@example.com" },
      completionClient: createCompletionClient([
        '{"action":{"typeText":"traveler@example.com"},"rationale":"Type the provided email."}'
      ])
    });

    const decision = await agent.decide(makeKeyboardContext(), makeKeyboardObservation());

    expect(decision).toEqual({
      verdict: "stuck",
      rationale: expect.stringContaining('invalid typeText key "traveler@example.com"')
    });
  });

  it("loads prompt templates from the root prompt directory", async () => {
    const rootDir = await createPromptFixtureRoot();

    const templates = loadPromptTemplates(rootDir);

    expect(templates.promptDir).toBe(join(rootDir, "prompt"));
    expect(templates.keyboardSystem).toContain("{{outputBlock}}");
    expect(templates.keyboardUser).toContain("{{availableActions}}");
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
      "keyboard.user.md": "{{goal}}"
    });

    expect(() => loadPromptTemplates(rootDir)).toThrow("must include {{agentMemory}}");
  });

  it("renders keyboard system prompts from prompt files with code-generated JSON format", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt(
      "keyboard",
      {
        email: "traveler@example.com",
        password: "super-secret"
      },
      undefined,
      undefined,
      true
    );

    expect(prompt).toContain("system-keyboard");
    expect(prompt).not.toContain("- Tab");
    expect(prompt).not.toContain("- Enter");
    expect(prompt).not.toContain("traveler@example.com");
    expect(prompt).not.toContain("super-secret");
    expect(prompt).toContain("출력 규칙:");
    expect(prompt).toContain('- action 또는 verdict를 반환할 때 rationale를 포함하라.');
    expect(prompt).toContain('{"action":{"typeText":"email"},"rationale":"..."}');
  });

  it("prefers configured keyboard action hints over default key guidance", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);
    const keyboardActions: ResolvedPromptKeyboardAction[] = [
      {
        key: "Tab",
        hint: "커스텀 Tab 설명"
      }
    ];

    const prompt = buildSystemPrompt(
      "keyboard",
      undefined,
      ["Tab"],
      undefined,
      false,
      {
        keyboardActions
      }
    );

    expect(prompt).not.toContain("커스텀 Tab 설명");
    expect(prompt).not.toContain("Tab은 포커스 가능한 요소를 다음으로 이동할 때 사용하라.");
  });

  it("renders screenreader prompts from prompt files with action placeholders", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);
    const promptActions: ResolvedPromptScreenReaderAction[] = [
      {
        semantic: "heading.next",
        hint: "다음 제목으로 크게 이동할 때 사용하라.",
        runtimeAction: { kind: "invoke", method: "perform", source: "catalog", id: "commands.moveToNextHeading" }
      },
      {
        semantic: "click",
        runtimeAction: { kind: "invoke", method: "click" }
      }
    ];

    const prompt = buildSystemPrompt(
      "screenreader-strict",
      undefined,
      undefined,
      [
        { kind: "invoke", method: "perform", source: "catalog", id: "commands.moveToNextHeading" },
        { kind: "invoke", method: "click" }
      ],
      false,
      {
        screenReaderActions: promptActions
      }
    );

    expect(prompt).toContain("system-strict");
    expect(prompt).not.toContain("heading.next");
    expect(prompt).not.toContain("- click");
    expect(prompt).toContain("출력 규칙:");
    expect(prompt).toContain('{"action":{"srAction":{"kind":"invoke","method":"perform","command":{"source":"catalog","id":"commands.moveToNextHeading"}}}}');
  });

  it("does not invent guidance when hints are absent", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt(
      "screenreader-hybrid",
      undefined,
      ["Tab", "Escape"],
      [{ kind: "invoke", method: "click" }],
      false
    );

    expect(prompt).toContain("system-hybrid");
    expect(prompt).not.toContain("- Tab");
    expect(prompt).not.toContain("- Escape");
    expect(prompt).not.toContain("- click");
    expect(prompt).toContain("출력 규칙:");
    expect(prompt).not.toContain("- action 또는 verdict를 반환할 때 rationale를 포함하라.");
  });

  it("loads prompt templates from an explicit prompt directory", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.system.md": "explicit-template\n{{outputBlock}}"
    });

    const prompt = buildSystemPrompt(
      "keyboard",
      undefined,
      ["Tab"],
      undefined,
      false,
      {
        promptDir: join(rootDir, "prompt")
      }
    );

    expect(prompt).toContain("explicit-template");
    expect(prompt).not.toContain("- Tab");
  });

  it("renders experience summary prompts from prompt files", async () => {
    const rootDir = await createPromptFixtureRoot({
      "experience-summary.system.md": "custom-summary-template"
    });
    process.chdir(rootDir);

    expect(buildExperienceSummarySystemPrompt()).toBe("custom-summary-template");
  });
});
