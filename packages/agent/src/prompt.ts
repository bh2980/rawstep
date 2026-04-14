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
import {
  formatResolvedPromptScreenReaderActionName,
  getBuiltInScreenReaderSemanticByCatalogId
} from "./action-strings";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

type SystemPromptOptions = {
  promptDir?: string;
  keyboardActions?: readonly ResolvedPromptKeyboardAction[];
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[];
  screenReaderCapabilities?: ScreenReaderCapabilities;
};

type UserPromptOptions = {
  promptDir?: string;
  keyboardActions?: readonly ResolvedPromptKeyboardAction[];
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[];
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
  const resolvedPromptScreenReaderActions = options.screenReaderActions
    ?? buildFallbackPromptScreenReaderActions(resolvedScreenReaderActions);

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictSystem, {
      outputExamples: buildScreenReaderStrictOutputExamples(taskInput, includeRationale, resolvedPromptScreenReaderActions)
    });
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridSystem, {
      outputExamples: buildScreenReaderHybridOutputExamples(
        taskInput,
        includeRationale,
        allowedKeys,
        resolvedPromptScreenReaderActions
      )
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    outputExamples: buildKeyboardOutputExamples(taskInput, allowedKeys, includeRationale)
  });
}

export function buildPromptParts(
  userModel: UserModel,
  ctx: AgentContext,
  obs: Observation,
  taskInput?: TaskInput,
  options: UserPromptOptions = {}
): PromptPart[] {
  const promptParts: PromptPart[] = [
    {
      type: "text",
      text: buildUserPromptText(userModel, ctx, obs, taskInput, options)
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

export function buildUserPromptText(
  userModel: UserModel,
  ctx: AgentContext,
  obs: Observation,
  taskInput?: TaskInput,
  options: UserPromptOptions = {}
): string {
  const templates = loadPromptTemplates({ promptDir: options.promptDir });
  const resolvedPromptKeyboardActions = options.keyboardActions
    ?? buildFallbackPromptKeyboardActions(ctx.allowedKeys);
  const resolvedPromptScreenReaderActions = options.screenReaderActions
    ?? buildFallbackPromptScreenReaderActions(ctx.allowedScreenReaderActions ?? []);

  const commonReplacements = {
    goal: buildGoalValue(ctx.goal),
    agentMemory: buildAgentMemoryValue(ctx.memory),
    focusHint: buildFocusHintValue(obs),
    announcement: buildAnnouncementValue(obs),
    readbacks: buildReadbacksValue(obs),
    availableActions: buildAvailableActionsValue(
      userModel,
      ctx.allowedKeys,
      ctx.allowedScreenReaderActions ?? [],
      resolvedPromptKeyboardActions,
      resolvedPromptScreenReaderActions,
      taskInput
    )
  };

  if (userModel === "screenreader-strict") {
    return renderPromptTemplate(templates.screenreaderStrictUser, commonReplacements);
  }

  if (userModel === "screenreader-hybrid") {
    return renderPromptTemplate(templates.screenreaderHybridUser, commonReplacements);
  }

  return renderPromptTemplate(templates.keyboardUser, commonReplacements);
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

function buildGoalValue(goal: string): string {
  return goal;
}

function buildAgentMemoryValue(memory: AgentMemoryEntry[]): string {
  if (memory.length === 0) {
    return "";
  }

  return memory.map((entry) =>
    [
      `- step ${entry.step}: action="${entry.action}", outcome="${entry.outcome}"`,
      entry.note ? `, note="${entry.note}"` : ""
    ].join("")
  ).join("\n");
}

function buildKeyboardOutputExamples(
  taskInput: TaskInput | undefined,
  allowedKeys: readonly AllowedKey[],
  includeRationale = false
): string {
  const exampleKey = `key.${allowedKeys[0] ?? "<key>"}`;
  const snippets = [
    includeRationale
      ? JSON.stringify({ action: exampleKey, rationale: "..." })
      : JSON.stringify({ action: exampleKey })
  ];

  if (taskInput) {
    const exampleKey = `typeText.${Object.keys(taskInput)[0] ?? "<input-key>"}`;
    snippets.push(includeRationale
      ? JSON.stringify({ action: exampleKey, rationale: "..." })
      : JSON.stringify({ action: exampleKey }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return buildOutputExamples(snippets);
}

function buildScreenReaderStrictOutputExamples(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  promptActions: readonly ResolvedPromptScreenReaderAction[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(promptActions, includeRationale);

  if (taskInput) {
    const exampleKey = `typeText.${Object.keys(taskInput)[0] ?? "<input-key>"}`;
    snippets.push(includeRationale
      ? JSON.stringify({ action: exampleKey, rationale: "..." })
      : JSON.stringify({ action: exampleKey }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return buildOutputExamples(snippets);
}

function buildScreenReaderHybridOutputExamples(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  allowedKeys: readonly AllowedKey[],
  promptActions: readonly ResolvedPromptScreenReaderAction[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(promptActions, includeRationale);
  const exampleKey = `key.${allowedKeys[0] ?? "<key>"}`;
  snippets.push(includeRationale
    ? JSON.stringify({ action: exampleKey, rationale: "..." })
    : JSON.stringify({ action: exampleKey }));

  if (taskInput) {
    const exampleKey = `typeText.${Object.keys(taskInput)[0] ?? "<input-key>"}`;
    snippets.push(includeRationale
      ? JSON.stringify({ action: exampleKey, rationale: "..." })
      : JSON.stringify({ action: exampleKey }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return buildOutputExamples(snippets);
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
  promptActions: readonly ResolvedPromptScreenReaderAction[],
  includeRationale: boolean
): string[] {
  const snippets = promptActions
    .map((action) => buildScreenReaderActionExampleSnippet(action, includeRationale));

  return dedupe(snippets);
}

function stringifyActionExample(action: string, includeRationale: boolean): string {
  return JSON.stringify(includeRationale ? { action, rationale: "..." } : { action });
}

function buildScreenReaderActionExampleSnippet(
  action: ResolvedPromptScreenReaderAction,
  includeRationale: boolean
): string {
  const label = formatResolvedPromptScreenReaderActionName(action);
  const base: Record<string, unknown> = includeRationale
    ? { action: label, rationale: "..." }
    : { action: label };

  switch (action.semantic) {
    case "press":
      return JSON.stringify({ ...base, key: "Enter" });
    case "type":
      return JSON.stringify({ ...base, text: "<text>" });
    case "click":
      return JSON.stringify({ ...base, button: "left", clickCount: 1 });
    case "catalog":
      return JSON.stringify(action.argsHint
        ? { ...base, args: buildCatalogArgsExample(action.argsHint) }
        : base);
    case "rawPerform":
      return JSON.stringify({ ...base, payload: { "<key>": "<value>" } });
    default:
      return JSON.stringify(base);
  }
}

function buildCatalogArgsExample(argsHint: string): Record<string, unknown> {
  const normalizedHint = argsHint.replace(/^args:\s*/i, "").trim();
  const numericMatch = normalizedHint.match(/"([^"]+)":\s*number/i);
  if (numericMatch?.[1]) {
    return { [numericMatch[1]]: 1 };
  }

  const stringMatch = normalizedHint.match(/"([^"]+)":\s*string/i);
  if (stringMatch?.[1]) {
    return { [stringMatch[1]]: "<value>" };
  }

  return { "<arg>": "<value>" };
}

function buildOutputExamples(snippets: readonly string[]): string {
  return snippets.join("\n");
}

function buildKeyboardActionsBlock(
  allowedKeys: readonly AllowedKey[] | undefined,
  keyboardActions: readonly ResolvedPromptKeyboardAction[] | undefined
): string {
  if (!allowedKeys || allowedKeys.length === 0) {
    return "";
  }

  const promptActions = keyboardActions ?? buildFallbackPromptKeyboardActions(allowedKeys);
  return promptActions
    .map((action) => action.hint ? `- key.${action.key}: ${action.hint}` : `- key.${action.key}`)
    .join("\n");
}

function buildScreenReaderActionsBlock(
  promptActions: readonly ResolvedPromptScreenReaderAction[] | undefined
): string {
  if (!promptActions || promptActions.length === 0) {
    return "";
  }

  return promptActions
    .map((action) => {
      const label = formatResolvedPromptScreenReaderActionName(action);
      return action.hint ? `- ${label}: ${action.hint}` : `- ${label}`;
    })
    .join("\n");
}

function buildTaskInputActionsBlock(taskInput?: TaskInput): string {
  if (!taskInput) {
    return "";
  }

  const keys = Object.keys(taskInput);
  if (keys.length === 0) {
    return "";
  }

  return keys
    .map((key) => `- typeText.${key}`)
    .join("\n");
}

function buildAvailableActionsValue(
  userModel: UserModel,
  allowedKeys: readonly AllowedKey[],
  allowedScreenReaderActions: readonly AllowedScreenReaderAction[],
  keyboardActions: readonly ResolvedPromptKeyboardAction[],
  screenReaderActions: readonly ResolvedPromptScreenReaderAction[],
  taskInput?: TaskInput
): string {
  const sections: string[] = [];

  if (userModel === "keyboard" || userModel === "screenreader-hybrid") {
    const keyboardActionsBlock = buildKeyboardActionsBlock(allowedKeys, keyboardActions);
    if (keyboardActionsBlock) {
      sections.push(keyboardActionsBlock);
    }
  }

  if (userModel === "screenreader-strict" || userModel === "screenreader-hybrid") {
    const screenReaderActionsBlock = buildScreenReaderActionsBlock(
      screenReaderActions.length > 0
        ? screenReaderActions
        : buildFallbackPromptScreenReaderActions(allowedScreenReaderActions)
    );
    if (screenReaderActionsBlock) {
      sections.push(screenReaderActionsBlock);
    }
  }

  const taskInputActionsBlock = buildTaskInputActionsBlock(taskInput);
  if (taskInputActionsBlock) {
    sections.push(taskInputActionsBlock);
  }

  return sections.join("\n\n");
}

function buildFocusHintValue(obs: Observation): string {
  if (obs.kind !== "keyboard" || !obs.focusHint) {
    return "";
  }

  return obs.focusHint;
}

function buildAnnouncementValue(obs: Observation): string {
  if (obs.kind !== "screenreader") {
    return "";
  }

  return obs.announcement;
}

function buildReadbacksValue(obs: Observation): string {
  if (obs.kind !== "screenreader" || !obs.readbacks || obs.readbacks.length === 0) {
    return "";
  }

  return obs.readbacks.map((readback) =>
    JSON.stringify(readback.status === "cleared"
      ? { method: readback.method, status: readback.status }
      : { method: readback.method, value: readback.value ?? "" })
  ).join("\n");
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

export function buildFallbackPromptScreenReaderActions(
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
      if (action.source === "catalog") {
        const builtinSemantic = getBuiltInScreenReaderSemanticByCatalogId(action.id);
        return builtinSemantic
          ? {
              semantic: builtinSemantic,
              runtimeAction: action
            }
          : {
              semantic: "catalog",
              id: action.id,
              runtimeAction: action
            };
      }

      return {
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
