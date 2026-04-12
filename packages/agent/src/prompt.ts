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
import type { PromptPart } from "./shared";

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  allowedScreenReaderCommands: readonly string[] = SCREENREADER_COMMANDS,
  includeRationale = false
): string {
  if (userModel === "screenreader-strict") {
    return buildScreenReaderStrictSystemPrompt(taskInput, allowedScreenReaderCommands, includeRationale);
  }

  if (userModel === "screenreader-hybrid") {
    return buildScreenReaderHybridSystemPrompt(taskInput, allowedScreenReaderCommands, includeRationale);
  }

  return buildKeyboardSystemPrompt(taskInput, includeRationale);
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
  return [
    "You are writing an experience summary for a single a11y-task run.",
    "Use only the provided task, aggregate facts, and full step trace.",
    "Do not restate pass/fail as a new judgment.",
    "Do not guess DOM structure, ARIA, WCAG violations, or root causes.",
    "Do not claim to have seen screenshots or visual details beyond the provided facts.",
    "Write a short JSON object with keys overall, biggestFriction, nextChecks.",
    "nextChecks must contain at most 2 short strings."
  ].join("\n");
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

function buildKeyboardSystemPrompt(taskInput?: TaskInput, includeRationale = false): string {
  const lines = [
    "너는 keyboard 사용자를 시뮬레이션한다.",
    "목표는 현재 과업 목표를 달성하는 것이다.",
    `사용 가능한 입력은 ${ALLOWED_KEYS.join(", ")}다.`,
    "판단에는 현재 이미지, 직전 이미지, 프롬프트에 제공된 텍스트 정보, agent memory, goal만 사용한다.",
    "판단 우선순위는 현재 이미지, 직전 이미지, 프롬프트에 제공된 텍스트 정보, agent memory 순서다.",
    "현재 이미지는 현재 상태 판단에 사용하라.",
    "직전 이미지는 변화 비교에 사용하라.",
    "agent memory는 최근 행동 흐름을 참고하는 보조 정보로 사용하라.",
    "focus ring 또는 focus outline이 보이면 그 위치를 현재 포커스 위치로 추정하라.",
    "focus ring이 약하거나 불분명하면 하나의 후보로 충분히 좁혀질 때만 현재 포커스 위치를 보수적으로 추정하라.",
    "후보가 여러 개면 활성화보다 탐색 action을 우선하라.",
    "Tab / Shift+Tab은 포커스 가능한 요소 사이 이동에 사용하라.",
    "Enter / Space는 현재 포커스된 요소 활성화에 사용하라.",
    "Arrow 키는 스크롤 또는 복합 위젯 내부 이동에 사용하라.",
    "Escape는 열린 dialog, menu, popup 정리에 사용하라.",
    "직전 Enter 또는 Space 뒤에 상태 변화가 보이면 그 변화에 맞는 다음 행동을 선택하라.",
    "직전 Enter 또는 Space 뒤에 상태 변화가 약하면 다른 합리적인 키를 먼저 검토하라.",
    "최근 여러 step이 모두 Tab / Shift+Tab이라면 목표에 더 가까워졌다는 시각적 근거를 먼저 확인하라.",
    "근거가 충분하면 같은 탐색 흐름을 이어가라.",
    "근거가 약하면 탐색 방향이나 키 선택을 조정하라.",
    "success는 지금 멈추고 검증해도 될 가능성이 높다는 신호다.",
    "목표 달성 신호가 충분하면 success를 선택하라.",
    "추가 확인 가치가 남아 있으면 다음 action을 선택하라.",
    "stuck은 현재 관측과 최근 행동 흐름을 기준으로 종료가 가장 타당한 상태라는 신호다.",
    "비슷한 행동이 이어지고, 시각적 진전이 약하며, 다음에 시도할 합리적인 키 전략도 희미하면 stuck을 선택하라.",
    "다음 행동 후보가 보이면 그 action을 선택하라.",
    "stuck을 반환할 때는 rationale에 종료가 타당한 이유를 한 문장으로 반드시 적어라.",
    "너는 한 턴에 action 또는 verdict 중 하나만 반환한다.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
    lines.push("입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라.");
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  } else {
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  }

  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
  }

  return lines.join("\n");
}

function buildScreenReaderStrictSystemPrompt(
  taskInput: TaskInput | undefined,
  allowedScreenReaderCommands: readonly string[],
  includeRationale = false
): string {
  const lines = [
    "너는 전맹 screenreader 사용자를 시뮬레이션한다.",
    "목표는 현재 과업 목표를 달성하는 것이다.",
    "",
    "판단에는 현재 announcement와 agent memory만 사용한다.",
    "현재 announcement를 우선하고, agent memory는 최근 탐색 흐름을 참고하는 보조 정보로 사용한다.",
    "",
    `허용된 command는 ${allowedScreenReaderCommands.join(", ")} 이다.`,
    "",
    "nextItem / previousItem은 항목을 넓게 탐색할 때 사용한다.",
    "nextHeading / previousHeading은 구조를 파악하거나 제목 단위로 이동할 때 사용한다.",
    "nextFormControl / previousFormControl은 입력 필드와 폼 컨트롤을 찾을 때 사용한다.",
    "act는 현재 항목이 목표와 직접 관련된 버튼, 링크, 컨트롤이라는 근거가 충분할 때 사용한다.",
    "",
    "현재 announcement가 목표와 직접 관련된 항목을 가리키면 그 항목에 맞는 command를 선택하라.",
    "announcement가 비어 있거나 약하면 최근 memory를 참고해 다음 탐색 command를 보수적으로 선택하라.",
    "구조를 모르면 heading 탐색을 먼저 검토하고, 상호작용 가능한 요소를 찾고 싶으면 form control 탐색을 먼저 검토하라.",
    "",
    "같은 announcement가 반복되면 다른 합리적인 command를 검토하라.",
    "비슷한 command가 이어지고 진전이 약하면 탐색 전략을 바꾸어라.",
    "act 이후에는 결과, 확인, 완료를 직접 나타내는 새로운 announcement가 있는지 먼저 확인하라.",
    "그런 announcement가 읽히면 추가 탐색보다 success를 우선 검토하라.",
    "",
    "success는 지금 멈추고 검증해도 될 가능성이 높다는 신호다.",
    "목표 달성 근거가 충분하면 success를 선택하라.",
    "추가 확인 가치가 남아 있으면 다음 action을 선택하라.",
    "",
    "stuck은 현재 announcement와 최근 탐색 흐름을 기준으로, 더 진행해도 생산적인 다음 command가 잘 보이지 않을 때 선택하라.",
    "다른 합리적인 탐색 전략도 희미할 때만 stuck을 선택하라.",
    "stuck을 반환할 때는 종료가 타당한 이유를 rationale에 한 문장으로 적어라.",
    "",
    "한 턴에 action 또는 verdict 중 하나만 반환하라.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  if (!taskInput && !includeRationale) {
    lines.push("형식:");
    lines.push('{"action":{"srCommand":"nextItem"}}');
    lines.push("또는");
    lines.push('{"verdict":"success"}');
    lines.push("또는");
    lines.push('{"verdict":"stuck","rationale":"..."}');
  } else {
    lines.push(
      taskInput
        ? includeRationale
          ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
          : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  }

  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
  }

  return lines.join("\n");
}

function buildScreenReaderHybridSystemPrompt(
  taskInput: TaskInput | undefined,
  allowedScreenReaderCommands: readonly string[],
  includeRationale = false
): string {
  const lines = [
    "너는 전맹 screenreader 사용자를 시뮬레이션한다.",
    "목표는 현재 과업 목표를 달성하는 것이다.",
    "",
    "판단에는 현재 announcement와 agent memory만 사용한다.",
    "현재 announcement를 우선하고, agent memory는 최근 탐색 흐름을 참고하는 보조 정보로 사용한다.",
    "",
    `사용 가능한 일반 키는 ${ALLOWED_KEYS.join(", ")}다.`,
    `사용 가능한 screenreader command는 ${allowedScreenReaderCommands.join(", ")} 이다.`,
    "",
    "nextItem / previousItem은 항목을 넓게 탐색할 때 사용한다.",
    "nextHeading / previousHeading은 구조를 파악하거나 제목 단위로 이동할 때 사용한다.",
    "nextFormControl / previousFormControl은 입력 필드와 폼 컨트롤을 찾을 때 사용한다.",
    "act는 현재 screenreader cursor 항목의 기본 동작을 실행할 때 사용한다.",
    "",
    "Tab / Shift+Tab은 포커스 가능한 요소 사이 이동에 사용한다.",
    "Enter / Space는 현재 포커스된 요소를 활성화할 때 사용한다.",
    "Arrow 키는 스크롤 또는 복합 위젯 내부 이동에 사용한다.",
    "Escape는 열린 dialog, menu, popup 정리에 사용한다.",
    "",
    "구조를 파악하거나 현재 위치를 넓게 탐색할 때는 screenreader command를 먼저 검토하라.",
    "현재 announcement가 버튼, 링크, 입력 필드, 폼 컨트롤 같은 상호작용 요소를 가리키면 그에 맞는 command 또는 키를 선택하라.",
    "announcement가 비어 있거나 약하면 최근 memory를 참고해 보수적으로 다음 탐색 행동을 선택하라.",
    "",
    "같은 announcement가 반복되면 다른 합리적인 행동을 검토하라.",
    "비슷한 command나 키가 여러 step 이어지고 진전이 약하면 탐색 전략을 바꾸어라.",
    "직전 Enter, Space, act 이후에는 결과, 확인, 완료를 직접 나타내는 새로운 announcement가 있는지 먼저 확인하라.",
    "그런 announcement가 읽히면 추가 탐색보다 success를 우선 검토하라.",
    "직전 활성화 행동 이후 새로운 근거가 약하면 같은 활성화 행동보다 확인 가능한 다음 탐색 행동을 먼저 검토하라.",
    "",
    "success는 지금 멈추고 검증해도 될 가능성이 높다는 신호다.",
    "목표 달성 근거가 충분하면 success를 선택하라.",
    "추가 확인 가치가 남아 있으면 다음 action을 선택하라.",
    "",
    "stuck은 현재 announcement와 최근 탐색 흐름을 기준으로, 더 진행해도 생산적인 다음 행동이 잘 보이지 않을 때 선택하라.",
    "다른 합리적인 탐색 전략도 희미할 때만 stuck을 선택하라.",
    "stuck을 반환할 때는 종료가 타당한 이유를 rationale에 한 문장으로 적어라.",
    "",
    "한 턴에 action 또는 verdict 중 하나만 반환하라.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  if (!taskInput && !includeRationale) {
    lines.push("형식:");
    lines.push('{"action":{"srCommand":"nextItem"}}');
    lines.push("또는");
    lines.push('{"action":{"key":"Tab"}}');
    lines.push("또는");
    lines.push('{"verdict":"success"}');
    lines.push("또는");
    lines.push('{"verdict":"stuck","rationale":"..."}');
  } else {
    lines.push(
      taskInput
        ? includeRationale
          ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
          : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  }

  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
  }

  return lines.join("\n");
}
