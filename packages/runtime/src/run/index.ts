import {
  buildKeyboardActionPlan,
  buildScreenReaderActionPlan,
  type KeyboardActionPlan,
  type ScreenReaderActionPlan
} from "@rawstep/action-catalog";
import { Actuator, NotAllowedActionError } from "../actuator";
import {
  closeBrowserSession,
  createBrowserSession,
  settlePage,
  type BrowserSession,
  type CreateBrowserSessionOptions
} from "../browser";
import {
  allowsRawKeyActions,
  type AgentContext,
  type Decision,
  type ExecutionRecord,
  type AgentMemoryEntry,
  type Agent,
  type Action,
  type EndedBy,
  isScreenReaderMode,
  type Observation,
  type PlanningConfig,
  type PlanState,
  type ReflectionState,
  type ResolvedTask,
  type ScreenReaderBackendId,
  type ScreenReaderObserveConfig,
  type ScreenReaderReadback,
  type ScreenshotPolicy,
  type TraceSession,
  type UserModel,
  type VoiceOverConfig,
  type ResolvedNavigationPolicy,
} from "@rawstep/definition";
import {
  createScreenReaderRuntime,
  isHighConfidenceBrowserUi,
  resolveScreenReaderBrowserHeadless,
  resolveScreenReaderCapabilities,
  ScreenReaderInitializationError,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeFactory
} from "../observe/screenreader";
import { TraceRecorder } from "../trace";
import type { ScreenReaderTraceArtifacts } from "../trace/artifacts";
import {
  createAgentMemoryEntry,
  createObserver,
  captureScreenReaderDomFocus,
  createVerdictAnalysis,
  getErrorMessage,
  resolveAgentContextMemory,
  resolveVerificationOutcome,
  type ResolvedVerificationOutcome,
  type RunnerObserver
} from "./helpers";
import {
  captureDeveloperScreenshot,
  shouldCaptureDeveloperScreenshot
} from "./screenshots";
import {
  formatVerificationFeedback,
  MAX_VERIFICATION_RETRIES,
  verifyTask,
  type VerificationContext
} from "../verify";

export type RunTaskOptions = {
  outDir: string;
  screenshotPolicy?: ScreenshotPolicy;
  navigation?: ResolvedNavigationPolicy;
  verifierAutoComplete?: boolean;
  maxVerificationRetries?: number;
  planning?: PlanningConfig;
  headless?: boolean;
  keyboardActionPlan?: KeyboardActionPlan;
  screenReaderActionPlan?: ScreenReaderActionPlan;
  screenReaderBackendId?: ScreenReaderBackendId;
  screenReaderObserve?: ScreenReaderObserveConfig;
  voiceOver?: VoiceOverConfig;
  agent: Agent;
  browserSessionFactory?: (
    url: string,
    options?: CreateBrowserSessionOptions
  ) => Promise<BrowserSession>;
  screenReaderRuntimeFactory?: ScreenReaderRuntimeFactory;
};

type RunCleanupHandles = {
  browser?: BrowserSession;
  screenReaderRuntime?: ScreenReaderRuntime;
};

type RunResources = {
  task: ResolvedTask;
  trace: TraceRecorder;
  deadline: number;
  screenshotPolicy: ScreenshotPolicy;
  maxVerificationRetries: number;
  verifierAutoComplete: boolean;
  planning: Required<PlanningConfig>;
  browser: BrowserSession;
  screenReaderRuntime?: ScreenReaderRuntime;
  observer: RunnerObserver;
  actuator: Actuator;
  agent: Agent;
  keyboardActionPlan: KeyboardActionPlan;
  screenReaderActionPlan?: ScreenReaderActionPlan;
};

type RunState = {
  verificationFailures: number;
  successfulActionCount: number;
  agentMemory: AgentMemoryEntry[];
  latestActivation?: VerificationContext["latestActivation"];
  pendingScreenReaderReadbacks: ScreenReaderReadback[];
  pendingSyntheticAnnouncement?: string;
  pendingObservationOptions?: Parameters<RunnerObserver["observe"]>[0];
  pendingBuiltAgentStepContext?: BuiltAgentStepContext;
  planningAttempted: boolean;
  planningStartedAtStep?: number;
  nextReflectionStep?: number;
  lastReflectionStep?: number;
  plan?: PlanState;
  currentFocus?: string;
  strategyNote?: string;
  lastReflection?: ReflectionState;
  endedBy?: EndedBy;
  failureReasonOverride?: string;
};

type BuiltAgentStepContext = {
  observation: Observation;
  context: {
    goal: string;
    keyboardActions?: KeyboardActionPlan["descriptors"];
    screenReaderActions?: ScreenReaderActionPlan["descriptors"];
    memory: AgentMemoryEntry[];
    plan?: PlanState;
    currentFocus?: string;
    strategyNote?: string;
    lastReflection?: ReflectionState;
  };
  observeMs: number;
  screenReaderArtifacts?: ScreenReaderTraceArtifacts;
};

type StepDecisionContext = Omit<BuiltAgentStepContext, "context"> & {
  step: number;
  decision: Decision;
  decideMs: number;
};

type StepResult = {
  continueLoop: boolean;
  settleAfterStep: boolean;
};

export class RunTaskFailedError extends Error {
  constructor(
    message: string,
    readonly session: TraceSession
  ) {
    super(message);
    this.name = "RunTaskFailedError";
  }
}

export async function runTask(task: ResolvedTask, options: RunTaskOptions): Promise<TraceSession> {
  const trace = new TraceRecorder(task, options.outDir);
  await trace.initialize();
  const setupStartedAt = Date.now();
  const deadline = Date.now() + task.timeoutMs;
  const cleanup: RunCleanupHandles = {};
  const state: RunState = {
    verificationFailures: 0,
    successfulActionCount: 0,
    agentMemory: [],
    pendingScreenReaderReadbacks: [],
    planningAttempted: false
  };
  let resources: RunResources | undefined;
  let unexpectedError: unknown;
  try {
    resources = await initializeRunResources(task, options, trace, setupStartedAt, deadline, cleanup);

    for (let step = 0; step < task.maxSteps; step += 1) {
      if (Date.now() >= resources.deadline) {
        state.endedBy = "timeout";
        break;
      }

      await maybeStartPlanning(step, resources, state);
      const stepResult = await executeStep(step, resources, state);
      if (!stepResult.continueLoop) {
        break;
      }
      await runReflectionIfNeeded(step, resources, state);

      if (stepResult.settleAfterStep) {
        await settlePage(resources.browser.page);
      }
    }

    if (!state.endedBy) {
      state.endedBy = "maxSteps";
    }
  } catch (error) {
    unexpectedError = error;
    state.endedBy = state.endedBy ?? "error";
    state.failureReasonOverride = getErrorMessage(error);
  }

  const session = await finalizeRun(task, trace, resources, cleanup, state);

  if (unexpectedError) {
    throw new RunTaskFailedError(getErrorMessage(unexpectedError), session);
  }

  return session;
}

async function initializeRunResources(
  task: ResolvedTask,
  options: RunTaskOptions,
  trace: TraceRecorder,
  setupStartedAt: number,
  deadline: number,
  cleanup: RunCleanupHandles
): Promise<RunResources> {
  const browserFactory = options.browserSessionFactory ?? createBrowserSession;
  cleanup.browser = await browserFactory(task.url, {
    headless: resolveScreenReaderBrowserHeadless(task.mode, options.headless, options.screenReaderBackendId),
    navigation: options.navigation,
    verify: task.verify
  });
  await flushNavigationGuardWarnings(trace, cleanup.browser, -1);
  if (!isScreenReaderMode(task.mode)) {
    await cleanup.browser.page.bringToFront();
  }

  cleanup.screenReaderRuntime = isScreenReaderMode(task.mode)
    ? await createConfiguredScreenReaderRuntime(options, trace, setupStartedAt, cleanup.browser)
    : undefined;

  const keyboardActionPlan = resolveKeyboardActionPlan(task.mode, options.keyboardActionPlan);
  const observer = createObserver(task.mode, cleanup.browser, cleanup.screenReaderRuntime);
  const actuator = new Actuator(cleanup.browser.page, {
    screenReaderController: cleanup.screenReaderRuntime?.controller,
    useScreenReaderTextEntry: isScreenReaderMode(task.mode),
    screenReaderBackendId: options.screenReaderBackendId,
    allowedKeys: keyboardActionPlan.allowedKeys
  });
  const screenReaderCapabilities = isScreenReaderMode(task.mode)
    ? resolveScreenReaderCapabilities({
      runtime: cleanup.screenReaderRuntime,
      actionPlan: options.screenReaderActionPlan,
      backendId: options.screenReaderBackendId
    })
    : undefined;
  const agent = options.agent;

  trace.setSetupTimings({
    setupMs: Date.now() - setupStartedAt,
    browserLaunchMs: cleanup.browser.setupTimings?.browserLaunchMs ?? 0,
    pageLoadMs: cleanup.browser.setupTimings?.pageLoadMs ?? 0,
    screenReaderInitMs: cleanup.screenReaderRuntime?.setupTimings.screenReaderInitMs ?? 0,
    firstAnnouncementWaitMs: cleanup.screenReaderRuntime?.setupTimings.firstAnnouncementWaitMs ?? 0
  });

  return {
    task,
    trace,
    deadline,
    screenshotPolicy: options.screenshotPolicy ?? "all",
    maxVerificationRetries: options.maxVerificationRetries ?? MAX_VERIFICATION_RETRIES,
    verifierAutoComplete: Boolean(options.verifierAutoComplete),
    planning: resolveRuntimePlanningConfig(task.mode, options.planning),
    browser: cleanup.browser,
    screenReaderRuntime: cleanup.screenReaderRuntime,
    observer,
    actuator,
    agent,
    keyboardActionPlan,
    screenReaderActionPlan: isScreenReaderMode(task.mode)
      ? options.screenReaderActionPlan ?? (
        options.screenReaderBackendId && screenReaderCapabilities
          ? buildScreenReaderActionPlan(
            undefined,
            options.screenReaderBackendId,
            screenReaderCapabilities
          )
          : undefined
      )
      : undefined
  };
}

async function createConfiguredScreenReaderRuntime(
  options: RunTaskOptions,
  trace: TraceRecorder,
  setupStartedAt: number,
  browser: BrowserSession
): Promise<ScreenReaderRuntime> {
  try {
    return await (options.screenReaderRuntimeFactory
      ?? ((page) => createScreenReaderRuntime(page, {
        backendId: options.screenReaderBackendId,
        actionPlan: options.screenReaderActionPlan,
        observe: options.screenReaderObserve,
        voiceOver: options.voiceOver
      })))(browser.page);
  } catch (error) {
    if (error instanceof ScreenReaderInitializationError) {
      trace.setSetupTimings({
        setupMs: Date.now() - setupStartedAt,
        browserLaunchMs: browser.setupTimings?.browserLaunchMs ?? 0,
        pageLoadMs: browser.setupTimings?.pageLoadMs ?? 0,
        screenReaderInitMs: error.setupTimings.screenReaderInitMs,
        firstAnnouncementWaitMs: error.setupTimings.firstAnnouncementWaitMs
      });
      for (const diagnostic of error.diagnostics) {
        await trace.appendDiagnostic(-1, diagnostic);
      }

      const reason = `Screen reader initialization failed: ${error.message}`;
      throw new ScreenReaderInitializationError(reason, error.diagnostics, error.setupTimings);
    }

    throw error;
  }
}

async function executeStep(
  step: number,
  resources: RunResources,
  state: RunState
): Promise<StepResult> {
  const builtContext = state.pendingBuiltAgentStepContext
    ?? await buildAgentStepContext(resources, state);
  state.pendingBuiltAgentStepContext = undefined;
  const decideStartedAt = Date.now();
  const decision = await resources.agent.decide(builtContext.context, builtContext.observation);
  const decideMs = Date.now() - decideStartedAt;
  const stepContext: StepDecisionContext = {
    step,
    observation: builtContext.observation,
    observeMs: builtContext.observeMs,
    screenReaderArtifacts: builtContext.screenReaderArtifacts,
    decision,
    decideMs
  };

  if ("verdict" in decision) {
    return handleVerdictDecision(
      {
        ...stepContext,
        decision
      },
      resources,
      state
    );
  }

  return handleActionDecision(
    {
      ...stepContext,
      decision
    },
    resources,
    state
  );
}

async function buildAgentStepContext(
  resources: RunResources,
  state: RunState
): Promise<BuiltAgentStepContext> {
  const observeStartedAt = Date.now();
  const observationOptions = state.pendingObservationOptions;
  state.pendingObservationOptions = undefined;
  let baseObservation = await resources.observer.observe(observationOptions);

  if (
    baseObservation.kind === "screenreader"
    && resources.screenReaderRuntime
    && isHighConfidenceBrowserUi(baseObservation.announcement)
  ) {
    const domFocus = await captureScreenReaderDomFocus(resources.browser.page);
    const recovery = await resources.screenReaderRuntime.recoverFromUnexpectedBrowserUi({
      observation: baseObservation,
      ...(domFocus.status === "captured" ? { domFocus: domFocus.snapshot } : {})
    });
    const recoveryStep = resources.trace.getSteps().length;
    for (const diagnostic of recovery.diagnostics) {
      await resources.trace.appendDiagnostic(recoveryStep, diagnostic);
    }
    if (recovery.feedbackNote) {
      baseObservation = {
        ...recovery.observation,
        readbacks: [
          ...(recovery.observation.readbacks ?? []),
          createRuntimeRecoveryReadback(recovery.feedbackNote)
        ]
      };
    } else {
      baseObservation = recovery.observation;
    }
  }

  const agentObservation = applyPendingSyntheticAnnouncement(
    applyPendingScreenReaderReadbacks(
      baseObservation,
      state.pendingScreenReaderReadbacks
    ),
    state.pendingSyntheticAnnouncement
  );
  if (agentObservation.kind === "screenreader" && state.pendingSyntheticAnnouncement) {
    state.pendingSyntheticAnnouncement = undefined;
  }
  if (agentObservation.kind === "screenreader" && state.pendingScreenReaderReadbacks.length > 0) {
    state.pendingScreenReaderReadbacks = [];
  }

  const screenReaderArtifacts = agentObservation.kind === "screenreader"
    ? {
        domFocus: await captureScreenReaderDomFocus(resources.browser.page),
        cursorScreenshot: await resources.screenReaderRuntime?.captureCursorScreenshot()
      }
    : undefined;

  return {
    observation: agentObservation,
    observeMs: Date.now() - observeStartedAt,
    screenReaderArtifacts,
    context: buildAgentContext(resources, state)
  };
}

function buildAgentContext(
  resources: RunResources,
  state: RunState
): BuiltAgentStepContext["context"] {
  return {
    goal: resources.task.goal,
    keyboardActions: resources.keyboardActionPlan.descriptors,
    screenReaderActions: resources.screenReaderActionPlan?.descriptors,
    memory: resolveAgentContextMemory(resources.agent, state.agentMemory),
    plan: state.plan,
    currentFocus: state.currentFocus,
    strategyNote: state.strategyNote,
    lastReflection: state.lastReflection
  };
}

function resolveRuntimePlanningDefaults(
  mode: UserModel
): Required<PlanningConfig> {
  if (mode === "screenreader") {
    return {
      enabled: true,
      reflectionCadence: 10,
      initialDelaySteps: 3,
      firstReflectionDelaySteps: 3
    };
  }

  return {
    enabled: true,
    reflectionCadence: 10,
    initialDelaySteps: 0,
    firstReflectionDelaySteps: 10
  };
}

function resolveRuntimePlanningConfig(
  mode: UserModel,
  planning: PlanningConfig | undefined
): Required<PlanningConfig> {
  const defaults = resolveRuntimePlanningDefaults(mode);

  return {
    enabled: planning?.enabled ?? defaults.enabled,
    reflectionCadence: planning?.reflectionCadence ?? defaults.reflectionCadence,
    initialDelaySteps: planning?.initialDelaySteps ?? defaults.initialDelaySteps,
    firstReflectionDelaySteps: planning?.firstReflectionDelaySteps ?? defaults.firstReflectionDelaySteps
  };
}

async function maybeStartPlanning(
  step: number,
  resources: RunResources,
  state: RunState
): Promise<void> {
  if (
    !resources.planning.enabled
    || !resources.agent.planTask
    || state.planningAttempted
    || step < resources.planning.initialDelaySteps
  ) {
    return;
  }

  state.planningAttempted = true;
  const initialStepContext = await buildAgentStepContext(resources, state);

  try {
    const plan = await resources.agent.planTask(
      initialStepContext.context,
      initialStepContext.observation
    );
    state.plan = plan;
    state.currentFocus = plan.currentFocus;
    state.planningStartedAtStep = step;
    state.nextReflectionStep = resolveInitialReflectionStep(
      step,
      resources.planning.firstReflectionDelaySteps
    );
    resources.trace.setPlan(plan);
  } catch (error) {
    const message = getErrorMessage(error);
    resources.trace.setPlanningError(message);
  }

  state.pendingBuiltAgentStepContext = {
    ...initialStepContext,
    context: buildAgentContext(resources, state)
  };
}

function resolveInitialReflectionStep(
  planningStartedAtStep: number,
  firstReflectionDelaySteps: number
): number {
  return planningStartedAtStep + Math.max(firstReflectionDelaySteps - 1, 0);
}

async function runReflectionIfNeeded(
  step: number,
  resources: RunResources,
  state: RunState
): Promise<void> {
  if (
    !resources.planning.enabled
    || !resources.agent.reflectProgress
    || !state.plan
  ) {
    return;
  }

  const reflectionTrigger = resolveReflectionTrigger(step, state);
  if (!reflectionTrigger) {
    return;
  }

  const recentSteps = resources.trace.getSteps().slice(-resources.planning.reflectionCadence);
  if (recentSteps.length === 0) {
    return;
  }

  try {
    const reflection = await resources.agent.reflectProgress({
      ctx: buildAgentContext(resources, state) as AgentContext,
      steps: recentSteps
    });
    state.lastReflection = reflection;
    state.lastReflectionStep = step;
    state.strategyNote = reflection.strategyNote;
    state.currentFocus = reflection.updatedFocus ?? state.currentFocus;
    if (reflectionTrigger === "cadence") {
      state.nextReflectionStep = step + resources.planning.reflectionCadence;
    }
    resources.trace.appendReflection(step, reflection);
  } catch {
    return;
  }
}

function resolveReflectionTrigger(
  step: number,
  state: Pick<RunState, "agentMemory" | "nextReflectionStep" | "lastReflectionStep">
): "cadence" | "event" | undefined {
  const cadenceDue = state.nextReflectionStep !== undefined && step >= state.nextReflectionStep;
  if (cadenceDue) {
    return "cadence";
  }

  const latestEntry = state.agentMemory.at(-1);
  if (!latestEntry) {
    return undefined;
  }

  if (
    state.lastReflectionStep !== undefined
    && step - state.lastReflectionStep < 3
  ) {
    return undefined;
  }

  if ((latestEntry.sameAnnouncementCount ?? 0) >= 3) {
    return "event";
  }

  if ((latestEntry.sameActionCount ?? 0) >= 4) {
    return "event";
  }

  const previousEntry = state.agentMemory.at(-2);
  if (
    latestEntry.announcementCapture === "none"
    && latestEntry.observeReason === "timeout"
    && previousEntry?.announcementCapture === "none"
    && previousEntry.observeReason === "timeout"
  ) {
    return "event";
  }

  return undefined;
}

function resolveKeyboardActionPlan(
  mode: UserModel,
  configuredPlan?: KeyboardActionPlan
): KeyboardActionPlan {
  if (!allowsRawKeyActions(mode)) {
    return buildKeyboardActionPlan([]);
  }

  return configuredPlan ?? buildKeyboardActionPlan();
}

async function handleVerdictDecision(
  stepContext: StepDecisionContext & { decision: Extract<Decision, { verdict: unknown }> },
  resources: RunResources,
  state: RunState
): Promise<StepResult> {
  const { step, observation, decision, observeMs, decideMs } = stepContext;

  if (decision.verdict === "success") {
    const verifyStartedAt = Date.now();
    const verification = await verifyTask(resources.task, resources.browser, {
      latestActivation: state.latestActivation
    });
    const verifyMs = Date.now() - verifyStartedAt;
    const verificationFeedback = verification.passed
      ? undefined
      : formatVerificationFeedback(verification);
    const verificationOutcome = resolveVerificationOutcome({
      kind: "verified-success",
      passed: verification.passed,
      verificationFailures: state.verificationFailures,
      maxVerificationRetries: resources.maxVerificationRetries,
      failureMessage: verificationFeedback
    });
    const developerScreenshot = shouldCaptureDeveloperScreenshot(
      resources.screenshotPolicy,
      observation,
      decision,
      undefined,
      verification
    )
      ? await captureDeveloperScreenshot(resources.browser.page)
      : undefined;

    await resources.trace.append(
      step,
      observation,
      decision,
      { ok: true, costDelta: 0 },
      {
        observeMs,
        decideMs,
        executeMs: 0,
        verifyMs
      },
      verification,
      createVerdictAnalysis(
        decision.verdict,
        verification,
        verificationOutcome.finalResult,
        verificationOutcome.completionSource
      ),
      developerScreenshot,
      stepContext.screenReaderArtifacts
    );
    recordAgentMemoryEntry(
      resources,
      state,
      step,
      decision,
      verificationOutcome.finalResult,
      observation,
      verificationFeedback
    );
    applyVerificationOutcome(state, verificationOutcome);

    return {
      continueLoop: !verificationOutcome.endedBy,
      settleAfterStep: false
    };
  }

  await resources.trace.append(
    step,
    observation,
    decision,
    { ok: true, costDelta: 0 },
    {
      observeMs,
      decideMs,
      executeMs: 0,
      verifyMs: 0
    },
    undefined,
    createVerdictAnalysis(
      decision.verdict,
      undefined,
      "failure",
      "agent"
    ),
    shouldCaptureDeveloperScreenshot(resources.screenshotPolicy, observation, decision)
      ? await captureDeveloperScreenshot(resources.browser.page)
      : undefined,
    stepContext.screenReaderArtifacts
  );
  recordAgentMemoryEntry(resources, state, step, decision, "failure", observation);
  state.endedBy = decision.verdict;

  return {
    continueLoop: false,
    settleAfterStep: false
  };
}

async function handleActionDecision(
  stepContext: StepDecisionContext & { decision: Extract<Decision, { action: unknown }> },
  resources: RunResources,
  state: RunState
): Promise<StepResult> {
  const { step, observation, decision, observeMs, decideMs } = stepContext;
  const executeStartedAt = Date.now();

  try {
    if ("key" in decision.action && !allowsRawKeyActions(resources.task.mode)) {
      throw new NotAllowedActionError("Raw key actions are not allowed in the current mode.");
    }

    const execution = await resources.actuator.execute(decision.action, resources.task.input);
    const executeMs = Date.now() - executeStartedAt;
    await waitForNavigationGuardSignal();
    await flushNavigationGuardWarnings(resources.trace, resources.browser, step);
    const blockedNavigations = resources.browser.takeBlockedNavigations();
    if (blockedNavigations.length > 0) {
      return handleBlockedNavigationAttempt(
        {
          step,
          observation,
          decision,
          observeMs,
          decideMs,
          executeMs,
          screenReaderArtifacts: stepContext.screenReaderArtifacts
        },
        resources,
        state,
        execution,
        blockedNavigations
      );
    }

    if (execution.ok && execution.costDelta > 0 && actionCanChangeTaskState(decision.action)) {
      state.successfulActionCount += 1;
    }
    if (execution.ok && isActivationAction(decision.action)) {
      state.latestActivation = {
        step,
        action: decision.action,
        observation
      };
    }
    if (execution.ok) {
      state.pendingScreenReaderReadbacks = [
        ...state.pendingScreenReaderReadbacks,
        ...createScreenReaderReadbacks(execution)
      ];
      if (execution.textEntryResult?.syntheticAnnouncement) {
        state.pendingSyntheticAnnouncement = execution.textEntryResult.syntheticAnnouncement;
      }
      if (shouldCaptureAlertFollowUp(decision.action)) {
        state.pendingObservationOptions = { followUpAfterAlert: true };
      }
    }

    const shouldCheckVerifierAutoComplete = Boolean(
      resources.verifierAutoComplete
      && execution.ok
      && execution.costDelta > 0
      && actionCanChangeTaskState(decision.action)
      && state.successfulActionCount > 0
    );
    const verifyStartedAt = shouldCheckVerifierAutoComplete ? Date.now() : 0;
    const verification = shouldCheckVerifierAutoComplete
      ? await verifyTask(resources.task, resources.browser, {
        latestActivation: state.latestActivation
      })
      : undefined;
    const verifyMs = shouldCheckVerifierAutoComplete
      ? Date.now() - verifyStartedAt
      : 0;
    const verificationOutcome = verification
      ? resolveVerificationOutcome({
        kind: "verifier-auto-complete",
        passed: verification.passed,
        verificationFailures: state.verificationFailures,
        maxVerificationRetries: resources.maxVerificationRetries,
        failureMessage: verification.passed ? undefined : formatVerificationFeedback(verification)
      })
      : undefined;
    const autoCompleted = verificationOutcome?.finalResult === "success";
    const developerScreenshot = shouldCaptureDeveloperScreenshot(
      resources.screenshotPolicy,
      observation,
      decision,
      execution,
      autoCompleted ? verification : undefined,
      autoCompleted
    )
      ? await captureDeveloperScreenshot(resources.browser.page)
      : undefined;

    await resources.trace.append(
      step,
      observation,
      decision,
      execution,
      {
        observeMs,
        decideMs,
        executeMs,
        verifyMs
      },
      autoCompleted ? verification : undefined,
      verificationOutcome?.shouldRecordVerdictAnalysis
        ? createVerdictAnalysis(
          undefined,
          verification,
          verificationOutcome.finalResult,
          verificationOutcome.completionSource
        )
        : undefined,
      developerScreenshot,
      stepContext.screenReaderArtifacts
    );
    recordAgentMemoryEntry(
      resources,
      state,
      step,
      decision,
      verificationOutcome?.finalResult ?? "continued",
      observation,
      execution.error
    );

    if (verificationOutcome) {
      applyVerificationOutcome(state, verificationOutcome);
      if (verificationOutcome.endedBy) {
        return {
          continueLoop: false,
          settleAfterStep: false
        };
      }
    }

    if (!execution.ok) {
      return {
        continueLoop: true,
        settleAfterStep: false
      };
    }

    return {
      continueLoop: true,
      settleAfterStep: true
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const executeMs = Date.now() - executeStartedAt;
    const failedExecution = {
      ok: false,
      error: message,
      costDelta: 0
    } as const;

    await resources.trace.append(
      step,
      observation,
      decision,
      failedExecution,
      {
        observeMs,
        decideMs,
        executeMs,
        verifyMs: 0
      },
      undefined,
      undefined,
      shouldCaptureDeveloperScreenshot(
        resources.screenshotPolicy,
        observation,
        decision,
        failedExecution
      )
        ? await captureDeveloperScreenshot(resources.browser.page)
        : undefined,
      stepContext.screenReaderArtifacts
    );
    recordAgentMemoryEntry(resources, state, step, decision, "continued", observation, message);

    if (error instanceof NotAllowedActionError) {
      state.endedBy = "error";
      return {
        continueLoop: false,
        settleAfterStep: false
      };
    }

    throw error;
  }
}

async function waitForNavigationGuardSignal(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function flushNavigationGuardWarnings(
  trace: TraceRecorder,
  browser: BrowserSession,
  step: number
): Promise<void> {
  const warnings = browser.takeNavigationGuardWarnings();
  for (const warning of warnings) {
    await trace.appendDiagnostic(step, warning);
  }
}

async function handleBlockedNavigationAttempt(
  stepContext: {
    step: number;
    observation: Observation;
    decision: Extract<Decision, { action: unknown }>;
    observeMs: number;
    decideMs: number;
    executeMs: number;
    screenReaderArtifacts?: ScreenReaderTraceArtifacts;
  },
  resources: RunResources,
  state: RunState,
  execution: ExecutionRecord,
  blockedNavigations: BrowserSession["navigation"]["blocked"]
): Promise<StepResult> {
  const primaryBlock = blockedNavigations[0];
  const errorMessage = primaryBlock?.reason ?? "Blocked navigation outside the allowed scope.";
  const blockedExecution: ExecutionRecord = {
    ...execution,
    ok: false,
    error: errorMessage
  };

  for (const blocked of blockedNavigations) {
    await resources.trace.appendDiagnostic(stepContext.step, {
      scope: "navigationGuard",
      level: "warn",
      code: "NAVIGATION_BLOCKED",
      message: blocked.reason
    });
  }

  await resources.trace.append(
    stepContext.step,
    stepContext.observation,
    stepContext.decision,
    blockedExecution,
    {
      observeMs: stepContext.observeMs,
      decideMs: stepContext.decideMs,
      executeMs: stepContext.executeMs,
      verifyMs: 0
    },
    undefined,
    undefined,
    shouldCaptureDeveloperScreenshot(
      resources.screenshotPolicy,
      stepContext.observation,
      stepContext.decision,
      blockedExecution
    )
      ? await captureDeveloperScreenshot(resources.browser.page)
      : undefined,
    stepContext.screenReaderArtifacts
  );
  recordAgentMemoryEntry(
    resources,
    state,
    stepContext.step,
    stepContext.decision,
    "continued",
    stepContext.observation,
    errorMessage
  );

  return {
    continueLoop: true,
    settleAfterStep: false
  };
}

function applyVerificationOutcome(
  state: RunState,
  verificationOutcome: ResolvedVerificationOutcome
): void {
  state.verificationFailures = verificationOutcome.nextVerificationFailures;
  if (!verificationOutcome.endedBy) {
    return;
  }

  state.endedBy = verificationOutcome.endedBy;
  state.failureReasonOverride = verificationOutcome.failureReasonOverride;
}

function recordAgentMemoryEntry(
  resources: Pick<RunResources, "agent">,
  state: RunState,
  step: number,
  decision: Decision,
  outcome: AgentMemoryEntry["outcome"],
  observation: Observation,
  note?: string
): void {
  const memoryEntry = createAgentMemoryEntry(step, decision, outcome, {
    note,
    observation,
    previousEntry: state.agentMemory.at(-1)
  });
  state.agentMemory.push(memoryEntry);
  resources.agent.recordStepOutcome?.(memoryEntry);
}

async function finalizeRun(
  task: ResolvedTask,
  trace: TraceRecorder,
  resources: Pick<RunResources, "agent"> | undefined,
  cleanup: RunCleanupHandles,
  state: RunState
): Promise<TraceSession> {
  if (cleanup.screenReaderRuntime) {
    await cleanup.screenReaderRuntime.close();
  }
  if (cleanup.browser) {
    await closeBrowserSession(cleanup.browser);
  }

  const session = await trace.finalize(state.endedBy ?? "error", state.failureReasonOverride);
  if (resources?.agent.summarizeExperience) {
    try {
      const experienceSummary = await resources.agent.summarizeExperience({
        task,
        aggregate: session.aggregate,
        steps: session.steps
      });
      session.experienceSummary = experienceSummary;
      trace.setExperienceSummary(experienceSummary);
    } catch (error) {
      trace.setExperienceSummaryError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Experience summary generation failed."
      );
    }
  }

  return session;
}

function applyPendingScreenReaderReadbacks(
  observation: Awaited<ReturnType<ReturnType<typeof createObserver>["observe"]>>,
  pendingScreenReaderReadbacks: ScreenReaderReadback[]
) {
  if (observation.kind !== "screenreader" || pendingScreenReaderReadbacks.length === 0) {
    return observation;
  }

  return {
    ...observation,
    readbacks: [
      ...(observation.readbacks ?? []),
      ...pendingScreenReaderReadbacks
    ]
  };
}

function applyPendingSyntheticAnnouncement(
  observation: Awaited<ReturnType<ReturnType<typeof createObserver>["observe"]>>,
  pendingSyntheticAnnouncement: string | undefined
) {
  if (observation.kind !== "screenreader" || !pendingSyntheticAnnouncement) {
    return observation;
  }

  return {
    ...observation,
    announcement: pendingSyntheticAnnouncement,
    announcementCapture: "synthetic" as const,
    announcementCount: 1,
    observeReason: "synthetic" as const
  };
}

function createScreenReaderReadbacks(
  execution: ExecutionRecord
): ScreenReaderReadback[] {
  const readbacks: ScreenReaderReadback[] = [];
  if (execution.readResult) {
    readbacks.push({
      kind: "read",
      method: execution.readResult.method,
      value: execution.readResult.value
    });
  }

  if (execution.maintenanceResult) {
    readbacks.push({
      kind: "maintenance",
      method: execution.maintenanceResult.method,
      status: execution.maintenanceResult.status
    });
  }

  return readbacks;
}

function createRuntimeRecoveryReadback(
  note: string
): ScreenReaderReadback {
  return {
    kind: "note",
    source: "runtime-recovery",
    value: note
  };
}

function actionCanChangeTaskState(action: Action): boolean {
  if (!("srAction" in action)) {
    return true;
  }

  if ("extension" in action.srAction) {
    return true;
  }

  return !action.srAction.semantic.startsWith("read.")
    && !action.srAction.semantic.startsWith("clear.");
}

function shouldCaptureAlertFollowUp(action: Action): boolean {
  return "srAction" in action
    && !("extension" in action.srAction)
    && action.srAction.semantic === "act";
}

function isActivationAction(action: Action): boolean {
  if ("key" in action) {
    return action.key === "Enter" || action.key === "Space";
  }

  if (!("srAction" in action)) {
    return false;
  }

  if ("extension" in action.srAction) {
    return false;
  }

  return action.srAction.semantic === "act"
    || action.srAction.semantic === "click"
    || action.srAction.semantic === "key.enter"
    || action.srAction.semantic === "key.space";
}
