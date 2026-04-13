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
  HISTORY_WINDOW,
  SCREENREADER_COMMANDS,
  type AgentMemoryEntry,
  type Agent,
  type EndedBy,
  type ScreenshotPolicy,
  type Task,
  type TraceSession
} from "@a11y-task/core";
import {
  createScreenReaderRuntime,
  type ScreenReaderRuntime,
  type ScreenReaderRuntimeFactory
} from "@a11y-task/observer-screenreader";
import { TraceRecorder } from "@a11y-task/trace";
import {
  allowsRawKeyActions,
  createAgentMemoryEntry,
  createObserver,
  createVerdictAnalysis,
  getErrorMessage,
  isScreenReaderMode,
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
      ? await (options.screenReaderRuntimeFactory ?? createScreenReaderRuntime)(browser.page)
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
      screenReaderInitMs: screenReaderRuntime?.setupTimings.screenReaderInitMs ?? 0,
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
          options.agentMemoryWindow ?? HISTORY_WINDOW
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
        if (execution.ok && execution.costDelta > 0) {
          successfulActionCount += 1;
        }

        const shouldCheckVerifierAutoComplete = Boolean(
          options.verifierAutoComplete
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
