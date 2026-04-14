import { Actuator, NotAllowedActionError } from "../actuator";
import { LLMAgent, type LLMAgentOptions } from "@rawstep/agent";
import {
  closeBrowserSession,
  createBrowserSession,
  settlePage,
  type BrowserSession,
  type CreateBrowserSessionOptions
} from "../browser";
import {
  DEFAULT_ALLOWED_KEYS,
  buildAllowedScreenReaderActions,
  type AgentMemoryEntry,
  type Agent,
  type Action,
  type AllowedKey,
  type AllowedScreenReaderAction,
  type EndedBy,
  type ScreenReaderReadback,
  type ScreenReaderCapabilities,
  type ScreenshotPolicy,
  type Task,
  type TraceSession
} from "@rawstep/core";
import {
  createScreenReaderRuntime,
  findScreenReaderBackendById,
  type ScreenReaderBackendId,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeFactory
} from "../observe/screenreader";
import { TraceRecorder } from "../trace";
import {
  allowsRawKeyActions,
  createAgentMemoryEntry,
  createObserver,
  createVerdictAnalysis,
  getErrorMessage,
  isScreenReaderMode,
  resolveBrowserHeadless,
  shouldUseInteractiveObservation,
  selectAgentMemoryExcerpt
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
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  headless?: boolean;
  allowedKeys?: readonly AllowedKey[];
  allowedScreenReaderActions?: readonly AllowedScreenReaderAction[];
  screenReaderBackendId?: ScreenReaderBackendId;
  agent?: Agent;
  agentOptions?: LLMAgentOptions;
  browserSessionFactory?: (
    url: string,
    options?: CreateBrowserSessionOptions
  ) => Promise<BrowserSession>;
  screenReaderRuntimeFactory?: ScreenReaderRuntimeFactory;
};

export * from "../verify";

function resolveScreenReaderCapabilities(
  screenReaderRuntime: ScreenReaderRuntime | undefined,
  options: RunTaskOptions
): ScreenReaderCapabilities {
  if (screenReaderRuntime?.capabilities) {
    return screenReaderRuntime.capabilities;
  }

  if (options.allowedScreenReaderActions && options.allowedScreenReaderActions.length > 0) {
    const invokeMethods = {
      next: false,
      previous: false,
      act: false,
      interact: false,
      stopInteracting: false,
      press: false,
      type: false,
      click: false,
      perform: false,
      supportsRawPerform: false
    };
    const readMethods = {
      itemText: false,
      itemTextLog: false,
      lastSpokenPhrase: false,
      spokenPhraseLog: false
    };
    const maintenanceMethods = {
      clearItemTextLog: false,
      clearSpokenPhraseLog: false
    };

    const performCatalog = options.allowedScreenReaderActions
      .filter((action): action is Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }> =>
        action.kind === "invoke" && action.method === "perform" && action.source === "catalog"
      )
      .map((action) => ({
        id: action.id,
        label: action.id,
        description: action.id
      }));

    for (const action of options.allowedScreenReaderActions) {
      if (action.kind === "invoke") {
        if (action.method === "perform") {
          invokeMethods.perform = true;
          if (action.source === "raw") {
            invokeMethods.supportsRawPerform = true;
          }
        } else {
          invokeMethods[action.method] = true;
        }
        continue;
      }

      if (action.kind === "read") {
        readMethods[action.method] = true;
        continue;
      }

      maintenanceMethods[action.method] = true;
    }

    return {
      invoke: invokeMethods,
      read: readMethods,
      maintenance: maintenanceMethods,
      performCatalog
    };
  }

  if (options.screenReaderBackendId) {
    return findScreenReaderBackendById(options.screenReaderBackendId).capabilities;
  }

  return {
    invoke: {
      next: false,
      previous: false,
      act: false,
      interact: false,
      stopInteracting: false,
      press: false,
      type: false,
      click: false,
      perform: false,
      supportsRawPerform: false
    },
    read: {
      itemText: false,
      itemTextLog: false,
      lastSpokenPhrase: false,
      spokenPhraseLog: false
    },
    maintenance: {
      clearItemTextLog: false,
      clearSpokenPhraseLog: false
    },
    performCatalog: []
  };
}

export async function runTask(task: Task, options: RunTaskOptions): Promise<TraceSession> {
  const trace = new TraceRecorder(task, options.outDir);
  await trace.initialize();
  const setupStartedAt = Date.now();

  const deadline = Date.now() + task.timeoutMs;
  let verificationFailures = 0;
  let successfulActionCount = 0;
  const agentMemory: AgentMemoryEntry[] = [];
  let pendingScreenReaderReadbacks: ScreenReaderReadback[] = [];
  let endedBy: EndedBy | undefined;
  let session: TraceSession | undefined;
  let unexpectedError: unknown;
  let failureReasonOverride: string | undefined;
  let browser: BrowserSession | undefined;
  let screenReaderRuntime: ScreenReaderRuntime | undefined;
  let actuator: Actuator | undefined;
  let agent: Agent | undefined;

  const screenshotPolicy = options.screenshotPolicy ?? "all";
  try {
    const browserFactory = options.browserSessionFactory ?? createBrowserSession;
    browser = await browserFactory(task.url, {
      headless: resolveBrowserHeadless(task.mode, options.headless, options.screenReaderBackendId)
    });
    if (!isScreenReaderMode(task.mode)) {
      await bootstrapKeyboardFocus(browser.page);
    }
    const browserLaunchMs = browser.setupTimings?.browserLaunchMs ?? 0;
    const pageLoadMs = browser.setupTimings?.pageLoadMs ?? 0;
    screenReaderRuntime = isScreenReaderMode(task.mode)
      ? await (options.screenReaderRuntimeFactory
        ?? ((page) => createScreenReaderRuntime(page, {
          backendId: options.screenReaderBackendId,
          allowedActions: options.allowedScreenReaderActions
        })))(browser.page)
      : undefined;

    const observer = createObserver(task.mode, browser, screenReaderRuntime);
    actuator = new Actuator(browser.page, {
      screenReaderController: screenReaderRuntime?.controller
    });
    const screenReaderCapabilities = isScreenReaderMode(task.mode)
      ? resolveScreenReaderCapabilities(screenReaderRuntime, options)
      : undefined;
    agent = options.agent ?? new LLMAgent(task.mode, {
      ...options.agentOptions,
      agentMemoryWindow: options.agentMemoryWindow,
      agentMemoryAll: options.agentMemoryAll,
      includeExperienceSummary: options.includeExperienceSummary,
      screenReaderCapabilities,
      taskInput: task.input
    });
    trace.setSetupTimings({
      setupMs: Date.now() - setupStartedAt,
      browserLaunchMs,
      pageLoadMs,
      screenReaderInitMs: screenReaderRuntime?.setupTimings.screenReaderInitMs ?? 0,
      firstAnnouncementWaitMs: screenReaderRuntime?.setupTimings.firstAnnouncementWaitMs ?? 0
    });

    for (let step = 0; step < task.maxSteps; step += 1) {
      if (Date.now() >= deadline) {
        endedBy = "timeout";
        break;
      }

      const observeStartedAt = Date.now();
      const baseObservation = await observer.observe();
      const observation = applyPendingScreenReaderReadbacks(baseObservation, pendingScreenReaderReadbacks);
      if (observation.kind === "screenreader" && pendingScreenReaderReadbacks.length > 0) {
        pendingScreenReaderReadbacks = [];
      }
      const observeMs = Date.now() - observeStartedAt;
      const context = {
        goal: task.goal,
        allowedKeys: allowsRawKeyActions(task.mode)
          ? options.allowedKeys ?? DEFAULT_ALLOWED_KEYS
          : [],
        allowedScreenReaderActions: isScreenReaderMode(task.mode)
          ? options.allowedScreenReaderActions ?? buildAllowedScreenReaderActions(screenReaderCapabilities!)
          : undefined,
        memory: selectAgentMemoryExcerpt(
          agentMemory,
          options.agentMemoryAll ?? false,
          options.agentMemoryWindow ?? 0
        )
      };
      const decideStartedAt = Date.now();
      const decision = await agent.decide(context, observation);
      const decideMs = Date.now() - decideStartedAt;

      if ("verdict" in decision) {
        if (decision.verdict === "success") {
          const verifyStartedAt = Date.now();
          const verification = await verifyTask(task, browser);
          const verifyMs = Date.now() - verifyStartedAt;
          const developerScreenshot = shouldCaptureDeveloperScreenshot(
            screenshotPolicy,
            observation,
            decision,
            undefined,
            verification
          )
            ? await captureDeveloperScreenshot(browser.page)
            : undefined;
          await trace.append(
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
            createVerdictAnalysis(decision.verdict, verification, verification.passed
              ? "success"
              : verificationFailures + 1 >= MAX_VERIFICATION_RETRIES
                ? "failure"
                : "continued", "agent"),
            developerScreenshot
          );
          const memoryEntry = createAgentMemoryEntry(
            step,
            decision,
            verification.passed
              ? "success"
              : verificationFailures + 1 >= MAX_VERIFICATION_RETRIES
                ? "failure"
                : "continued",
            verification.passed ? undefined : formatVerificationFeedback(verification)
          );
          agentMemory.push(memoryEntry);
          agent.recordStepOutcome?.(memoryEntry);

          if (verification.passed) {
            endedBy = "success";
            break;
          }

          verificationFailures += 1;
          const feedback = formatVerificationFeedback(verification);

          if (verificationFailures >= MAX_VERIFICATION_RETRIES) {
            endedBy = "stuck";
            failureReasonOverride = `Verified success was not reached: ${feedback}`;
            break;
          }

          continue;
        }

        await trace.append(
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
          shouldCaptureDeveloperScreenshot(screenshotPolicy, observation, decision)
            ? await captureDeveloperScreenshot(browser.page)
            : undefined
        );
        const memoryEntry = createAgentMemoryEntry(
          step,
          decision,
          "failure"
        );
        agentMemory.push(memoryEntry);
        agent.recordStepOutcome?.(memoryEntry);
        endedBy = decision.verdict;
        break;
      }

      const executeStartedAt = Date.now();
      try {
        if ("key" in decision.action && !allowsRawKeyActions(task.mode)) {
          throw new NotAllowedActionError("Raw key actions are not allowed in screenreader-strict mode.");
        }

        const execution = await actuator.execute(decision.action, task.input);
        const executeMs = Date.now() - executeStartedAt;
        if (execution.ok && execution.costDelta > 0 && actionCanChangeTaskState(decision.action)) {
          successfulActionCount += 1;
        }
        if (execution.ok) {
          pendingScreenReaderReadbacks = [
            ...pendingScreenReaderReadbacks,
            ...createScreenReaderReadbacks(execution)
          ];
        }

        const shouldCheckVerifierAutoComplete = Boolean(
          options.verifierAutoComplete
          && execution.ok
          && execution.costDelta > 0
          && actionCanChangeTaskState(decision.action)
          && successfulActionCount > 0
        );
        const verifyStartedAt = shouldCheckVerifierAutoComplete ? Date.now() : 0;
        const verification = shouldCheckVerifierAutoComplete
          ? await verifyTask(task, browser)
          : undefined;
        const verifyMs = shouldCheckVerifierAutoComplete
          ? Date.now() - verifyStartedAt
          : 0;
        const autoCompleted = Boolean(verification?.passed);
        const developerScreenshot = shouldCaptureDeveloperScreenshot(
          screenshotPolicy,
          observation,
          decision,
          execution,
          autoCompleted ? verification : undefined,
          autoCompleted
        )
          ? await captureDeveloperScreenshot(browser.page)
          : undefined;
        await trace.append(
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
          autoCompleted
            ? createVerdictAnalysis(undefined, verification, "success", "verifier-auto-complete")
            : undefined,
          developerScreenshot
        );
        const memoryEntry = createAgentMemoryEntry(
          step,
          decision,
          autoCompleted ? "success" : "continued",
          execution.error
        );
        agentMemory.push(memoryEntry);
        agent.recordStepOutcome?.(memoryEntry);

        if (autoCompleted) {
          endedBy = "success";
          break;
        }

        if (!execution.ok) {
          continue;
        }

        if (shouldUseInteractiveObservation(decision)) {
          observer.prepareNextObservation?.("interactive");
        }
      } catch (error) {
        const message = getErrorMessage(error);
        const executeMs = Date.now() - executeStartedAt;
        const failedExecution = {
          ok: false,
          error: message,
          costDelta: 0
        } as const;
        await trace.append(step, observation, decision, {
          ...failedExecution
        }, {
          observeMs,
          decideMs,
          executeMs,
          verifyMs: 0
        }, undefined, undefined, shouldCaptureDeveloperScreenshot(
          screenshotPolicy,
          observation,
          decision,
          failedExecution
        )
          ? await captureDeveloperScreenshot(browser.page)
          : undefined);
        const memoryEntry = createAgentMemoryEntry(
          step,
          decision,
          "continued",
          message
        );
        agentMemory.push(memoryEntry);
        agent.recordStepOutcome?.(memoryEntry);

        if (error instanceof NotAllowedActionError) {
          endedBy = "error";
          break;
        }

        throw error;
      }

      await settlePage(browser.page);
    }

    if (!endedBy) {
      endedBy = "maxSteps";
    }
  } catch (error) {
    unexpectedError = error;
    endedBy = endedBy ?? "error";
  } finally {
    if (screenReaderRuntime) {
      await screenReaderRuntime.close();
    }
    if (browser) {
      await closeBrowserSession(browser);
    }
    session = await trace.finalize(endedBy ?? "error", failureReasonOverride);
  }

  if (session && options.includeExperienceSummary && agent?.summarizeExperience) {
    try {
      const experienceSummary = await agent.summarizeExperience({
        task,
        aggregate: session.aggregate,
        steps: session.steps
      });
      session.experienceSummary = experienceSummary;
      trace.setExperienceSummary(experienceSummary);
    } catch {
      // Summary generation is optional and should not fail the run.
    }
  }

  if (unexpectedError) {
    throw unexpectedError;
  }

  return session!;
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

function createScreenReaderReadbacks(
  execution: import("@rawstep/core").ExecutionRecord
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
  return "srAction" in action
    ? action.srAction.kind === "invoke"
    : true;
}

async function bootstrapKeyboardFocus(page: BrowserSession["page"]): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => {
    const target = document.body ?? document.documentElement;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-rawstep-keyboard-bootstrap", "true");
    }

    target.focus();
  });
}
