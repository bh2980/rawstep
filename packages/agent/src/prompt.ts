import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type Action,
  type AgentContext,
  type AgentMemoryEntry,
  type Decision,
  type Observation,
  type StepRecord,
  type Task,
  type TaskInput,
  type TraceAggregate,
  type UserModel
} from "@a11y-task/core";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  allowedKeys: readonly string[] = ALLOWED_KEYS,
  allowedScreenReaderCommands: readonly string[] = SCREENREADER_COMMANDS,
  includeRationale = false
): string {
  const templates = loadPromptTemplates();

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictSystem, {
      allowedScreenReaderCommands: allowedScreenReaderCommands.join(", "),
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderStrictJsonFormat(taskInput, includeRationale),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridSystem, {
      allowedKeys: allowedKeys.join(", "),
      allowedScreenReaderCommands: allowedScreenReaderCommands.join(", "),
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderHybridJsonFormat(taskInput, includeRationale),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    allowedKeys: allowedKeys.join(", "),
    taskInputRule: buildKeyboardTaskInputRule(taskInput),
    responseFormat: buildKeyboardJsonFormat(taskInput, includeRationale),
    rationaleRule: buildRationaleRule(includeRationale)
  });
}

export function buildPromptParts(ctx: AgentContext, obs: Observation, taskInput?: TaskInput): PromptPart[] {
  const promptParts: PromptPart[] = [
    {
      type: "text",
      text: buildUserPromptText(ctx, obs, taskInput)
    }
  ];

  if (obs.kind === "keyboard") {
    promptParts.push({
      type: "image",
      mediaType: "image/png",
      base64: obs.screenshot.pngBase64
    });

    if (obs.previousScreenshot) {
      promptParts.push({
        type: "image",
        mediaType: "image/png",
        base64: obs.previousScreenshot.pngBase64
      });
    }
  }

  return promptParts;
}

export function buildUserPromptText(ctx: AgentContext, obs: Observation, taskInput?: TaskInput): string {
  const lines = [
    `goal: ${ctx.goal}`,
    formatAgentMemoryBlock(ctx.memory)
  ];

  if (obs.kind === "screenreader") {
    lines.push(`announcement: ${obs.announcement}`);
  }

  if (taskInput) {
    lines.push(`task input text: ${JSON.stringify(taskInput.text)}`);
  }

  if (obs.kind === "keyboard") {
    lines.push(
      obs.previousScreenshot
        ? "images: 첫 번째 이미지는 현재 스크린샷, 두 번째 이미지는 직전 스크린샷이다. 두 이미지를 비교하여 focus ring이 어디서 어디로 이동했는지 확인하라."
        : "images: 현재 스크린샷 1장이 첨부되어 있다. 직전 스크린샷은 없다 (첫 번째 스텝)."
    );
  }

  return lines.join("\n");
}

export function buildExperienceSummarySystemPrompt(): string {
  return loadPromptTemplates().experienceSummarySystem;
}

export function buildExperienceSummaryPromptText(
  task: Task,
  aggregate: TraceAggregate,
  steps: StepRecord[]
): string {
  return [
    `task: ${JSON.stringify({ id: task.id, goal: task.goal, mode: task.mode })}`,
    `aggregate: ${JSON.stringify(aggregate)}`,
    `steps: ${JSON.stringify(buildSummaryStepsForPrompt(steps))}`,
    "Summarize the run in terms of experience only.",
    "overall: what the run felt like end-to-end.",
    "biggestFriction: the single biggest friction in the run.",
    "nextChecks: up to 2 concrete things a developer should inspect next.",
    "Do not infer DOM structure or accessibility violations."
  ].join("\n");
}

function buildSummaryStepsForPrompt(steps: StepRecord[]): Array<{
  step: number;
  observation: object;
  decision: string;
  execution: {
    ok: boolean;
    costDelta: number;
    error?: string;
  };
  verification?: {
    passed: boolean;
    failures: string[];
  };
  result?: {
    finalResult: "success" | "failure" | "continued";
    completionSource: "agent" | "verifier-auto-complete";
  };
  timings: StepRecord["timings"];
}> {
  return steps.map((step) => ({
    step: step.step,
    observation: summarizeObservationForPrompt(step),
    decision: summarizeDecisionForPrompt(step.decision),
    execution: {
      ok: step.execution.ok,
      costDelta: step.execution.costDelta,
      ...(step.execution.error ? { error: step.execution.error } : {})
    },
    verification: step.verification
      ? {
          passed: step.verification.passed,
          failures: step.verification.failures
        }
      : undefined,
    result: step.verdictAnalysis
      ? {
          finalResult: step.verdictAnalysis.finalResult,
          completionSource: step.verdictAnalysis.completionSource
        }
      : undefined,
    timings: step.timings
  }));
}

function formatDecisionAction(action: Action): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("srCommand" in action) {
    return `srCommand(${action.srCommand})`;
  }

  return "typeText(task)";
}

function summarizeObservationForPrompt(step: StepRecord): object {
  if (step.observation.kind === "keyboard") {
    return {
      kind: "keyboard",
      title: step.observation.browserChrome.title,
      urlPath: step.observation.browserChrome.urlPath,
      scrollHint: step.observation.scrollHint
    };
  }

  return {
    kind: "screenreader",
    announcement: step.observation.announcement,
    announcementCapture: step.observation.announcementCapture,
    announcementCount: step.observation.announcementCount,
    observeReason: step.observation.observeReason
  };
}

function summarizeDecisionForPrompt(decision: Decision): string {
  return "action" in decision
    ? formatDecisionAction(decision.action)
    : `verdict(${decision.verdict})`;
}

function formatAgentMemoryBlock(memory: AgentMemoryEntry[]): string {
  if (memory.length === 0) {
    return "agent memory: (empty)";
  }

  return [
    "agent memory:",
    ...memory.map((entry) =>
      `- step ${entry.step}: action=\"${entry.action}\", outcome=\"${entry.outcome}\"`
    )
  ].join("\n");
}

function buildKeyboardTaskInputRule(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  return [
    '이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.',
    "typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.",
    "입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라."
  ].join("\n");
}

function buildScreenReaderTaskInputRule(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  return [
    '이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.',
    "typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라."
  ].join("\n");
}

function buildKeyboardJsonFormat(taskInput?: TaskInput, includeRationale = false): string {
  if (taskInput) {
    return includeRationale
      ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
      : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}';
  }

  return includeRationale
    ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
    : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}';
}

function buildScreenReaderStrictJsonFormat(taskInput?: TaskInput, includeRationale = false): string {
  if (!taskInput && !includeRationale) {
    return [
      "형식:",
      '{"action":{"srCommand":"nextItem"}}',
      "또는",
      '{"verdict":"success"}',
      "또는",
      '{"verdict":"stuck","rationale":"..."}'
    ].join("\n");
  }

  if (taskInput) {
    return includeRationale
      ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
      : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}';
  }

  return 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}';
}

function buildScreenReaderHybridJsonFormat(taskInput?: TaskInput, includeRationale = false): string {
  if (!taskInput && !includeRationale) {
    return [
      "형식:",
      '{"action":{"srCommand":"nextItem"}}',
      "또는",
      '{"action":{"key":"Tab"}}',
      "또는",
      '{"verdict":"success"}',
      "또는",
      '{"verdict":"stuck","rationale":"..."}'
    ].join("\n");
  }

  if (taskInput) {
    return includeRationale
      ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
      : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}';
  }

  return 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}';
}

function buildRationaleRule(includeRationale: boolean): string {
  return includeRationale
    ? "rationale 필드에 짧은 이유를 포함하라."
    : "";
}
