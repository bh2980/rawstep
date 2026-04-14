import { formatScreenReaderIntent, type ScreenReaderActionPlan } from "@rawstep/action-catalog";
import type { BrowserSession } from "../browser";
import {
  Action,
  AgentMemoryEntry,
  Decision,
  EndedBy,
  Observation,
  formatDecisionAction as formatCoreDecisionAction,
  ScreenReaderCapabilities,
  ScreenshotPolicy,
  UserModel,
  VerdictAnalysis
} from "@rawstep/core";
import { KeyboardObserver } from "../observe/keyboard";
import {
  findScreenReaderBackendById,
  type ScreenReaderBackendId,
  type ScreenReaderRuntime
} from "../observe/screenreader";

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
  outcome: AgentMemoryEntry["outcome"],
  note?: string
): AgentMemoryEntry {
  return {
    step,
    action: formatMemoryAction(decision),
    outcome,
    ...(note ? { note } : {})
  };
}

export function shouldUseInteractiveObservation(decision: Extract<Decision, { action: unknown }>): boolean {
  if (!("srAction" in decision.action)) {
    return false;
  }

  if ("extension" in decision.action.srAction) {
    return true;
  }

  return !decision.action.srAction.semantic.startsWith("read.")
    && !decision.action.srAction.semantic.startsWith("clear.");
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

export function resolveScreenReaderCapabilities(
  screenReaderRuntime: ScreenReaderRuntime | undefined,
  screenReaderActionPlan: ScreenReaderActionPlan | undefined,
  screenReaderBackendId: ScreenReaderBackendId | undefined
): ScreenReaderCapabilities {
  if (screenReaderRuntime?.capabilities) {
    return screenReaderRuntime.capabilities;
  }

  if (screenReaderActionPlan) {
    return findScreenReaderBackendById(screenReaderActionPlan.backendId).capabilities;
  }

  if (screenReaderBackendId) {
    return findScreenReaderBackendById(screenReaderBackendId).capabilities;
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

export type VerificationAttemptKind = "verified-success" | "verifier-auto-complete";

export type ResolvedVerificationOutcome = {
  finalResult: VerdictAnalysis["finalResult"];
  verificationResult: Exclude<VerdictAnalysis["verificationResult"], "not-run">;
  nextVerificationFailures: number;
  endedBy?: Extract<EndedBy, "success" | "stuck">;
  failureReasonOverride?: string;
  completionSource: VerdictAnalysis["completionSource"];
  shouldRecordVerdictAnalysis: boolean;
};

export function resolveVerificationOutcome(args: {
  kind: VerificationAttemptKind;
  passed: boolean;
  verificationFailures: number;
  maxVerificationRetries: number;
  failureMessage?: string;
}): ResolvedVerificationOutcome {
  const completionSource = args.kind === "verified-success"
    ? "agent"
    : "verifier-auto-complete";

  if (args.passed) {
    return {
      finalResult: "success",
      verificationResult: "passed",
      nextVerificationFailures: args.verificationFailures,
      endedBy: "success",
      completionSource,
      shouldRecordVerdictAnalysis: true
    };
  }

  if (args.kind === "verifier-auto-complete") {
    return {
      finalResult: "continued",
      verificationResult: "failed",
      nextVerificationFailures: args.verificationFailures,
      completionSource,
      shouldRecordVerdictAnalysis: false
    };
  }

  const nextVerificationFailures = args.verificationFailures + 1;
  const exhaustedRetries = nextVerificationFailures >= args.maxVerificationRetries;

  return {
    finalResult: exhaustedRetries ? "failure" : "continued",
    verificationResult: "failed",
    nextVerificationFailures,
    endedBy: exhaustedRetries ? "stuck" : undefined,
    failureReasonOverride: exhaustedRetries && args.failureMessage
      ? `Verified success was not reached: ${args.failureMessage}`
      : undefined,
    completionSource,
    shouldRecordVerdictAnalysis: true
  };
}

function formatActionForMemory(action: Action): string {
  if ("srAction" in action) {
    return formatScreenReaderIntent(action.srAction);
  }

  return formatCoreDecisionAction(action);
}

function formatMemoryAction(decision: Decision): string {
  return "action" in decision
    ? formatActionForMemory(decision.action)
    : `verdict(${decision.verdict})`;
}
