import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type Action,
  type AllowedKey,
  type AgentContext,
  type AgentMemoryEntry,
  type Decision,
  type Observation,
  type ScreenReaderCommand,
  type StepRecord,
  type Task,
  type TaskInput,
  type TraceAggregate,
  type UserModel
} from "@rawstep/core";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

type SystemPromptOptions = {
  promptDir?: string;
  extraInstructions?: string;
  keyHints?: Partial<Record<AllowedKey, string>>;
  screenReaderCommandHints?: Partial<Record<ScreenReaderCommand, string>>;
};

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  allowedKeys: readonly AllowedKey[] = ALLOWED_KEYS,
  allowedScreenReaderCommands: readonly ScreenReaderCommand[] = SCREENREADER_COMMANDS,
  includeRationale = false,
  options: SystemPromptOptions = {}
): string {
  const templates = loadPromptTemplates({ promptDir: options.promptDir });

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictSystem, {
      allowedScreenReaderCommands: allowedScreenReaderCommands.join(", "),
      actionGuidance: buildActionGuidance(
        undefined,
        allowedScreenReaderCommands,
        undefined,
        options.screenReaderCommandHints
      ),
      customInstructions: options.extraInstructions ?? "",
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderStrictJsonFormat(taskInput, includeRationale),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridSystem, {
      allowedKeys: allowedKeys.join(", "),
      allowedScreenReaderCommands: allowedScreenReaderCommands.join(", "),
      actionGuidance: buildActionGuidance(
        allowedKeys,
        allowedScreenReaderCommands,
        options.keyHints,
        options.screenReaderCommandHints
      ),
      customInstructions: options.extraInstructions ?? "",
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderHybridJsonFormat(taskInput, includeRationale),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    allowedKeys: allowedKeys.join(", "),
    actionGuidance: buildActionGuidance(
      allowedKeys,
      undefined,
      options.keyHints,
      undefined
    ),
    customInstructions: options.extraInstructions ?? "",
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
    lines.push(`available input keys: ${Object.keys(taskInput).join(", ")}`);
  }

  if (obs.kind === "keyboard") {
    if (obs.focusHint) {
      lines.push(
        obs.focusHint === "none"
          ? "focus hint: none (현재 focus된 인터랙티브 요소가 감지되지 않았다.)"
          : `focus hint: ${obs.focusHint}`
      );
    }

    lines.push(
      obs.previousScreenshot
        ? "images: 첫 번째 이미지는 현재 스크린샷, 두 번째 이미지는 직전 스크린샷이다. 두 이미지를 비교하여 focus ring이 어디서 어디로 이동했는지 확인하라."
        : "images: 현재 스크린샷 1장이 첨부되어 있다. 직전 스크린샷은 없다 (첫 번째 스텝)."
    );
  }

  return lines.join("\n");
}

export function buildExperienceSummarySystemPrompt(promptDir?: string): string {
  return loadPromptTemplates({ promptDir }).experienceSummarySystem;
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

  return `typeText(${action.typeText})`;
}

function summarizeObservationForPrompt(step: StepRecord): object {
  if (step.observation.kind === "keyboard") {
    return {
      kind: "keyboard",
      title: step.observation.browserChrome.title,
      urlPath: step.observation.browserChrome.urlPath,
      focusHint: step.observation.focusHint,
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
      [
        `- step ${entry.step}: action=\"${entry.action}\", outcome=\"${entry.outcome}\"`,
        entry.note ? `, note=\"${entry.note}\"` : ""
      ].join("")
    )
  ].join("\n");
}

function buildKeyboardTaskInputRule(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  const keys = Object.keys(taskInput);
  const exampleKey = keys[0];
  return [
    `이 task에서는 action으로 {"typeText":"${exampleKey}"} 같은 named input key를 선택할 수 있다.`,
    `사용 가능한 input keys: ${keys.join(", ")}.`,
    "typeText는 task에 정의된 입력 키만 선택한다. 임의 문자열이나 실제 비밀번호 값을 만들지 마라.",
    "focus hint는 현재 active element의 요약이다. focus hint가 none, link, button, select라면 typeText보다 탐색 action을 우선 검토하라.",
    "typeText는 현재 focus가 텍스트 입력창(input, textarea, contenteditable)에 있다고 보일 때 우선 고려하라.",
    "focus가 입력창에 있다고 확신하기 어렵다면, 먼저 Tab 또는 Shift+Tab 같은 탐색 action을 검토하라.",
    "직전 step에서 typeText가 실패했거나 화면 변화가 거의 없었다면, 같은 판단을 반복하기 전에 focus 변화 근거를 다시 확인하라.",
    "입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라."
  ].join("\n");
}

function buildScreenReaderTaskInputRule(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  const keys = Object.keys(taskInput);
  const exampleKey = keys[0];
  return [
    `이 task에서는 action으로 {"typeText":"${exampleKey}"} 같은 named input key를 선택할 수 있다.`,
    `사용 가능한 input keys: ${keys.join(", ")}.`,
    "typeText는 task에 정의된 입력 키만 선택한다. 임의 문자열이나 실제 비밀번호 값을 만들지 마라."
  ].join("\n");
}

function buildKeyboardJsonFormat(taskInput?: TaskInput, includeRationale = false): string {
  if (taskInput) {
    const exampleKey = Object.keys(taskInput)[0];
    return includeRationale
      ? `JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"${exampleKey}"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}`
      : `JSON 형식: {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"${exampleKey}"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}`;
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
    const exampleKey = Object.keys(taskInput)[0];
    return includeRationale
      ? `JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"typeText":"${exampleKey}"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}`
      : `JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"typeText":"${exampleKey}"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}`;
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
    const exampleKey = Object.keys(taskInput)[0];
    return includeRationale
      ? `JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"${exampleKey}"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}`
      : `JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"${exampleKey}"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}`;
  }

  return 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}';
}

function buildRationaleRule(includeRationale: boolean): string {
  return includeRationale
    ? "rationale 필드에 짧은 이유를 포함하라."
    : "";
}

function buildActionGuidance(
  allowedKeys: readonly AllowedKey[] | undefined,
  allowedScreenReaderCommands: readonly ScreenReaderCommand[] | undefined,
  keyHints: Partial<Record<AllowedKey, string>> | undefined,
  screenReaderCommandHints: Partial<Record<ScreenReaderCommand, string>> | undefined
): string {
  return [
    ...buildAllowedKeyGuidance(allowedKeys, keyHints),
    ...buildAllowedScreenReaderCommandGuidance(
      allowedScreenReaderCommands,
      screenReaderCommandHints
    )
  ].join("\n");
}

function buildAllowedKeyGuidance(
  allowedKeys: readonly AllowedKey[] | undefined,
  keyHints: Partial<Record<AllowedKey, string>> | undefined
): string[] {
  if (!allowedKeys || allowedKeys.length === 0) {
    return [];
  }

  return allowedKeys.map((key) => keyHints?.[key] ?? DEFAULT_KEY_HINTS[key]);
}

function buildAllowedScreenReaderCommandGuidance(
  allowedCommands: readonly ScreenReaderCommand[] | undefined,
  commandHints: Partial<Record<ScreenReaderCommand, string>> | undefined
): string[] {
  if (!allowedCommands || allowedCommands.length === 0) {
    return [];
  }

  return allowedCommands.map((command) => commandHints?.[command] ?? DEFAULT_SCREEN_READER_COMMAND_HINTS[command]);
}

const DEFAULT_KEY_HINTS: Record<AllowedKey, string> = {
  Tab: "Tab은 포커스 가능한 요소를 다음으로 이동할 때 사용하라.",
  "Shift+Tab": "Shift+Tab은 포커스 가능한 요소를 이전으로 이동할 때 사용하라.",
  Home: "Home은 현재 문맥의 시작으로 크게 이동할 때 사용하라.",
  End: "End는 현재 문맥의 끝으로 크게 이동할 때 사용하라.",
  ArrowUp: "ArrowUp은 스크롤을 올리거나 복합 위젯 내부에서 위쪽으로 이동할 때 사용하라.",
  ArrowDown: "ArrowDown은 스크롤을 내리거나 복합 위젯 내부에서 아래쪽으로 이동할 때 사용하라.",
  ArrowLeft: "ArrowLeft는 복합 위젯 내부에서 왼쪽으로 이동할 때 사용하라.",
  ArrowRight: "ArrowRight는 복합 위젯 내부에서 오른쪽으로 이동할 때 사용하라.",
  Enter: "Enter는 현재 포커스된 요소를 활성화할 때 사용하라.",
  Space: "Space는 현재 포커스된 요소를 활성화하거나 토글할 때 사용하라.",
  Escape: "Escape는 열린 dialog, menu, popup을 닫거나 현재 상태를 정리할 때 사용하라."
};

const DEFAULT_SCREEN_READER_COMMAND_HINTS: Record<ScreenReaderCommand, string> = {
  nextItem: "nextItem은 항목을 넓게 탐색할 때 사용하라.",
  previousItem: "previousItem은 이전 항목으로 돌아가며 탐색할 때 사용하라.",
  nextHeading: "nextHeading은 구조를 파악하거나 다음 제목으로 이동할 때 사용하라.",
  previousHeading: "previousHeading은 이전 제목으로 이동하며 구조를 다시 확인할 때 사용하라.",
  nextFormControl: "nextFormControl은 다음 입력 필드나 폼 컨트롤을 찾을 때 사용하라.",
  previousFormControl: "previousFormControl은 이전 입력 필드나 폼 컨트롤로 돌아갈 때 사용하라.",
  act: "act는 현재 screenreader cursor 항목의 기본 동작을 실행할 때 사용하라."
};
