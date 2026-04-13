import type { BrowserSession } from "@a11y-task/browser";
import type {
  Action,
  AgentMemoryEntry,
  Decision,
  Observation,
  ScreenshotPolicy,
  UserModel,
  VerdictAnalysis
} from "@a11y-task/core";
import { KeyboardObserver } from "@a11y-task/observer-keyboard";
import type { ScreenReaderBackendId, ScreenReaderRuntime } from "@a11y-task/observer-screenreader";

export type RunnerObserver = {
  observe(): Promise<Observation>;
  prepareNextObservation?(profile: "initial" | "default" | "interactive"): void;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function createObserver(
  mode: UserModel,
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

export function selectAgentMemoryExcerpt(
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

export function createAgentMemoryEntry(
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

export function shouldUseInteractiveObservation(decision: Extract<Decision, { action: unknown }>): boolean {
  return "srCommand" in decision.action && decision.action.srCommand === "act";
}

export function isScreenReaderMode(mode: UserModel): boolean {
  return mode === "screenreader-strict" || mode === "screenreader-hybrid";
}

export function resolveBrowserHeadless(
  mode: UserModel,
  configuredHeadless?: boolean,
  screenReaderBackendId?: ScreenReaderBackendId
): boolean {
  if (configuredHeadless !== undefined) {
    if (
      isScreenReaderMode(mode)
      &&
      configuredHeadless
      && (screenReaderBackendId === "guidepup-voiceover" || screenReaderBackendId === "guidepup-nvda")
    ) {
      throw new Error(
        `Screen reader backend "${screenReaderBackendId}" requires a headed browser. Use --headed or set headless: false.`
      );
    }

    return configuredHeadless;
  }

  if (!isScreenReaderMode(mode)) {
    return true;
  }

  return screenReaderBackendId === "guidepup-virtual";
}

export function allowsRawKeyActions(mode: UserModel): boolean {
  return mode === "keyboard" || mode === "screenreader-hybrid";
}

export function createVerdictAnalysis(
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
