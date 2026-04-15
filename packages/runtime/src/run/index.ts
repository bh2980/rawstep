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
  type Decision,
  type ExecutionRecord,
  type AgentMemoryEntry,
  type Agent,
  type Action,
  type EndedBy,
  isScreenReaderMode,
  type Observation,
  type ResolvedTask,
  type ScreenReaderBackendId,
  type ScreenReaderObserveConfig,
  type ScreenReaderReadback,
  type ScreenshotPolicy,
  type TraceSession,
  type UserModel,
  type VoiceOverConfig,
} from "@rawstep/definition";
import {
  createScreenReaderRuntime,
  resolveScreenReaderBrowserHeadless,
  resolveScreenReaderCapabilities,
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
  verifyTask
} from "../verify";

export type RunTaskOptions = {
  outDir: string;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  maxVerificationRetries?: number;
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
  pendingScreenReaderReadbacks: ScreenReaderReadback[];
  pendingSyntheticAnnouncement?: string;
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
    pendingScreenReaderReadbacks: []
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

      const stepResult = await executeStep(step, resources, state);
      if (!stepResult.continueLoop) {
        break;
      }

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
  }

  const session = await finalizeRun(task, trace, resources, cleanup, state);

  if (unexpectedError) {
    throw unexpectedError;
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
    headless: resolveScreenReaderBrowserHeadless(task.mode, options.headless, options.screenReaderBackendId)
  });
  if (!isScreenReaderMode(task.mode)) {
    await bootstrapKeyboardFocus(cleanup.browser.page);
  }

  cleanup.screenReaderRuntime = isScreenReaderMode(task.mode)
    ? await (options.screenReaderRuntimeFactory
      ?? ((page) => createScreenReaderRuntime(page, {
        backendId: options.screenReaderBackendId,
        actionPlan: options.screenReaderActionPlan,
        observe: options.screenReaderObserve,
        voiceOver: options.voiceOver
      })))(cleanup.browser.page)
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

async function executeStep(
  step: number,
  resources: RunResources,
  state: RunState
): Promise<StepResult> {
  const builtContext = await buildAgentStepContext(resources, state);
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
  const baseObservation = await resources.observer.observe();
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
    context: {
      goal: resources.task.goal,
      keyboardActions: resources.keyboardActionPlan.descriptors,
      screenReaderActions: resources.screenReaderActionPlan?.descriptors,
      memory: resolveAgentContextMemory(resources.agent, state.agentMemory)
    }
  };
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
    const verification = await verifyTask(resources.task, resources.browser);
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
    recordAgentMemoryEntry(resources, state, step, decision, verificationOutcome.finalResult, verificationFeedback);
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
  recordAgentMemoryEntry(resources, state, step, decision, "failure");
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
    if (execution.ok && execution.costDelta > 0 && actionCanChangeTaskState(decision.action)) {
      state.successfulActionCount += 1;
    }
    if (execution.ok) {
      state.pendingScreenReaderReadbacks = [
        ...state.pendingScreenReaderReadbacks,
        ...createScreenReaderReadbacks(execution)
      ];
      if (execution.textEntryResult?.syntheticAnnouncement) {
        state.pendingSyntheticAnnouncement = execution.textEntryResult.syntheticAnnouncement;
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
      ? await verifyTask(resources.task, resources.browser)
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
    recordAgentMemoryEntry(resources, state, step, decision, "continued", message);

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
  note?: string
): void {
  const memoryEntry = createAgentMemoryEntry(step, decision, outcome, note);
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
      method: execution.readResult.method,
      value: execution.readResult.value
    });
  }

  if (execution.maintenanceResult) {
    readbacks.push({
      method: execution.maintenanceResult.method,
      status: execution.maintenanceResult.status
    });
  }

  return readbacks;
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

async function bootstrapKeyboardFocus(page: BrowserSession["page"]): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => {
    window.focus();
    const target = document.body ?? document.documentElement;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-rawstep-keyboard-bootstrap", "true");
    }

    target.focus({ preventScroll: true });
  });
}
