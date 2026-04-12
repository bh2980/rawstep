import { Actuator, NotAllowedActionError } from "@a11y-task/actuator";
import { LLMAgent, type LLMAgentOptions } from "@a11y-task/agent";
import {
  closeBrowserSession,
  createBrowserSession,
  settlePage,
  type BrowserSession,
  type CreateBrowserSessionOptions
} from "@a11y-task/browser";
import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type Action,
  type AgentMemoryEntry,
  type Agent,
  type Decision,
  type EndedBy,
  type Observation,
  type ScreenshotPolicy,
  type Task,
  type UserModel,
  type TraceSession,
  type VerdictAnalysis
} from "@a11y-task/core";
import { KeyboardObserver } from "@a11y-task/observer-keyboard";
import {
  createVoiceOverRuntime,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeFactory
} from "@a11y-task/observer-screenreader";
import { TraceRecorder } from "@a11y-task/trace";
import {
  formatVerificationFeedback,
  MAX_VERIFICATION_RETRIES,
  verifyTask
} from "./verifier";

export type RunTaskOptions = {
  outDir: string;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  agent?: Agent;
  agentOptions?: LLMAgentOptions;
  browserSessionFactory?: (
    url: string,
    options?: CreateBrowserSessionOptions
  ) => Promise<BrowserSession>;
  screenReaderRuntimeFactory?: ScreenReaderRuntimeFactory;
};

export * from "./verifier";

type RunnerObserver = {
  observe(): Promise<Observation>;
  prepareNextObservation?(profile: "initial" | "default" | "interactive"): void;
};

export async function runTask(task: Task, options: RunTaskOptions): Promise<TraceSession> {
  const trace = new TraceRecorder(task, options.outDir);
  await trace.initialize();
  const setupStartedAt = Date.now();

  const deadline = Date.now() + task.timeoutMs;
  let verificationFailures = 0;
  let successfulActionCount = 0;
  const agentMemory: AgentMemoryEntry[] = [];
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
      headless: !isScreenReaderMode(task.mode)
    });
    const browserLaunchMs = browser.setupTimings?.browserLaunchMs ?? 0;
    const pageLoadMs = browser.setupTimings?.pageLoadMs ?? 0;
    screenReaderRuntime = isScreenReaderMode(task.mode)
      ? await (options.screenReaderRuntimeFactory ?? createVoiceOverRuntime)(browser.page)
      : undefined;

    const observer = createObserver(task.mode, browser, screenReaderRuntime);
    actuator = new Actuator(browser.page, {
      screenReaderController: screenReaderRuntime?.controller
    });
    agent = options.agent ?? new LLMAgent(task.mode, {
      ...options.agentOptions,
      agentMemoryWindow: options.agentMemoryWindow,
      agentMemoryAll: options.agentMemoryAll,
      includeExperienceSummary: options.includeExperienceSummary,
      taskInput: task.input
    });
    trace.setSetupTimings({
      setupMs: Date.now() - setupStartedAt,
      browserLaunchMs,
      pageLoadMs,
      voiceOverInitMs: screenReaderRuntime?.setupTimings.voiceOverInitMs ?? 0,
      firstAnnouncementWaitMs: screenReaderRuntime?.setupTimings.firstAnnouncementWaitMs ?? 0
    });

    for (let step = 0; step < task.maxSteps; step += 1) {
      if (Date.now() >= deadline) {
        endedBy = "timeout";
        break;
      }

      const observeStartedAt = Date.now();
      const observation = await observer.observe();
      const observeMs = Date.now() - observeStartedAt;
      const context = {
        goal: task.goal,
        allowedKeys: allowsRawKeyActions(task.mode) ? ALLOWED_KEYS : [],
        allowedScreenReaderCommands: isScreenReaderMode(task.mode)
          ? SCREENREADER_COMMANDS
          : undefined,
        memory: selectAgentMemoryExcerpt(
          agentMemory,
          options.agentMemoryAll ?? false,
          options.agentMemoryWindow ?? 1
        )
      };
      const decideStartedAt = Date.now();
      const decision = await agent.decide(context, observation);
      const decideMs = Date.now() - decideStartedAt;

      if ("verdict" in decision) {
        if (decision.verdict === "success" && task.verify) {
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
                : "continued"
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
            decision.verdict === "success" ? "success" : "failure",
            "agent"
          ),
          shouldCaptureDeveloperScreenshot(screenshotPolicy, observation, decision)
            ? await captureDeveloperScreenshot(browser.page)
            : undefined
        );
        const memoryEntry = createAgentMemoryEntry(
          step,
          decision,
          decision.verdict === "success" ? "success" : "failure"
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
        if (execution.ok && execution.costDelta > 0) {
          successfulActionCount += 1;
        }

        const shouldCheckVerifierAutoComplete = Boolean(
          options.verifierAutoComplete
          && task.verify
          && execution.ok
          && execution.costDelta > 0
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
          autoCompleted ? "success" : "continued"
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
          "continued"
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
        aggregate: session.aggregate
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createObserver(
  mode: Task["mode"],
  browser: BrowserSession,
  screenReaderRuntime?: ScreenReaderRuntime
): RunnerObserver {
  if (isScreenReaderMode(mode)) {
    if (!screenReaderRuntime) {
      throw new Error("Screen reader runtime was not initialized.");
    }

    return screenReaderRuntime.observer;
  }

  return new KeyboardObserver(browser.page);
}

function selectAgentMemoryExcerpt(
  memory: AgentMemoryEntry[],
  useAll: boolean,
  windowSize: number
): AgentMemoryEntry[] {
  if (useAll) {
    return [...memory];
  }

  if (windowSize <= 0) {
    return [];
  }

  return memory.slice(-windowSize);
}

function createAgentMemoryEntry(
  step: number,
  decision: Decision,
  outcome: AgentMemoryEntry["outcome"]
): AgentMemoryEntry {
  return {
    step,
    action: formatMemoryAction(decision),
    outcome
  };
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

function formatMemoryAction(decision: Decision): string {
  return "action" in decision
    ? formatDecisionAction(decision.action)
    : `verdict(${decision.verdict})`;
}

function shouldUseInteractiveObservation(decision: Extract<Decision, { action: unknown }>): boolean {
  return "srCommand" in decision.action && decision.action.srCommand === "act";
}

function isScreenReaderMode(mode: UserModel): boolean {
  return mode === "screenreader-strict" || mode === "screenreader-hybrid";
}

function allowsRawKeyActions(mode: UserModel): boolean {
  return mode === "keyboard" || mode === "screenreader-hybrid";
}

function createVerdictAnalysis(
  agentVerdict: VerdictAnalysis["agentVerdict"],
  verification: { passed: boolean } | undefined,
  finalResult: VerdictAnalysis["finalResult"],
  completionSource: VerdictAnalysis["completionSource"]
): VerdictAnalysis {
  return {
    agentVerdict,
    verificationResult: verification
      ? verification.passed
        ? "passed"
        : "failed"
      : "not-run",
    finalResult,
    completionSource
  };
}

function shouldCaptureDeveloperScreenshot(
  policy: ScreenshotPolicy,
  observation: Observation,
  decision: Decision,
  execution?: { ok: boolean },
  verification?: { passed: boolean },
  forceCapture = false
): boolean {
  if (observation.kind !== "screenreader") {
    return false;
  }

  switch (policy) {
    case "all":
      return true;
    case "none":
      return false;
    case "failure-only":
      if (forceCapture) {
        return true;
      }

      if (verification) {
        return !verification.passed;
      }

      if ("verdict" in decision) {
        return decision.verdict !== "success";
      }

      return execution?.ok === false;
    case "important":
      if (verification) {
        return true;
      }

      if ("verdict" in decision) {
        return true;
      }

      if (execution?.ok === false) {
        return true;
      }

      if ("action" in decision) {
        if ("typeText" in decision.action) {
          return true;
        }

        if ("srCommand" in decision.action) {
          return decision.action.srCommand === "act";
        }
      }

      return false;
  }
}

async function captureDeveloperScreenshot(
  page: BrowserSession["page"]
): Promise<{ pngBase64: string; viewport: { w: number; h: number } }> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const buffer = await page.screenshot({ type: "png" });

  return {
    pngBase64: buffer.toString("base64"),
    viewport: { w: viewport.width, h: viewport.height }
  };
}
