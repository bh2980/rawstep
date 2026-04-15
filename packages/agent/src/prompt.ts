import {
  buildKeyboardActionPlan,
  buildKeyboardDescriptorExampleSnippet,
  buildScreenReaderDescriptorExampleSnippet,
  formatDecisionAction,
  type KeyboardActionDescriptor,
  type ScreenReaderActionDescriptor
} from "@rawstep/action-catalog";
import {
  type Action,
  type AgentContext,
  type AgentMemoryEntry,
  type Decision,
  type Observation,
  type ResolvedTask,
  type StepRecord,
  type TaskInput,
  type TraceAggregate,
  type UserModel
} from "@rawstep/definition";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

type SystemPromptOptions = {
  promptDir?: string;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
};

type UserPromptOptions = {
  promptDir?: string;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
};

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  keyboardActions: readonly KeyboardActionDescriptor[] = buildKeyboardActionPlan().descriptors,
  screenReaderActions: readonly ScreenReaderActionDescriptor[] = [],
  includeRationale = false,
  options: SystemPromptOptions = {}
): string {
  const templates = loadPromptTemplates({ promptDir: options.promptDir });
  const resolvedPromptKeyboardActions = options.keyboardActions ?? keyboardActions;
  const resolvedPromptScreenReaderActions = options.screenReaderActions ?? screenReaderActions;

  if (userModel === "screenreader") {
    return renderPromptTemplate(templates.screenreaderSystem, {
      outputExamples: buildScreenReaderOutputExamples(
        taskInput,
        includeRationale,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      )
    });
  }

  return renderPromptTemplate(templates.keyboardSystem, {
    outputExamples: buildKeyboardOutputExamples(taskInput, resolvedPromptKeyboardActions, includeRationale)
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
    ?? ctx.keyboardActions
    ?? buildKeyboardActionPlan().descriptors;
  const resolvedPromptScreenReaderActions = options.screenReaderActions
    ?? ctx.screenReaderActions
    ?? [];

  const commonReplacements = {
    goal: buildGoalValue(ctx.goal),
    agentMemory: buildAgentMemoryValue(ctx.memory),
    focusHint: buildFocusHintValue(obs),
    announcement: buildAnnouncementValue(obs),
    readbacks: buildReadbacksValue(obs),
    availableActions: buildAvailableActionsValue(
      userModel,
      resolvedPromptKeyboardActions,
      resolvedPromptScreenReaderActions,
      taskInput
    )
  };

  if (userModel === "screenreader") {
    return renderPromptTemplate(templates.screenreaderUser, commonReplacements);
  }

  return renderPromptTemplate(templates.keyboardUser, commonReplacements);
}

export function buildExperienceSummarySystemPrompt(promptDir?: string): string {
  return loadPromptTemplates({ promptDir }).experienceSummarySystem;
}

export function buildExperienceSummaryPromptText(
  task: ResolvedTask,
  aggregate: TraceAggregate,
  steps: StepRecord[],
  promptDir?: string
): string {
  const templates = loadPromptTemplates({ promptDir });

  return renderPromptTemplate(templates.experienceSummaryUser, {
    taskSummary: buildExperienceSummaryTaskValue(task),
    aggregateSummary: buildExperienceSummaryAggregateValue(aggregate),
    stepTimeline: buildExperienceSummaryStepTimelineValue(steps)
  });
}

function buildExperienceSummaryTaskValue(task: ResolvedTask): string {
  const lines = [
    `- id: ${task.id}`,
    `- mode: ${task.mode}`,
    `- goal: ${task.goal}`
  ];

  const inputKeys = task.input ? Object.keys(task.input) : [];
  if (inputKeys.length > 0) {
    lines.push(`- input keys: ${inputKeys.join(", ")}`);
  }

  return lines.join("\n");
}

function buildExperienceSummaryAggregateValue(aggregate: TraceAggregate): string {
  const lines = [
    `- result: ${aggregate.result}`,
    `- ended by: ${aggregate.endedBy}`,
    `- total steps: ${aggregate.totalSteps}`,
    `- duration: ${aggregate.durationMs} ms`,
    `- action counts: rawKey=${aggregate.actionCounts.rawKeyCount}, typeText=${aggregate.actionCounts.typeTextCount}, srInvoke=${aggregate.actionCounts.srInvokeCount}, srRead=${aggregate.actionCounts.srReadCount}, srMaintenance=${aggregate.actionCounts.srMaintenanceCount}`
  ];

  if (aggregate.failurePoint) {
    lines.push(
      `- failure point: step ${aggregate.failurePoint.stepIndex} - ${aggregate.failurePoint.reason}`
    );
  }

  return lines.join("\n");
}

function buildExperienceSummaryStepTimelineValue(steps: StepRecord[]): string {
  if (steps.length === 0) {
    return "- No steps recorded.";
  }

  return steps.map((step) => buildExperienceSummaryStepValue(step)).join("\n\n");
}

function buildExperienceSummaryStepValue(step: StepRecord): string {
  const lines = [
    `${step.step}. ${summarizeObservationForPrompt(step)}`,
    `Decision: ${summarizeDecisionForPrompt(step.decision)}`,
    `Execution: ${summarizeExecutionForPrompt(step)}`
  ];

  if (step.verification) {
    lines.push(`Verification: ${summarizeVerificationForPrompt(step)}`);
  }

  if (step.verdictAnalysis) {
    lines.push(`Result: ${summarizeResultForPrompt(step)}`);
  }

  return lines.join("\n");
}

function summarizeObservationForPrompt(step: StepRecord): string {
  if (step.observation.kind === "keyboard") {
    const parts = [
      `Keyboard observation on "${step.observation.browserChrome.title}" at ${step.observation.browserChrome.urlPath}.`
    ];

    if (step.observation.focusHint) {
      parts.push(`Focus hint: ${step.observation.focusHint}.`);
    }

    if (step.observation.scrollHint) {
      parts.push(`Scroll hint: ${step.observation.scrollHint}.`);
    }

    return parts.join(" ");
  }

  const parts = [
    `Screen reader observation announced ${step.observation.announcement ? `"${step.observation.announcement}".` : "no captured announcement."}`,
    `Capture: ${step.observation.announcementCapture}.`
  ];

  if (typeof step.observation.announcementCount === "number") {
    parts.push(`Count: ${step.observation.announcementCount}.`);
  }

  if (step.observation.observeReason) {
    parts.push(`Observe reason: ${step.observation.observeReason}.`);
  }

  return parts.join(" ");
}

function summarizeDecisionForPrompt(decision: Decision): string {
  return "action" in decision
    ? formatDecisionAction(decision.action)
    : `verdict(${decision.verdict})`;
}

function summarizeExecutionForPrompt(step: StepRecord): string {
  if (!step.execution.ok) {
    return `failed with ${step.execution.error ?? "unknown error"}.`;
  }

  return `ok with cost delta ${step.execution.costDelta}.`;
}

function summarizeVerificationForPrompt(step: StepRecord): string {
  if (!step.verification) {
    return "none.";
  }

  if (step.verification.passed) {
    return "passed.";
  }

  if (step.verification.failures.length === 0) {
    return "failed.";
  }

  return `failed with: ${step.verification.failures.join(" | ")}.`;
}

function summarizeResultForPrompt(step: StepRecord): string {
  if (!step.verdictAnalysis) {
    return "continued.";
  }

  return `${step.verdictAnalysis.finalResult} via ${step.verdictAnalysis.completionSource}.`;
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
  keyboardActions: readonly KeyboardActionDescriptor[],
  includeRationale = false
): string {
  const snippets = buildKeyboardActionExampleSnippets(keyboardActions, includeRationale);

  if (taskInput) {
    const exampleKey = `typeText.${Object.keys(taskInput)[0] ?? "<input-key>"}`;
    snippets.push(includeRationale
      ? JSON.stringify({ action: exampleKey, rationale: "..." })
      : JSON.stringify({ action: exampleKey }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return buildOutputExamples(snippets);
}

function buildScreenReaderOutputExamples(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  keyboardActions: readonly KeyboardActionDescriptor[],
  promptActions: readonly ScreenReaderActionDescriptor[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(promptActions, includeRationale);
  snippets.push(...buildKeyboardActionExampleSnippets(keyboardActions, includeRationale));

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
  promptActions: readonly ScreenReaderActionDescriptor[],
  includeRationale: boolean
): string[] {
  const snippets = promptActions
    .map((action) => buildScreenReaderActionExampleSnippet(action, includeRationale));

  return dedupe(snippets);
}

function buildScreenReaderActionExampleSnippet(
  action: ScreenReaderActionDescriptor,
  includeRationale: boolean
): string {
  return buildScreenReaderDescriptorExampleSnippet(action, includeRationale);
}

function buildKeyboardActionExampleSnippets(
  keyboardActions: readonly KeyboardActionDescriptor[],
  includeRationale: boolean
): string[] {
  const snippets = keyboardActions
    .map((action) => buildKeyboardDescriptorExampleSnippet(action, includeRationale));

  return dedupe(snippets);
}

function buildOutputExamples(snippets: readonly string[]): string {
  return snippets.join("\n");
}

function buildKeyboardActionsBlock(
  keyboardActions: readonly KeyboardActionDescriptor[] | undefined
): string {
  if (!keyboardActions || keyboardActions.length === 0) {
    return "";
  }

  return keyboardActions
    .map((action) => action.hint ? `- ${action.token}: ${action.hint}` : `- ${action.token}`)
    .join("\n");
}

function buildScreenReaderActionsBlock(
  promptActions: readonly ScreenReaderActionDescriptor[] | undefined
): string {
  if (!promptActions || promptActions.length === 0) {
    return "";
  }

  return promptActions
    .map((action) => {
      return action.hint ? `- ${action.token}: ${action.hint}` : `- ${action.token}`;
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
  keyboardActions: readonly KeyboardActionDescriptor[],
  screenReaderActions: readonly ScreenReaderActionDescriptor[],
  taskInput?: TaskInput
): string {
  const sections: string[] = [];

  if (userModel === "keyboard" || keyboardActions.length > 0) {
    const keyboardActionsBlock = buildKeyboardActionsBlock(keyboardActions);
    if (keyboardActionsBlock) {
      sections.push(keyboardActionsBlock);
    }
  }

  if (userModel === "screenreader") {
    const screenReaderActionsBlock = buildScreenReaderActionsBlock(screenReaderActions);
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
function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
