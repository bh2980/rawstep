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
  type AgentHistoryEntry,
  type Agent,
  type EndedBy,
  type Observation,
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
  const verifierFeedback: AgentHistoryEntry[] = [];
  let verificationFailures = 0;
  let endedBy: EndedBy | undefined;
  let session: TraceSession | undefined;
  let unexpectedError: unknown;
  let failureReasonOverride: string | undefined;
  let browser: BrowserSession | undefined;
  let screenReaderRuntime: ScreenReaderRuntime | undefined;
  let actuator: Actuator | undefined;

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
    const agent = options.agent ?? new LLMAgent(task.mode, {
      ...options.agentOptions,
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
      const developerScreenshot = observation.kind === "screenreader"
        ? await captureDeveloperScreenshot(browser.page)
        : undefined;
      const observeMs = Date.now() - observeStartedAt;
      const context = {
        goal: task.goal,
        allowedKeys: allowsRawKeyActions(task.mode) ? ALLOWED_KEYS : [],
        allowedScreenReaderCommands: isScreenReaderMode(task.mode)
          ? SCREENREADER_COMMANDS
          : undefined,
        history: buildHistoryWindow(trace.recentDecisions(HISTORY_WINDOW), verifierFeedback)
      };
      const decideStartedAt = Date.now();
      const decision = await agent.decide(context, observation);
      const decideMs = Date.now() - decideStartedAt;

      if ("verdict" in decision) {
        if (decision.verdict === "success" && task.verify) {
          const verifyStartedAt = Date.now();
          const verification = await verifyTask(task, browser);
          const verifyMs = Date.now() - verifyStartedAt;
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
                : "continued"),
            developerScreenshot
          );

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

          verifierFeedback.push({
            stepIndex: step,
            source: "verifier",
            rationale: feedback
          });
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
          createVerdictAnalysis(decision.verdict, undefined, decision.verdict === "success" ? "success" : "failure"),
          developerScreenshot
        );
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
        await trace.append(
          step,
          observation,
          decision,
          execution,
          {
            observeMs,
            decideMs,
            executeMs,
            verifyMs: 0
          },
          undefined,
          undefined,
          developerScreenshot
        );

        if (!execution.ok) {
          continue;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        const executeMs = Date.now() - executeStartedAt;
        await trace.append(step, observation, decision, {
          ok: false,
          error: message,
          costDelta: 0
        }, {
          observeMs,
          decideMs,
          executeMs,
          verifyMs: 0
        }, undefined, undefined, developerScreenshot);

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

function buildHistoryWindow(
  agentHistory: AgentHistoryEntry[],
  verifierFeedback: AgentHistoryEntry[]
): AgentHistoryEntry[] {
  return [...agentHistory, ...verifierFeedback].slice(-HISTORY_WINDOW);
}

function createObserver(
  mode: Task["mode"],
  browser: BrowserSession,
  screenReaderRuntime?: ScreenReaderRuntime
): { observe(): Promise<Observation> } {
  if (isScreenReaderMode(mode)) {
    if (!screenReaderRuntime) {
      throw new Error("Screen reader runtime was not initialized.");
    }

    return screenReaderRuntime.observer;
  }

  return new KeyboardObserver(browser.page);
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
  finalResult: VerdictAnalysis["finalResult"]
): VerdictAnalysis {
  return {
    agentVerdict,
    verificationResult: verification
      ? verification.passed
        ? "passed"
        : "failed"
      : "not-run",
    finalResult
  };
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
