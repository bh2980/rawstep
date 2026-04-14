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
  type ResolvedPromptKeyboardAction,
  type ResolvedPromptScreenReaderAction,
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

type SystemPromptOptions = {
  promptDir?: string;
  keyboardActions?: readonly ResolvedPromptKeyboardAction[];
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[];
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
  const resolvedPromptKeyboardActions = options.keyboardActions
    ?? buildFallbackPromptKeyboardActions(allowedKeys);
  const resolvedScreenReaderActions = allowedScreenReaderActions
    ?? (options.screenReaderCapabilities ? buildAllowedScreenReaderActions(options.screenReaderCapabilities) : []);
  const resolvedPromptScreenReaderActions = options.screenReaderActions
    ?? buildFallbackPromptScreenReaderActions(resolvedScreenReaderActions);

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictSystem, {
      screenReaderActionsBlock: buildScreenReaderActionsBlock(resolvedPromptScreenReaderActions),
      taskInputBlock: buildScreenReaderTaskInputBlock(taskInput),
      outputBlock: buildScreenReaderStrictOutputBlock(taskInput, includeRationale, resolvedScreenReaderActions)
    });
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridSystem, {
      keyboardActionsBlock: buildKeyboardActionsBlock(allowedKeys, resolvedPromptKeyboardActions),
      screenReaderActionsBlock: buildScreenReaderActionsBlock(resolvedPromptScreenReaderActions),
      taskInputBlock: buildScreenReaderTaskInputBlock(taskInput),
      outputBlock: buildScreenReaderHybridOutputBlock(
        taskInput,
        includeRationale,
        resolvedScreenReaderActions
      )
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    keyboardActionsBlock: buildKeyboardActionsBlock(allowedKeys, resolvedPromptKeyboardActions),
    taskInputBlock: buildKeyboardTaskInputBlock(taskInput),
    outputBlock: buildKeyboardOutputBlock(taskInput, includeRationale)
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

function buildKeyboardTaskInputBlock(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  const keys = Object.keys(taskInput);
  const exampleKey = keys[0];
  return [
    "입력 규칙:",
    "- task input의 실제 문자열 값은 보이지 않는다. input key 이름만 보고 판단하라.",
    `- 사용 가능한 input key: ${keys.join(", ")}`,
    "- typeText에는 input key 이름만 넣어라. 실제 문자열 값은 만들지 마라.",
    "- focus hint가 입력창을 가리킬 때만 typeText를 우선 검토하라.",
    "- 예시:",
    `  - ${JSON.stringify({ action: { typeText: exampleKey } })}`
  ].join("\n");
}

function buildScreenReaderTaskInputBlock(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  const keys = Object.keys(taskInput);
  const exampleKey = keys[0];
  return [
    "입력 규칙:",
    "- task input의 실제 문자열 값은 보이지 않는다. input key 이름만 보고 판단하라.",
    `- 사용 가능한 input key: ${keys.join(", ")}`,
    "- typeText에는 input key 이름만 넣어라. 실제 문자열 값은 만들지 마라.",
    "- srAction.type은 literal text를 직접 입력할 때만 사용하라. task input 값에는 쓰지 마라.",
    "- 예시:",
    `  - ${JSON.stringify({ action: { typeText: exampleKey } })}`
  ].join("\n");
}

function buildKeyboardOutputBlock(taskInput?: TaskInput, includeRationale = false): string {
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
  return buildOutputBlock(snippets, includeRationale);
}

function buildScreenReaderStrictOutputBlock(
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
  return buildOutputBlock(snippets, includeRationale);
}

function buildScreenReaderHybridOutputBlock(
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
  return buildOutputBlock(snippets, includeRationale);
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

function buildOutputBlock(snippets: readonly string[], includeRationale: boolean): string {
  return [
    "출력 규칙:",
    "- JSON 객체 하나만 반환하라.",
    "- 한 턴에 action 또는 verdict 중 하나만 반환하라.",
    ...(includeRationale ? ["- action 또는 verdict를 반환할 때 rationale를 포함하라."] : []),
    "- 예시:",
    ...snippets.map((snippet) => `  - ${snippet}`)
  ].join("\n");
}

function buildKeyboardActionsBlock(
  allowedKeys: readonly AllowedKey[] | undefined,
  keyboardActions: readonly ResolvedPromptKeyboardAction[] | undefined
): string {
  if (!allowedKeys || allowedKeys.length === 0) {
    return "- (none)";
  }

  const promptActions = keyboardActions ?? buildFallbackPromptKeyboardActions(allowedKeys);
  return promptActions
    .map((action) => action.hint ? `- ${action.key}: ${action.hint}` : `- ${action.key}`)
    .join("\n");
}

function buildScreenReaderActionsBlock(
  promptActions: readonly ResolvedPromptScreenReaderAction[] | undefined
): string {
  if (!promptActions || promptActions.length === 0) {
    return "- (none)";
  }

  return promptActions
    .map((action) => {
      const label = action.semantic === "catalog"
        ? `catalog(${action.id})`
        : action.semantic;
      return action.hint ? `- ${label}: ${action.hint}` : `- ${label}`;
    })
    .join("\n");
}

function buildFallbackPromptKeyboardActions(
  allowedKeys: readonly AllowedKey[]
): readonly ResolvedPromptKeyboardAction[] {
  return allowedKeys.map((key) => ({ key }));
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

function buildFallbackPromptScreenReaderActions(
  allowedActions: readonly AllowedScreenReaderAction[]
): readonly ResolvedPromptScreenReaderAction[] {
  return allowedActions.map((action) => {
    if (action.kind === "read") {
      return {
        semantic: `read.${action.method}` as Extract<ResolvedPromptScreenReaderAction["semantic"], `read.${string}`>,
        runtimeAction: action
      };
    }

    if (action.kind === "maintenance") {
      return {
        semantic: action.method === "clearItemTextLog" ? "clear.itemTextLog" : "clear.spokenPhraseLog",
        runtimeAction: action
      };
    }

    if (action.method === "perform") {
      return action.source === "catalog"
        ? {
            semantic: "catalog",
            id: action.id,
            runtimeAction: action
          }
        : {
            semantic: "rawPerform",
            runtimeAction: action
          };
    }

    return {
      semantic: action.method,
      runtimeAction: action
    };
  });
}
