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
  type PlanState,
  type ReflectionState,
  type ResolvedTask,
  type StepRecord,
  type TaskInput,
  type TaskPrompt,
  type TraceAggregate,
  type UserModel
} from "@rawstep/definition";
import { loadPromptTemplates, renderPromptTemplate } from "./prompt-loader";
import type { PromptPart } from "./shared";

type SystemPromptOptions = {
  promptDir?: string;
  taskPrompt?: TaskPrompt;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
  phase?: "browse" | "execute";
};

type UserPromptOptions = {
  promptDir?: string;
  taskPrompt?: TaskPrompt;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
  phase?: "browse" | "execute";
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
  const phase = options.phase ?? "execute";

  if (userModel === "screenreader") {
    return renderPromptTemplate(
      phase === "browse" ? templates.screenreaderBrowseSystem : templates.screenreaderSystem,
      {
      customSystemPrompt: buildCustomPromptValue(options.taskPrompt?.system),
      outputExamples: buildScreenReaderOutputExamples(
        taskInput,
        includeRationale,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      )
      }
    );
  }

  return renderPromptTemplate(phase === "browse" ? templates.keyboardBrowseSystem : templates.keyboardSystem, {
    customSystemPrompt: buildCustomPromptValue(options.taskPrompt?.system),
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
  const phase = options.phase ?? (ctx.plan ? "execute" : "browse");

  if (obs.kind === "keyboard") {
    promptParts.push({
      type: "image",
      mediaType: "image/png",
      base64: obs.screenshot.pngBase64
    });

    if (phase === "execute" && obs.diffScreenshot) {
      promptParts.push({
        type: "image",
        mediaType: "image/png",
        base64: obs.diffScreenshot.pngBase64
      });
    } else if (obs.previousScreenshot) {
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
  const phase = options.phase ?? "execute";

  const commonReplacements = {
    customUserPrompt: buildCustomPromptValue(options.taskPrompt?.user),
    goal: buildGoalValue(ctx.goal),
    agentMemory: buildAgentMemoryValue(ctx.memory),
    taskInputs: buildTaskInputsValue(taskInput),
    focusHint: buildFocusHintValue(obs),
    announcement: buildAnnouncementValue(obs),
    readbacks: buildReadbacksValue(obs),
    currentPlan: buildCurrentPlanValue(ctx.plan),
    currentFocus: buildCurrentFocusValue(ctx.currentFocus),
    strategyNote: buildStrategyNoteValue(ctx.strategyNote),
    lastReflection: buildLastReflectionValue(ctx.lastReflection),
    availableActions: buildAvailableActionsValue(
      userModel,
      resolvedPromptKeyboardActions,
      resolvedPromptScreenReaderActions,
      taskInput
    )
  };

  if (userModel === "screenreader") {
    return renderPromptTemplate(
      phase === "browse" ? templates.screenreaderBrowseUser : templates.screenreaderUser,
      {
        ...commonReplacements,
        currentObservation: buildCurrentObservationValue(obs)
      }
    );
  }

  return renderPromptTemplate(
    phase === "browse" ? templates.keyboardBrowseUser : templates.keyboardUser,
    {
      ...commonReplacements,
      currentObservation: buildCurrentObservationValue(obs)
    }
  );
}

function buildCustomPromptValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function buildPlanningSystemPrompt(
  promptDir?: string
): string {
  const templates = loadPromptTemplates({ promptDir });
  return renderPromptTemplate(templates.planningSystem, {
    outputExamples: [
      JSON.stringify({
        steps: ["Find the relevant area", "Handle required inputs or options", "Perform the key action"],
        currentFocus: "Find the relevant area",
        successSignals: ["A state change directly related to the goal is observed"]
      })
    ].join("\n")
  });
}

export function buildPlanningPromptParts(
  userModel: UserModel,
  ctx: AgentContext,
  obs: Observation,
  taskInput?: TaskInput,
  options: UserPromptOptions = {}
): PromptPart[] {
  const templates = loadPromptTemplates({ promptDir: options.promptDir });
  const resolvedPromptKeyboardActions = options.keyboardActions
    ?? ctx.keyboardActions
    ?? buildKeyboardActionPlan().descriptors;
  const resolvedPromptScreenReaderActions = options.screenReaderActions
    ?? ctx.screenReaderActions
    ?? [];

  const promptParts: PromptPart[] = [{
    type: "text",
    text: renderPromptTemplate(templates.planningUser, {
      goal: buildGoalValue(ctx.goal),
      taskInputs: buildTaskInputsValue(taskInput),
      availableActions: buildAvailableActionsValue(
        userModel,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions,
        taskInput
      ),
      currentObservation: buildCurrentObservationValue(obs)
    })
  }];

  if (obs.kind === "keyboard") {
    promptParts.push({
      type: "image",
      mediaType: "image/png",
      base64: obs.screenshot.pngBase64
    });
  }

  return promptParts;
}

export function buildReflectionSystemPrompt(promptDir?: string): string {
  const templates = loadPromptTemplates({ promptDir });
  return renderPromptTemplate(templates.reflectionSystem, {
    outputExamples: [
      JSON.stringify({
        status: "flat",
        assessment: "The recent steps do not show much contextual change.",
        strategyNote: "Consider a different exploration strategy instead of repeating the same movement.",
        updatedFocus: "Find the relevant area again"
      })
    ].join("\n")
  });
}

export function buildReflectionPromptText(
  ctx: AgentContext,
  steps: StepRecord[],
  promptDir?: string
): string {
  const templates = loadPromptTemplates({ promptDir });
  const recentMemory = steps.length > 0
    ? ctx.memory.slice(-steps.length)
    : [];

  return renderPromptTemplate(templates.reflectionUser, {
    goal: buildGoalValue(ctx.goal),
    currentPlan: buildCurrentPlanValue(ctx.plan),
    currentFocus: buildCurrentFocusValue(ctx.currentFocus),
    strategyNote: buildStrategyNoteValue(ctx.strategyNote),
    recentSteps: buildRecentStepsValue(steps),
    recentMemory: buildRecentMemoryValue(recentMemory)
  });
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
  lines.push(
    inputKeys.length === 0
      ? "- inputs status: empty"
      : "- inputs status: present",
  );

  if (inputKeys.length > 0) {
    lines.push(`- inputs: ${buildLabeledTaskInputs(task.input!).join(", ")}`);
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
    lines.push("- failure point status: present");
    lines.push(
      `- failure point value: step ${aggregate.failurePoint.stepIndex} - ${aggregate.failurePoint.reason}`
    );
  } else {
    lines.push("- failure point status: empty");
  }

  return lines.join("\n");
}

function buildExperienceSummaryStepTimelineValue(steps: StepRecord[]): string {
  if (steps.length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(steps.map((step) => buildExperienceSummaryStepValue(step)));
}

function buildExperienceSummaryStepValue(step: StepRecord): string {
  const parts = [
    `step ${step.step}`,
    `observation=${summarizeObservationForPrompt(step)}`,
    `decision=${summarizeDecisionForPrompt(step.decision)}`,
    `execution=${summarizeExecutionForPrompt(step)}`
  ];

  if (step.verification) {
    parts.push(`verification=${summarizeVerificationForPrompt(step)}`);
  }

  if (step.verdictAnalysis) {
    parts.push(`result=${summarizeResultForPrompt(step)}`);
  }

  return parts.join(" | ");
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

function buildCurrentPlanValue(plan: PlanState | undefined): string {
  if (!plan) {
    return buildEmptyListBlock();
  }

  const items = [
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    `success signals: ${plan.successSignals.join(" | ")}`
  ];

  return buildPresentListBlock(items);
}

function buildCurrentFocusValue(currentFocus: string | undefined): string {
  if (!currentFocus) {
    return buildEmptyValueBlock();
  }

  return buildPresentValueBlock(currentFocus);
}

function buildStrategyNoteValue(strategyNote: string | undefined): string {
  if (!strategyNote) {
    return buildEmptyValueBlock();
  }

  return buildPresentValueBlock(strategyNote);
}

function buildLastReflectionValue(lastReflection: ReflectionState | undefined): string {
  if (!lastReflection) {
    return buildEmptyListBlock();
  }

  const items = [
    `status=${lastReflection.status}`,
    `assessment=${JSON.stringify(lastReflection.assessment)}`,
    `strategyNote=${JSON.stringify(lastReflection.strategyNote)}`,
    ...(lastReflection.updatedFocus ? [`updatedFocus=${JSON.stringify(lastReflection.updatedFocus)}`] : [])
  ];

  return buildPresentListBlock(items);
}

function buildAgentMemoryValue(memory: AgentMemoryEntry[]): string {
  if (memory.length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(memory.map(buildMemoryEntryValue));
}

function buildRecentMemoryValue(memory: AgentMemoryEntry[]): string {
  if (memory.length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(memory.map(buildMemoryEntryValue));
}

function buildMemoryEntryValue(entry: AgentMemoryEntry): string {
  return [
    `step ${entry.step}: action=${JSON.stringify(entry.action)}`,
    `outcome=${JSON.stringify(entry.outcome)}`,
    entry.announcementExcerpt !== undefined
      ? `announcement=${JSON.stringify(entry.announcementExcerpt)}`
      : undefined,
    entry.announcementCapture
      ? `capture=${JSON.stringify(entry.announcementCapture)}`
      : undefined,
    typeof entry.announcementCount === "number"
      ? `announcementCount=${entry.announcementCount}`
      : undefined,
    entry.observeReason
      ? `observeReason=${JSON.stringify(entry.observeReason)}`
      : undefined,
    typeof entry.sameAnnouncementCount === "number"
      ? `sameAnnouncementCount=${entry.sameAnnouncementCount}`
      : undefined,
    typeof entry.sameActionCount === "number"
      ? `sameActionCount=${entry.sameActionCount}`
      : undefined,
    entry.note ? `note=${JSON.stringify(entry.note)}` : undefined
  ].filter(Boolean).join(", ");
}

function buildKeyboardOutputExamples(
  taskInput: TaskInput | undefined,
  keyboardActions: readonly KeyboardActionDescriptor[],
  includeRationale = false
): string {
  const snippets = buildKeyboardActionExampleSnippets(keyboardActions, includeRationale);

  const exampleValue = getTaskInputExampleValue(taskInput);
  if (exampleValue) {
    snippets.push(includeRationale
      ? JSON.stringify({ action: "typeText", value: exampleValue, rationale: "..." })
      : JSON.stringify({ action: "typeText", value: exampleValue }));
    snippets.push(includeRationale
      ? JSON.stringify({ action: "replaceText", value: exampleValue, rationale: "..." })
      : JSON.stringify({ action: "replaceText", value: exampleValue }));
  }

  snippets.push(...buildVerdictSnippets(includeRationale));
  return buildOutputExamples(snippets);
}

function buildScreenReaderOutputExamples(
  taskInput: TaskInput | undefined,
  includeRationale: boolean,
  _keyboardActions: readonly KeyboardActionDescriptor[],
  promptActions: readonly ScreenReaderActionDescriptor[]
): string {
  const snippets = buildScreenReaderActionExampleSnippets(promptActions, includeRationale);

  const exampleValue = getTaskInputExampleValue(taskInput);
  if (exampleValue) {
    snippets.push(includeRationale
      ? JSON.stringify({ action: "typeText", value: exampleValue, rationale: "..." })
      : JSON.stringify({ action: "typeText", value: exampleValue }));
    snippets.push(includeRationale
      ? JSON.stringify({ action: "replaceText", value: exampleValue, rationale: "..." })
      : JSON.stringify({ action: "replaceText", value: exampleValue }));
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
): string[] {
  if (!keyboardActions || keyboardActions.length === 0) {
    return [];
  }

  return keyboardActions
    .map((action) => action.hint ? `- ${action.token}: ${action.hint}` : `- ${action.token}`)
    .map((line) => line.replace(/^- /, ""));
}

function buildScreenReaderActionsBlock(
  promptActions: readonly ScreenReaderActionDescriptor[] | undefined
): string[] {
  if (!promptActions || promptActions.length === 0) {
    return [];
  }

  return promptActions
    .map((action) => {
      return action.hint ? `- ${action.token}: ${action.hint}` : `- ${action.token}`;
    })
    .map((line) => line.replace(/^- /, ""));
}

function buildTaskInputActionsBlock(taskInput?: TaskInput): string[] {
  if (!taskInput) {
    return [];
  }

  const values = dedupe(Object.values(taskInput));
  if (values.length === 0) {
    return [];
  }

  return values.flatMap((value) => [
    `typeText(${JSON.stringify(value)})`,
    `replaceText(${JSON.stringify(value)})`
  ]);
}

function buildAvailableActionsValue(
  userModel: UserModel,
  keyboardActions: readonly KeyboardActionDescriptor[],
  screenReaderActions: readonly ScreenReaderActionDescriptor[],
  taskInput?: TaskInput
): string {
  const items: string[] = [];

  if (userModel === "keyboard") {
    items.push(...buildKeyboardActionsBlock(keyboardActions));
  }

  if (userModel === "screenreader") {
    items.push(...buildScreenReaderActionsBlock(screenReaderActions));
  }

  items.push(...buildTaskInputActionsBlock(taskInput));

  return items.length === 0 ? buildEmptyListBlock() : buildPresentListBlock(items);
}

function buildFocusHintValue(obs: Observation): string {
  if (obs.kind !== "keyboard" || !obs.focusHint) {
    return buildEmptyValueBlock();
  }

  return buildPresentValueBlock(obs.focusHint);
}

function buildAnnouncementValue(obs: Observation): string {
  if (obs.kind !== "screenreader" || !obs.announcement) {
    return buildEmptyValueBlock();
  }

  return buildPresentValueBlock(obs.announcement);
}

function buildReadbacksValue(obs: Observation): string {
  if (obs.kind !== "screenreader" || !obs.readbacks || obs.readbacks.length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(obs.readbacks.map((readback) =>
    readback.kind === "note"
      ? `note(${readback.source})=${JSON.stringify(readback.value)}`
      : readback.status === "cleared"
        ? `method=${readback.method}, status=cleared`
        : `method=${readback.method}, value=${JSON.stringify(readback.value ?? "")}`
  ));
}

function buildTaskInputsValue(taskInput?: TaskInput): string {
  if (!taskInput || Object.keys(taskInput).length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(buildLabeledTaskInputs(taskInput));
}

function buildCurrentObservationValue(obs: Observation): string {
  if (obs.kind === "keyboard") {
    const parts = [
      `title=${JSON.stringify(obs.browserChrome.title)}`,
      `urlPath=${JSON.stringify(obs.browserChrome.urlPath)}`,
      obs.focusHint ? `focusHint=${JSON.stringify(obs.focusHint)}` : undefined,
      obs.scrollHint ? `scrollHint=${JSON.stringify(obs.scrollHint)}` : undefined
    ].filter(Boolean) as string[];

    return buildPresentListBlock(parts);
  }

  const parts = [
    `announcement=${JSON.stringify(obs.announcement)}`,
    `capture=${obs.announcementCapture}`,
    typeof obs.announcementCount === "number" ? `count=${obs.announcementCount}` : undefined,
    obs.observeReason ? `observeReason=${obs.observeReason}` : undefined
  ].filter(Boolean) as string[];

  return parts.length === 0 ? buildEmptyListBlock() : buildPresentListBlock(parts);
}

function buildRecentStepsValue(steps: StepRecord[]): string {
  if (steps.length === 0) {
    return buildEmptyListBlock();
  }

  return buildPresentListBlock(steps.map((step) => buildExperienceSummaryStepValue(step)));
}

function buildLabeledTaskInputs(taskInput: TaskInput): string[] {
  return Object.entries(taskInput).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
}

function getTaskInputExampleValue(taskInput?: TaskInput): string | undefined {
  if (!taskInput) {
    return undefined;
  }

  return dedupe(Object.values(taskInput))[0];
}

function buildEmptyValueBlock(): string {
  return "- status: empty";
}

function buildPresentValueBlock(value: string): string {
  return [
    "- status: present",
    `- value: ${JSON.stringify(value)}`
  ].join("\n");
}

function buildEmptyListBlock(): string {
  return [
    "- status: empty",
    "- items: []"
  ].join("\n");
}

function buildPresentListBlock(items: readonly string[]): string {
  return [
    "- status: present",
    "- items:",
    ...items.map((item) => `  - ${item}`)
  ].join("\n");
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
