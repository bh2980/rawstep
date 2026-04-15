import {
  formatDecisionAction,
  formatScreenReaderIntent,
} from "@rawstep/action-catalog";
import type { BrowserSession } from "../browser";
import {
  Action,
  type Agent,
  AgentMemoryEntry,
  Decision,
  EndedBy,
  Observation,
  ScreenshotPolicy,
  supportsVisualObservation,
  type UserModel,
  VerdictAnalysis
} from "@rawstep/definition";
import { KeyboardObserver } from "../observe/keyboard";
import {
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
  if (supportsVisualObservation(mode)) {
    return new KeyboardObserver(browser.page);
  }

  if (!screenReaderRuntime) {
    throw new Error("Screen reader runtime was not initialized.");
  }

  return screenReaderRuntime.observer;
}

export function resolveAgentContextMemory(
  agent: Agent,
  fallbackMemory: AgentMemoryEntry[]
): AgentMemoryEntry[] {
  const excerpt = agent.getMemoryExcerpt?.();
  return excerpt ? [...excerpt] : [...fallbackMemory];
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

  return formatDecisionAction(action);
}

function formatMemoryAction(decision: Decision): string {
  return "action" in decision
    ? formatActionForMemory(decision.action)
    : `verdict(${decision.verdict})`;
}
