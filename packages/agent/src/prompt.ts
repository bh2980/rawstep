import {
  ALLOWED_KEYS,
  buildAllowedScreenReaderActions,
  type Action,
  type AllowedKey,
  type AllowedScreenReaderAction,
  type AgentContext,
  type AgentMemoryEntry,
  type Decision,
  type Observation,
  type ScreenReaderAction,
  type ScreenReaderCapabilities,
  type StepRecord,
  type Task,
  type TaskInput,
  type TraceAggregate,
  type UserModel
} from "@rawstep/core";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

type ScreenReaderActionHints = {
  invoke?: {
    next?: string;
    previous?: string;
    act?: string;
    interact?: string;
    stopInteracting?: string;
    press?: string;
    type?: string;
    click?: string;
    perform?: {
      generic?: string;
      raw?: string;
      catalog?: Record<string, string>;
    };
  };
  read?: {
    itemText?: string;
    itemTextLog?: string;
    lastSpokenPhrase?: string;
    spokenPhraseLog?: string;
  };
  maintenance?: {
    clearItemTextLog?: string;
    clearSpokenPhraseLog?: string;
  };
};

type SystemPromptOptions = {
  promptDir?: string;
  extraInstructions?: string;
  keyHints?: Partial<Record<AllowedKey, string>>;
  screenReaderActionHints?: ScreenReaderActionHints;
  screenReaderCapabilities?: ScreenReaderCapabilities;
};

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  allowedKeys: readonly AllowedKey[] = ALLOWED_KEYS,
  allowedScreenReaderActions?: readonly AllowedScreenReaderAction[],
  includeRationale = false,
  options: SystemPromptOptions = {}
): string {
  const templates = loadPromptTemplates({ promptDir: options.promptDir });
  const resolvedScreenReaderActions = allowedScreenReaderActions
    ?? (options.screenReaderCapabilities ? buildAllowedScreenReaderActions(options.screenReaderCapabilities) : []);

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictSystem, {
      allowedScreenReaderActions: formatAllowedScreenReaderActionsForPrompt(resolvedScreenReaderActions),
      actionGuidance: buildActionGuidance(
        undefined,
        resolvedScreenReaderActions,
        options.keyHints,
        options.screenReaderActionHints,
        options.screenReaderCapabilities
      ),
      customInstructions: options.extraInstructions ?? "",
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderStrictJsonFormat(taskInput, includeRationale, resolvedScreenReaderActions),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridSystem, {
      allowedKeys: allowedKeys.join(", "),
      allowedScreenReaderActions: formatAllowedScreenReaderActionsForPrompt(resolvedScreenReaderActions),
      actionGuidance: buildActionGuidance(
        allowedKeys,
        resolvedScreenReaderActions,
        options.keyHints,
        options.screenReaderActionHints,
        options.screenReaderCapabilities
      ),
      customInstructions: options.extraInstructions ?? "",
      taskInputRule: buildScreenReaderTaskInputRule(taskInput),
      responseFormat: buildScreenReaderHybridJsonFormat(
        taskInput,
        includeRationale,
        resolvedScreenReaderActions
      ),
      rationaleRule: buildRationaleRule(includeRationale)
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    allowedKeys: allowedKeys.join(", "),
    actionGuidance: buildActionGuidance(
      allowedKeys,
      undefined,
      options.keyHints,
      undefined,
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
    if (obs.readbacks && obs.readbacks.length > 0) {
      lines.push(
        [
          "screen reader readbacks:",
          ...obs.readbacks.map((readback) =>
            readback.status === "cleared"
              ? `- ${readback.method}: cleared`
              : `- ${readback.method}: ${Array.isArray(readback.value) ? readback.value.join(" | ") : readback.value ?? ""}`
          )
        ].join("\n")
      );
    }
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

  if ("srAction" in action) {
    return formatScreenReaderAction(action.srAction);
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
        `- step ${entry.step}: action="${entry.action}", outcome="${entry.outcome}"`,
        entry.note ? `, note="${entry.note}"` : ""
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
    "typeText는 task에 정의된 입력 키만 선택한다. 임의 문자열이나 실제 비밀번호 값을 만들지 마라.",
    "srAction.kind=\"type\" 는 literal text를 직접 알고 있을 때만 사용하라. 숨겨진 task input 값은 typeText로만 선택하라."
  ].join("\n");
}

function buildKeyboardJsonFormat(taskInput?: TaskInput, includeRationale = false): string {
  const snippets = [
    includeRationale
      ? JSON.stringify({ action: { key: "Tab" }, rationale: "..." })
      : JSON.stringify({ action: { key: "Tab" } })
  ];

  if (taskInput) {
    const exampleKey = Object.keys(taskInput)[0];
    snippets.push(includeRationale
      ? JSON.stringify({ action: { typeText: exampleKey }, rationale: "..." })
      : JSON.stringify({ action: { typeText: exampleKey } }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return `JSON 형식: ${snippets.join(" 또는 ")}`;
}

function buildScreenReaderStrictJsonFormat(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  allowedActions: readonly AllowedScreenReaderAction[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(allowedActions, includeRationale);

  if (taskInput) {
    const exampleKey = Object.keys(taskInput)[0];
    snippets.push(includeRationale
      ? JSON.stringify({ action: { typeText: exampleKey }, rationale: "..." })
      : JSON.stringify({ action: { typeText: exampleKey } }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return `JSON 형식: ${snippets.join(" 또는 ")}`;
}

function buildScreenReaderHybridJsonFormat(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  allowedActions: readonly AllowedScreenReaderAction[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(allowedActions, includeRationale);
  snippets.push(includeRationale
    ? JSON.stringify({ action: { key: "Tab" }, rationale: "..." })
    : JSON.stringify({ action: { key: "Tab" } }));

  if (taskInput) {
    const exampleKey = Object.keys(taskInput)[0];
    snippets.push(includeRationale
      ? JSON.stringify({ action: { typeText: exampleKey }, rationale: "..." })
      : JSON.stringify({ action: { typeText: exampleKey } }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return `JSON 형식: ${snippets.join(" 또는 ")}`;
}

function buildVerdictSnippets(includeRationale: boolean): string[] {
  return includeRationale
    ? [
        JSON.stringify({ verdict: "success", rationale: "..." }),
        JSON.stringify({ verdict: "stuck", rationale: "..." })
      ]
    : [
        JSON.stringify({ verdict: "success" }),
        JSON.stringify({ verdict: "stuck", rationale: "..." })
      ];
}

function buildScreenReaderActionExampleSnippets(
  allowedActions: readonly AllowedScreenReaderAction[],
  includeRationale: boolean
): string[] {
  const snippets: string[] = [];
  const catalogPerformExample = allowedActions.find((action): action is Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }> =>
    action.kind === "invoke" && action.method === "perform" && action.source === "catalog"
  );
  const rawPerformAllowed = allowedActions.some((action) =>
    action.kind === "invoke" && action.method === "perform" && action.source === "raw"
  );

  if (catalogPerformExample) {
    snippets.push(
      stringifyActionExample({
        srAction: {
          kind: "invoke",
          method: "perform",
          command: { source: "catalog", id: catalogPerformExample.id }
        }
      }, includeRationale)
    );
  }

  if (rawPerformAllowed) {
    snippets.push(
      stringifyActionExample({
        srAction: {
          kind: "invoke",
          method: "perform",
          command: { source: "raw", payload: { characters: "hello" } }
        }
      }, includeRationale)
    );
  }

  for (const action of allowedActions) {
    if (action.kind === "invoke") {
      if (action.method === "perform") {
        continue;
      }

      snippets.push(stringifyActionExample({ srAction: exampleInvokeAction(action.method) }, includeRationale));
      continue;
    }

    if (action.kind === "read") {
      snippets.push(stringifyActionExample({ srAction: { kind: "read", method: action.method } }, includeRationale));
      continue;
    }

    snippets.push(stringifyActionExample({ srAction: { kind: "maintenance", method: action.method } }, includeRationale));
  }

  return dedupe(snippets);
}

function stringifyActionExample(action: Extract<Decision, { action: unknown }>["action"], includeRationale: boolean): string {
  return JSON.stringify(includeRationale ? { action, rationale: "..." } : { action });
}

function buildRationaleRule(includeRationale: boolean): string {
  return includeRationale
    ? "rationale 필드에 짧은 이유를 포함하라."
    : "";
}

function buildActionGuidance(
  allowedKeys: readonly AllowedKey[] | undefined,
  allowedScreenReaderActions: readonly AllowedScreenReaderAction[] | undefined,
  keyHints: Partial<Record<AllowedKey, string>> | undefined,
  screenReaderActionHints: ScreenReaderActionHints | undefined,
  screenReaderCapabilities: ScreenReaderCapabilities | undefined
): string {
  return [
    ...buildAllowedKeyGuidance(allowedKeys, keyHints),
    ...buildAllowedScreenReaderActionGuidance(
      allowedScreenReaderActions,
      screenReaderActionHints,
      screenReaderCapabilities
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

function buildAllowedScreenReaderActionGuidance(
  allowedActions: readonly AllowedScreenReaderAction[] | undefined,
  actionHints: ScreenReaderActionHints | undefined,
  capabilities: ScreenReaderCapabilities | undefined
): string[] {
  if (!allowedActions || allowedActions.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const capabilityDescriptions = new Map(
    (capabilities?.performCatalog ?? []).map((command) => [
      command.id,
      command.argsHint ? `${command.description} (${command.argsHint})` : command.description
    ])
  );
  const catalogPerformActions = allowedActions.filter((action): action is Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }> =>
    action.kind === "invoke" && action.method === "perform" && action.source === "catalog"
  );
  const rawPerformAllowed = allowedActions.some((action) =>
    action.kind === "invoke" && action.method === "perform" && action.source === "raw"
  );

  for (const method of ["next", "previous", "act", "interact", "stopInteracting", "press", "type", "click"] as const) {
    if (allowedActions.some((action) => action.kind === "invoke" && action.method === method)) {
      lines.push(actionHints?.invoke?.[method] ?? DEFAULT_INVOKE_HINTS[method]);
    }
  }

  if (catalogPerformActions.length > 0 || rawPerformAllowed) {
    lines.push(actionHints?.invoke?.perform?.generic ?? DEFAULT_INVOKE_HINTS.perform);
    if (rawPerformAllowed) {
      lines.push(actionHints?.invoke?.perform?.raw ?? DEFAULT_PERFORM_RAW_HINT);
    }
    if (catalogPerformActions.length <= 20) {
      for (const action of catalogPerformActions) {
        lines.push(`- ${action.id}: ${actionHints?.invoke?.perform?.catalog?.[action.id] ?? capabilityDescriptions.get(action.id) ?? action.id}`);
      }
    }
  }

  for (const method of ["itemText", "itemTextLog", "lastSpokenPhrase", "spokenPhraseLog"] as const) {
    if (allowedActions.some((action) => action.kind === "read" && action.method === method)) {
      lines.push(actionHints?.read?.[method] ?? DEFAULT_READ_HINTS[method]);
    }
  }

  for (const method of ["clearItemTextLog", "clearSpokenPhraseLog"] as const) {
    if (allowedActions.some((action) => action.kind === "maintenance" && action.method === method)) {
      lines.push(actionHints?.maintenance?.[method] ?? DEFAULT_MAINTENANCE_HINTS[method]);
    }
  }

  return lines;
}

function formatAllowedScreenReaderActionsForPrompt(
  allowedActions: readonly AllowedScreenReaderAction[]
): string {
  if (allowedActions.length === 0) {
    return "(none)";
  }

  const invokeMethods = dedupe(
    allowedActions
      .filter((action): action is Extract<AllowedScreenReaderAction, { kind: "invoke" }> => action.kind === "invoke" && action.method !== "perform")
      .map((action) => action.method)
  );
  const performIds = allowedActions
    .filter((action): action is Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }> =>
      action.kind === "invoke" && action.method === "perform" && action.source === "catalog"
    )
    .map((action) => action.id);
  const rawPerformAllowed = allowedActions.some((action) =>
    action.kind === "invoke" && action.method === "perform" && action.source === "raw"
  );
  const readMethods = allowedActions
    .filter((action): action is Extract<AllowedScreenReaderAction, { kind: "read" }> => action.kind === "read")
    .map((action) => action.method);
  const maintenanceMethods = allowedActions
    .filter((action): action is Extract<AllowedScreenReaderAction, { kind: "maintenance" }> => action.kind === "maintenance")
    .map((action) => action.method);

  return [
    invokeMethods.length > 0 ? `invoke methods: ${invokeMethods.join(", ")}` : undefined,
    performIds.length > 0 ? `perform ids: ${performIds.join(", ")}` : undefined,
    rawPerformAllowed ? "perform raw payloads: allowed" : undefined,
    readMethods.length > 0 ? `read methods: ${readMethods.join(", ")}` : undefined,
    maintenanceMethods.length > 0 ? `maintenance methods: ${maintenanceMethods.join(", ")}` : undefined
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function formatScreenReaderAction(action: ScreenReaderAction): string {
  if (action.kind === "read") {
    return `srAction.read(${action.method})`;
  }

  if (action.kind === "maintenance") {
    return `srAction.maintenance(${action.method})`;
  }

  switch (action.method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return `srAction.invoke(${action.method})`;
    case "perform":
      return action.command.source === "catalog"
        ? `srAction.perform(${action.command.id})`
        : "srAction.perform(raw)";
    case "press":
      return `srAction.press(${action.key})`;
    case "type":
      return `srAction.type(${action.text})`;
    case "click":
      return `srAction.click(${action.options?.button ?? "left"},${action.options?.clickCount ?? 1})`;
  }
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
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

const DEFAULT_INVOKE_HINTS = {
  next: "next는 screen reader cursor를 다음 위치로 이동할 때 사용하라.",
  previous: "previous는 screen reader cursor를 이전 위치로 이동할 때 사용하라.",
  act: "act는 현재 항목의 기본 동작을 실행할 때 사용하라.",
  interact: "interact는 현재 항목과 상호작용을 시작할 때 사용하라.",
  stopInteracting: "stopInteracting은 현재 상호작용을 끝낼 때 사용하라.",
  press: "press는 현재 screenreader 세션을 통해 특정 키를 누를 때 사용하라.",
  type: "type는 현재 screenreader 세션을 통해 literal text를 입력할 때 사용하라.",
  click: "click은 현재 screenreader 세션을 통해 마우스 클릭을 실행할 때 사용하라.",
  perform: "perform은 허용된 perform id 목록이나 raw payload를 사용해 Guidepup 고급 command를 실행할 때 사용하라."
} as const;

const DEFAULT_PERFORM_RAW_HINT = "raw perform은 backend가 raw payload를 지원할 때만 사용하라. payload는 실제 Guidepup command object와 맞아야 한다." as const;

const DEFAULT_READ_HINTS = {
  itemText: "itemText는 현재 cursor가 가리키는 항목의 텍스트를 직접 읽고 싶을 때 사용하라.",
  itemTextLog: "itemTextLog는 방문한 항목 텍스트 로그 전체를 확인하고 싶을 때 사용하라.",
  lastSpokenPhrase: "lastSpokenPhrase는 가장 최근에 읽힌 발화 한 줄을 확인할 때 사용하라.",
  spokenPhraseLog: "spokenPhraseLog는 현재까지의 발화 로그 전체를 확인할 때 사용하라."
} as const;

const DEFAULT_MAINTENANCE_HINTS = {
  clearItemTextLog: "clearItemTextLog는 item text 로그를 비우고 이후 새 로그만 보려 할 때 사용하라.",
  clearSpokenPhraseLog: "clearSpokenPhraseLog는 spoken phrase 로그를 비우고 이후 새 발화만 보려 할 때 사용하라."
} as const;

function exampleInvokeAction(
  method: Exclude<Extract<AllowedScreenReaderAction, { kind: "invoke" }>["method"], "perform">
): Exclude<ScreenReaderAction, { kind: "read" } | { kind: "maintenance" } | { kind: "invoke"; method: "perform" }> {
  switch (method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return { kind: "invoke", method };
    case "press":
      return { kind: "invoke", method: "press", key: "Enter" };
    case "type":
      return { kind: "invoke", method: "type", text: "hello" };
    case "click":
      return { kind: "invoke", method: "click", options: { button: "left", clickCount: 1 } };
  }
}
