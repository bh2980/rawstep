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
import {
  buildKeyboardActionPlan,
  buildScreenReaderActionPlan,
  createKeyboardActionRef,
  createRawPerformScreenReaderExtensionRef,
  createStableScreenReaderActionRef,
  type KeyboardActionDescriptor,
  type ScreenReaderActionDescriptor
} from "@rawstep/action-catalog";
import type {
  AgentContext,
  Observation
} from "@rawstep/definition";
import { getScreenReaderBackendCapabilities } from "@rawstep/definition";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { clearPromptTemplateCache, loadPromptTemplates } from "../packages/agent/src/prompt-loader";
import { buildExperienceSummaryPromptText } from "../packages/agent/src/prompt";

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
    keyboardActions: makeKeyboardDescriptors(["Tab", "Enter"]),
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

function makeScreenReaderDescriptors(
  semantics: readonly string[],
  backendId: "guidepup-voiceover" | "guidepup-nvda" | "guidepup-virtual" = "guidepup-virtual"
): ScreenReaderActionDescriptor[] {
  return buildScreenReaderActionPlan(
    semantics.map((semantic) => createStableScreenReaderActionRef(semantic as never)),
    backendId,
    getScreenReaderBackendCapabilities(backendId)
  ).descriptors as ScreenReaderActionDescriptor[];
}

function makeKeyboardDescriptors(
  keys: readonly string[],
  hints?: Partial<Record<string, string>>
): KeyboardActionDescriptor[] {
  return buildKeyboardActionPlan(
    keys.map((key) => createKeyboardActionRef(
      key as never,
      hints?.[key]
    ))
  ).descriptors as KeyboardActionDescriptor[];
}

async function createPromptFixtureRoot(contents?: Partial<Record<
  "keyboard.system.md"
  | "keyboard.user.md"
  | "screenreader.system.md"
  | "screenreader.user.md"
  | "experience-summary.system.md"
  | "experience-summary.user.md",
  string
>>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "a11y-prompt-fixture-"));
  const promptDir = join(rootDir, "prompt");
  await mkdir(promptDir, { recursive: true });

  const files = {
    "keyboard.system.md": "system-keyboard\n출력 규칙:\n- JSON 객체 하나만 반환하라.\n- 한 턴에 action 또는 verdict 중 하나만 반환하라.\n- 예시:\n```json\n{{outputExamples}}\n```",
    "keyboard.user.md": "goal:\n{{goal}}\nagent memory:\n{{agentMemory}}\nfocus hint:\n{{focusHint}}\n이미지 안내문\navailable actions:\n{{availableActions}}",
    "screenreader.system.md": "system-screenreader\n출력 규칙:\n- JSON 객체 하나만 반환하라.\n- 한 턴에 action 또는 verdict 중 하나만 반환하라.\n- 예시:\n```json\n{{outputExamples}}\n```",
    "screenreader.user.md": "goal:\n{{goal}}\nagent memory:\n{{agentMemory}}\nannouncement:\n{{announcement}}\nreadbacks:\n{{readbacks}}\navailable actions:\n{{availableActions}}",
    "experience-summary.system.md": "summary-template",
    "experience-summary.user.md": "summary-user-template\nTask\n{{taskSummary}}\nAggregate\n{{aggregateSummary}}\nStep Timeline\n{{stepTimeline}}"
  } satisfies Record<string, string>;

  for (const [filename, content] of Object.entries({ ...files, ...contents })) {
    await writeFile(join(promptDir, filename), content, "utf8");
  }

  return rootDir;
}

describe("agent helpers", () => {
  it("parses valid action JSON", () => {
    const decision = parseDecision('{"action":"key.Tab","rationale":"Move forward."}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("key" in decision.action).toBe(true);
      if ("key" in decision.action) {
        expect(decision.action.key).toBe("Tab");
      }
    }
  });

  it("parses Mod shortcut and edit-key actions", () => {
    const keyboardActions = makeKeyboardDescriptors(["Mod+A", "Backspace"]);
    const modDecision = parseDecision(
      '{"action":"key.Mod+A","rationale":"Select the current value."}',
      undefined,
      keyboardActions
    );
    const editDecision = parseDecision(
      '{"action":"key.Backspace"}',
      undefined,
      keyboardActions
    );

    expect("action" in modDecision).toBe(true);
    if ("action" in modDecision && "key" in modDecision.action) {
      expect(modDecision.action.key).toBe("Mod+A");
    }

    expect("action" in editDecision).toBe(true);
    if ("action" in editDecision && "key" in editDecision.action) {
      expect(editDecision.action.key).toBe("Backspace");
    }
  });

  it("parses valid named input JSON", () => {
    const decision = parseDecision(
      '{"action":"typeText.email","rationale":"Type the email input."}',
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
      '{"action":"typeText.traveler@example.com","rationale":"Type the provided email."}',
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
    const decision = parseDecision(
      '{"action":"sr.heading.next","rationale":"Move to the next announced item."}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["heading.next"])
    );

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect("srAction" in decision.action).toBe(true);
      if ("srAction" in decision.action) {
        expect(decision.action.srAction).toEqual({
          semantic: "heading.next"
        });
      }
    }
  });

  it("parses valid no-arg screen reader invoke actions", () => {
    const decision = parseDecision(
      '{"action":"sr.next"}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["next"])
    );

    expect("action" in decision).toBe(true);
    if ("action" in decision && "srAction" in decision.action) {
      expect(decision.action.srAction).toEqual({
        semantic: "next"
      });
    }
  });

  it("parses valid screen reader read and maintenance actions", () => {
    const readDecision = parseDecision(
      '{"action":"sr.read.itemText"}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["read.itemText"])
    );
    const maintenanceDecision = parseDecision(
      '{"action":"sr.clear.itemTextLog"}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["clear.itemTextLog"])
    );

    expect("action" in readDecision).toBe(true);
    if ("action" in readDecision && "srAction" in readDecision.action) {
      expect(readDecision.action.srAction).toEqual({
        semantic: "read.itemText"
      });
    }

    expect("action" in maintenanceDecision).toBe(true);
    if ("action" in maintenanceDecision && "srAction" in maintenanceDecision.action) {
      expect(maintenanceDecision.action.srAction).toEqual({
        semantic: "clear.itemTextLog"
      });
    }
  });

  it("parses valid action JSON without rationale", () => {
    const decision = parseDecision('{"action":"key.Tab"}');

    expect("action" in decision).toBe(true);
    if ("action" in decision) {
      expect(decision.rationale).toBeUndefined();
      expect("key" in decision.action).toBe(true);
    }
  });

  it("parses JSON when the model adds prose before the object", () => {
    const decision = parseDecision(
      'The current image shows focus on the "About" link.\n\n{"action":"key.Tab"}'
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
      '```json\n{"action":"key.Tab","rationale":"Move forward."}\n```'
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

  it("retries transient provider response failures before succeeding", async () => {
    let callCount = 0;

    const agent = new LLMAgent("keyboard", {
      provider: "openai-compatible",
      apiKey: "test-key",
      model: "test-model",
      baseURL: "https://example.test/v1",
      completionClient: {
        async complete() {
          callCount += 1;

          if (callCount < 3) {
            throw Object.assign(new Error("Invalid JSON response"), {
              statusCode: 502,
              responseBody: "<html>temporary upstream error</html>"
            });
          }

          return '{"action":"key.Tab"}';
        }
      }
    });

    const decision = await agent.decide(makeKeyboardContext(), makeKeyboardObservation());

    expect(callCount).toBe(3);
    expect(decision).toEqual({
      action: { key: "Tab" }
    });
  });

  it("fails after exhausting provider retries", async () => {
    let callCount = 0;

    const agent = new LLMAgent("keyboard", {
      provider: "openai-compatible",
      apiKey: "test-key",
      model: "test-model",
      baseURL: "https://example.test/v1",
      completionClient: {
        async complete() {
          callCount += 1;
          throw Object.assign(new Error("Invalid JSON response"), {
            statusCode: 502,
            responseBody: "<html>still broken</html>"
          });
        }
      }
    });

    await expect(agent.decide(makeKeyboardContext(), makeKeyboardObservation()))
      .rejects
      .toThrow("Invalid JSON response");
    expect(callCount).toBe(3);
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
      '{"overall":"I completed the task after a short scan.","blockers":["I spent one extra step rechecking the main action.","I revisited the result area before finishing.","","  "],"surprise":"The confirmation appeared faster than I expected.","oneLineFeel":"Short run with one brief detour."}'
    );

    expect(summary).toEqual({
      overall: "I completed the task after a short scan.",
      blockers: [
        "I spent one extra step rechecking the main action.",
        "I revisited the result area before finishing."
      ],
      surprise: "The confirmation appeared faster than I expected.",
      oneLineFeel: "Short run with one brief detour."
    });
  });

  it("builds experience summary prompts with the current summary contract only", () => {
    const prompt = buildExperienceSummaryPromptText(
      {
        id: "summary-task",
        url: "file:///summary-task.html",
        goal: "Summarize the run.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 1000,
        verify: {
          all: [{ titleIncludes: "summary-task" }]
        }
      },
      {
        result: "success",
        totalSteps: 1,
        durationMs: 1000,
        timings: {
          setupMs: 1,
          browserLaunchMs: 1,
          pageLoadMs: 1,
          screenReaderInitMs: 0,
          firstAnnouncementWaitMs: 0,
          reportMs: 0
        },
        actionCounts: {
          srInvokeCount: 0,
          srReadCount: 0,
          srMaintenanceCount: 0,
          rawKeyCount: 1,
          typeTextCount: 0
        },
        terminatedAtStep: 1,
        endedBy: "success"
      },
      []
    );

    expect(prompt).toContain("Task");
    expect(prompt).toContain("- id: summary-task");
    expect(prompt).toContain("- input keys status: empty");
    expect(prompt).toContain("Aggregate");
    expect(prompt).toContain("- result: success");
    expect(prompt).toContain("- failure point status: empty");
    expect(prompt).toContain("Step Timeline");
    expect(prompt).toContain("- status: empty");
    expect(prompt).toContain("- items: []");
    expect(prompt).not.toMatch(/task:\s*\{/);
    expect(prompt).not.toMatch(/aggregate:\s*\{/);
    expect(prompt).not.toMatch(/steps:\s*\[/);
    expect(prompt).not.toContain("biggestFriction");
    expect(prompt).not.toContain("nextChecks");
  });

  it("treats malformed parameterized actions as malformed", () => {
    const decision = parseDecision('{"action":"sr.press","rationale":"Invalid."}');
 
    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("parses parameterized screen reader actions", () => {
    const keyDecision = parseDecision(
      '{"action":"sr.key.tab"}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["key.tab"])
    );
    const typeDecision = parseDecision(
      '{"action":"sr.type","text":"hello"}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["type"])
    );
    const clickDecision = parseDecision(
      '{"action":"sr.click","button":"left","clickCount":2}',
      undefined,
      undefined,
      makeScreenReaderDescriptors(["click"])
    );
    const rawDecision = parseDecision(
      '{"action":"srx.rawPerform","payload":{"characters":"x"}}',
      undefined,
      undefined,
      buildScreenReaderActionPlan(
        [
          createRawPerformScreenReaderExtensionRef(
            "Execute a raw payload.",
            z.object({
              characters: z.string().min(1)
            }),
            {
              characters: "x"
            }
          )
        ],
        "guidepup-nvda",
        getScreenReaderBackendCapabilities("guidepup-nvda")
      ).descriptors
    );

    expect("action" in keyDecision).toBe(true);
    if ("action" in keyDecision && "srAction" in keyDecision.action) {
      expect(keyDecision.action.srAction).toEqual({
        semantic: "key.tab"
      });
    }

    expect("action" in typeDecision).toBe(true);
    if ("action" in typeDecision && "srAction" in typeDecision.action) {
      expect(typeDecision.action.srAction).toEqual({
        semantic: "type",
        text: "hello"
      });
    }

    expect("action" in clickDecision).toBe(true);
    if ("action" in clickDecision && "srAction" in clickDecision.action) {
      expect(clickDecision.action.srAction).toEqual({
        semantic: "click",
        button: "left",
        clickCount: 2
      });
    }

    expect("action" in rawDecision).toBe(true);
    if ("action" in rawDecision && "srAction" in rawDecision.action) {
      expect(rawDecision.action.srAction).toEqual({
        extension: "rawPerform",
        payload: {
          characters: "x"
        }
      });
    }
  });

  it("does not parse raw key actions when screenreader prompt actions do not expose them", () => {
    const decision = parseDecision(
      '{"action":"key.Tab"}',
      undefined,
      [],
      makeScreenReaderDescriptors(["key.tab", "next"])
    );

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("rejects mismatched extra fields on string actions", () => {
    const decision = parseDecision('{"action":"key.Tab","text":"oops"}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("treats object-shaped action payloads as malformed", () => {
    const decision = parseDecision('{"action":{"key":"Tab"},"rationale":"Invalid."}');

    expect("verdict" in decision).toBe(true);
    if ("verdict" in decision) {
      expect(decision.verdict).toBe("stuck");
      expect(decision.rationale).toContain("malformed decision");
    }
  });

  it("resolves anthropic config from the shared env vars", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "shared-key";
    process.env.AI_MODEL = "claude-custom";

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
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "shared-key";

    expect(() => resolveAgentConfig()).toThrow("Anthropic provider requires a model");
  });

  it("rejects an unsupported stub provider from env", () => {
    process.env.AI_PROVIDER = "stub";

    expect(() => resolveAgentConfig()).toThrow("Unsupported agent provider");
  });

  it("requires a model for the openai-compatible provider", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_API_KEY = "shared-key";

    expect(() => resolveAgentConfig()).toThrow("requires a model");
  });

  it("requires a base URL for the openai-compatible provider", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_API_KEY = "shared-key";
    process.env.AI_MODEL = "openrouter/auto";

    expect(() => resolveAgentConfig()).toThrow("requires a base URL");
  });

  it("builds provider-neutral prompt parts for keyboard observations", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);
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
      expect(promptParts[0].text).toContain("- status: present");
      expect(promptParts[0].text).toContain("- typeText.email");
      expect(promptParts[0].text).toContain("- typeText.password");
      expect(promptParts[0].text).toContain("- key.Tab");
      expect(promptParts[0].text).toContain("- key.Enter");
      expect(promptParts[0].text).toContain('focus hint:\n- status: present\n- value: "input[type=email] \\"Work email\\""');
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

  it("renders raw focus hint values without extra explanatory text", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);
    const promptParts = buildPromptParts(
      "keyboard",
      {
        goal: "Finish the task.",
        keyboardActions: makeKeyboardDescriptors(["Tab"]),
        memory: []
      },
      {
        kind: "keyboard",
        screenshot: {
          pngBase64: "current-image",
          viewport: { w: 1280, h: 720 }
        },
        browserChrome: {
          title: "Simple CTA Fixture",
          urlPath: "/fixture"
        },
        focusHint: "none",
        scrollHint: "middle"
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain('focus hint:\n- status: present\n- value: "none"');
      expect(promptParts[0].text).not.toContain("현재 focus된 인터랙티브 요소가 감지되지 않았다.");
      expect(promptParts[0].text).not.toContain("(empty)");
    }
  });

  it("renders empty blocks for missing keyboard prompt values", () => {
    const promptParts = buildPromptParts(
      "keyboard",
      {
        goal: "Finish the task.",
        keyboardActions: [],
        memory: []
      },
      {
        kind: "keyboard",
        screenshot: {
          pngBase64: "current-image",
          viewport: { w: 1280, h: 720 }
        },
        browserChrome: {
          title: "Simple CTA Fixture",
          urlPath: "/fixture"
        }
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("action history:\n- status: empty\n- items: []");
      expect(promptParts[0].text).toContain("focus hint:\n- status: empty");
      expect(promptParts[0].text).toContain("available actions:\n- status: empty\n- items: []");
    }
  });

  it("builds text-only prompt parts for screenreader observations", () => {
    const promptParts = buildPromptParts(
      "screenreader",
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
      expect(promptParts[0].text).toContain('announcement:\n- status: present\n- value: "Submit button"');
      expect(promptParts[0].text).toContain("available actions:");
    }
  });

  it("renders empty blocks for missing screenreader prompt values", () => {
    const promptParts = buildPromptParts(
      "screenreader",
      {
        goal: "Finish the task.",
        keyboardActions: [],
        screenReaderActions: [],
        memory: []
      },
      {
        kind: "screenreader",
        announcement: "",
        announcementCapture: "none",
        readbacks: []
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("agent memory:\n- status: empty\n- items: []");
      expect(promptParts[0].text).toContain("announcement:\n- status: empty");
      expect(promptParts[0].text).toContain("readbacks:\n- status: empty\n- items: []");
      expect(promptParts[0].text).toContain("available actions:\n- status: empty\n- items: []");
    }
  });

  it("renders readbacks as structured list items", () => {
    const promptParts = buildPromptParts(
      "screenreader",
      makeKeyboardContext(),
      {
        kind: "screenreader",
        announcement: "Submit button",
        announcementCapture: "log",
        readbacks: [
          { method: "itemText", value: "Email" },
          { method: "clearItemTextLog", status: "cleared" }
        ]
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("- status: present");
      expect(promptParts[0].text).toContain('- method=itemText, value="Email"');
      expect(promptParts[0].text).toContain("- method=clearItemTextLog, status=cleared");
      expect(promptParts[0].text).not.toContain('{"method":"itemText","value":"Email"}');
    }
  });

  it("renders screen reader available actions with compressed wire-shape labels", () => {
    const promptParts = buildPromptParts(
      "screenreader",
      {
        goal: "Finish the task.",
        keyboardActions: makeKeyboardDescriptors(["Tab"]),
        screenReaderActions: buildScreenReaderActionPlan(
          [
            createStableScreenReaderActionRef("next"),
            createStableScreenReaderActionRef("read.itemText"),
            createStableScreenReaderActionRef("clear.itemTextLog"),
            createStableScreenReaderActionRef("heading.next"),
            createStableScreenReaderActionRef("link.next"),
            createRawPerformScreenReaderExtensionRef(
              "Execute a raw payload.",
              z.object({ characters: z.string().min(1) }),
              { characters: "x" }
            )
          ],
          "guidepup-nvda",
          getScreenReaderBackendCapabilities("guidepup-nvda")
        ).descriptors,
        memory: []
      },
      {
        kind: "screenreader",
        announcement: "Submit button",
        announcementCapture: "log"
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("- sr.next");
      expect(promptParts[0].text).toContain("- sr.read.itemText");
      expect(promptParts[0].text).toContain("- sr.clear.itemTextLog");
      expect(promptParts[0].text).toContain("- sr.heading.next");
      expect(promptParts[0].text).toContain("- sr.link.next");
      expect(promptParts[0].text).toContain("- srx.rawPerform");
    }
  });

  it("renders configured action hints in the user prompt instead of the system prompt", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const promptParts = buildPromptParts(
      "screenreader",
      {
        goal: "Finish the task.",
        keyboardActions: makeKeyboardDescriptors(["Tab"]),
        screenReaderActions: makeScreenReaderDescriptors(["click"]),
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
        keyboardActions: makeKeyboardDescriptors(["Tab"], {
          Tab: "다음 포커스로 이동"
        }),
        screenReaderActions: [
          {
            kind: "stable",
            token: "sr.click",
            semantic: "click",
            hint: "현재 항목을 클릭할 때 사용",
            argumentKind: "click"
          }
        ]
      }
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("- sr.click: 현재 항목을 클릭할 때 사용");
      expect(promptParts[0].text).toContain("- typeText.email");
    }
  });

  it("renders configured edit keys only when the task allows them", () => {
    const promptParts = buildPromptParts(
      "keyboard",
      {
        goal: "Fix the current field value.",
        keyboardActions: makeKeyboardDescriptors(["Tab", "Backspace", "Mod+A", "Mod+Z"]),
        memory: []
      },
      makeKeyboardObservation()
    );

    expect(promptParts[0]).toMatchObject({ type: "text" });
    if (promptParts[0]?.type === "text") {
      expect(promptParts[0].text).toContain("- key.Backspace");
      expect(promptParts[0].text).toContain("- key.Mod+A");
      expect(promptParts[0].text).toContain("- key.Mod+Z");
      expect(promptParts[0].text).not.toContain("- key.Delete");
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
      completionClient: createCompletionClient(['{"action":"key.Tab"}'])
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
        '{"action":"typeText.traveler@example.com","rationale":"Type the provided email."}'
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
    expect(templates.keyboardSystem).toContain("{{outputExamples}}");
    expect(templates.keyboardUser).toContain("{{availableActions}}");
    expect(templates.experienceSummarySystem).toBe("summary-template");
    expect(templates.experienceSummaryUser).toContain("{{taskSummary}}");
  });

  it("strips HTML comments from prompt templates before rendering", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.system.md": "system-keyboard\n<!-- 내부 메모: 이 줄은 모델에 보내지지 않아야 함 -->\n출력 규칙:\n```json\n{{outputExamples}}\n```",
      "keyboard.user.md": "goal:\n{{goal}}\n<!-- 숨김 규칙 -->\nagent memory:\n{{agentMemory}}\nfocus hint:\n{{focusHint}}\navailable actions:\n{{availableActions}}"
    });
    process.chdir(rootDir);

    const templates = loadPromptTemplates(rootDir);
    const prompt = buildSystemPrompt("keyboard");

    expect(templates.keyboardSystem).not.toContain("내부 메모");
    expect(templates.keyboardUser).not.toContain("숨김 규칙");
    expect(prompt).not.toContain("내부 메모");
  });

  it("does not count placeholders inside HTML comments", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.user.md": "goal:\n{{goal}}\nagent memory:\n<!-- {{agentMemory}} -->\nfocus hint:\n{{focusHint}}\navailable actions:\n{{availableActions}}"
    });

    expect(() => loadPromptTemplates(rootDir)).toThrow("must include {{agentMemory}}");
  });

  it("fails when a required prompt file is missing", async () => {
    const rootDir = await createPromptFixtureRoot();

    await rm(join(rootDir, "prompt", "screenreader.system.md"));

    expect(() => loadPromptTemplates(rootDir)).toThrow("Missing prompt file");
  });

  it("fails when a required prompt file is empty", async () => {
    const rootDir = await createPromptFixtureRoot();

    await writeFile(join(rootDir, "prompt", "screenreader.system.md"), "", "utf8");

    expect(() => loadPromptTemplates(rootDir)).toThrow("Prompt file is empty");
  });

  it("fails when a system prompt template is missing a required placeholder", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.user.md": "{{goal}}"
    });

    expect(() => loadPromptTemplates(rootDir)).toThrow("must include {{agentMemory}}");
  });

  it("fails when a prompt template references a placeholder with no provided replacement", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.user.md": "goal:\n{{goal}}\nmissing:\n{{unknownPlaceholder}}\navailable actions:\n{{availableActions}}\nagent memory:\n{{agentMemory}}\nfocus hint:\n{{focusHint}}"
    });
    process.chdir(rootDir);

    expect(() => buildPromptParts(
      "keyboard",
      makeKeyboardContext(),
      makeKeyboardObservation()
    )).toThrow("Missing prompt replacement for {{unknownPlaceholder}}.");
  });

  it("fails when the experience summary user template is missing a required placeholder", async () => {
    const rootDir = await createPromptFixtureRoot({
      "experience-summary.user.md": "{{taskSummary}}"
    });

    expect(() => loadPromptTemplates(rootDir)).toThrow("must include {{aggregateSummary}}");
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
    expect(prompt).toContain("```json");
    expect(prompt).toContain('{"action":"typeText.email","rationale":"..."}');
  });

  it("prefers configured keyboard action hints over default key guidance", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);
    const keyboardActions = makeKeyboardDescriptors(["Tab"], {
      Tab: "커스텀 Tab 설명"
    });

    const prompt = buildSystemPrompt(
      "keyboard",
      undefined,
      undefined,
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
    const promptActions: ScreenReaderActionDescriptor[] = [
      {
        kind: "stable",
        token: "sr.heading.next",
        semantic: "heading.next",
        hint: "다음 제목으로 크게 이동할 때 사용하라.",
        argumentKind: "none"
      },
      {
        kind: "stable",
        token: "sr.click",
        semantic: "click",
        argumentKind: "click"
      }
    ];

    const prompt = buildSystemPrompt(
      "screenreader",
      undefined,
      undefined,
      promptActions,
      false,
      {
        screenReaderActions: promptActions
      }
    );

    expect(prompt).toContain("system-screenreader");
    expect(prompt).toContain("출력 규칙:");
    expect(prompt).toContain("```json");
    expect(prompt).toContain('{"action":"sr.heading.next"}');
    expect(prompt).toContain('{"action":"sr.click","button":"left","clickCount":1}');
  });

  it("includes conservative text-entry guidance in the default screenreader system prompt", () => {
    const prompt = buildSystemPrompt(
      "screenreader",
      undefined,
      undefined,
      undefined,
      false,
      {
        promptDir: join(ORIGINAL_CWD, "prompt")
      }
    );

    expect(prompt).toContain("라벨이나 필드 이름만 들렸다고 입력 가능한 필드라고 단정하지 마라.");
    expect(prompt).toContain("편집 가능한 텍스트 입력 상태가 직접 읽히면 typeText를 우선 검토하라.");
    expect(prompt).toContain("그런 직접 신호가 없더라도, 입력 목표이고 현재 announcement와 최근 readback 또는 직전 탐색 맥락이 함께 입력 필드일 가능성을 충분히 뒷받침하면 typeText를 시도할 수 있다.");
    expect(prompt).toContain("typeText가 텍스트 입력 상태 변화 없이 실패하면, 같은 위치에서 interact를 반복하지 말고 sr.key.tab, sr.key.shiftTab, form 이동처럼 전략을 바꾸어라.");
  });

  it("uses neutral placeholder values in screenreader output examples", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt(
      "screenreader",
      undefined,
      [],
      buildScreenReaderActionPlan(
        [
          createStableScreenReaderActionRef("key.enter"),
          createStableScreenReaderActionRef("type"),
          createRawPerformScreenReaderExtensionRef(
            "Execute a raw payload.",
            z.object({ characters: z.string().min(1) }),
            { characters: "x" }
          )
        ],
        "guidepup-nvda",
        getScreenReaderBackendCapabilities("guidepup-nvda")
      ).descriptors,
      false
    );

    expect(prompt).toContain('{"action":"sr.key.enter"}');
    expect(prompt).toContain('{"action":"sr.type","text":"<text>"}');
    expect(prompt).toContain('{"action":"srx.rawPerform","payload":{"characters":"x"}}');
  });

  it("does not invent guidance when hints are absent", async () => {
    const rootDir = await createPromptFixtureRoot();
    process.chdir(rootDir);

    const prompt = buildSystemPrompt(
      "screenreader",
      undefined,
      makeKeyboardDescriptors(["Tab", "Escape"]),
      makeScreenReaderDescriptors(["click"]),
      false
    );

    expect(prompt).toContain("system-screenreader");
    expect(prompt).not.toContain("- Tab");
    expect(prompt).not.toContain("- Escape");
    expect(prompt).not.toContain("- click");
    expect(prompt).toContain("출력 규칙:");
    expect(prompt).toContain("```json");
  });

  it("loads prompt templates from an explicit prompt directory", async () => {
    const rootDir = await createPromptFixtureRoot({
      "keyboard.system.md": "explicit-template\n{{outputExamples}}"
    });

    const prompt = buildSystemPrompt(
      "keyboard",
      undefined,
      makeKeyboardDescriptors(["Tab"]),
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
      "experience-summary.system.md": "custom-summary-template",
      "experience-summary.user.md": "custom-summary-user\n{{taskSummary}}\n{{aggregateSummary}}\n{{stepTimeline}}"
    });
    process.chdir(rootDir);

    expect(buildExperienceSummarySystemPrompt()).toBe("custom-summary-template");
    expect(buildExperienceSummaryPromptText(
      {
        id: "custom-summary-task",
        url: "file:///custom-summary-task.html",
        goal: "Use the custom template.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 1000,
        verify: {
          all: [{ titleIncludes: "custom-summary-task" }]
        }
      },
      {
        result: "success",
        totalSteps: 0,
        durationMs: 1000,
        timings: {
          setupMs: 0,
          browserLaunchMs: 0,
          pageLoadMs: 0,
          screenReaderInitMs: 0,
          firstAnnouncementWaitMs: 0,
          reportMs: 0
        },
        actionCounts: {
          srInvokeCount: 0,
          srReadCount: 0,
          srMaintenanceCount: 0,
          rawKeyCount: 0,
          typeTextCount: 0
        },
        terminatedAtStep: null,
        endedBy: "success"
      },
      []
    )).toContain("custom-summary-user");
  });
});
