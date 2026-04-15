import {
  buildKeyboardActionPlan,
  buildKeyboardDescriptorExampleSnippet,
  buildScreenReaderDescriptorExampleSnippet,
  formatDecisionAction,
  formatScreenReaderIntent,
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
  steps: StepRecord[]
): string {
  return [
    `task: ${JSON.stringify({ id: task.id, goal: task.goal, mode: task.mode })}`,
    `aggregate: ${JSON.stringify(aggregate)}`,
    `steps: ${JSON.stringify(buildSummaryStepsForPrompt(steps))}`,
    "Summarize the run in terms of experience only.",
    "overall: what I tried and how the run progressed end-to-end in first person.",
    "blockers: an array of moments where progress stalled or repeated. Use [] when none.",
    "surprise: one moment that felt notably different from expectation. Use null when none.",
    "oneLineFeel: a single-sentence description of the overall feel of the run.",
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
