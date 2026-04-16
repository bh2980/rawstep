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
import type { AnnouncementReadOptions } from "../observe/screenreader/types";
import type { ScreenReaderDomFocusCapture } from "../trace/artifacts";

export type RunnerObserver = {
  observe(options?: AnnouncementReadOptions): Promise<Observation>;
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
  options: {
    note?: string;
    observation?: Observation;
    previousEntry?: AgentMemoryEntry;
  } = {}
): AgentMemoryEntry {
  const action = formatMemoryAction(decision);
  const sameActionCount = options.previousEntry?.action === action
    ? (options.previousEntry.sameActionCount ?? 1) + 1
    : 1;
  const screenReaderFields = buildScreenReaderMemoryFields(
    options.observation,
    options.previousEntry
  );

  return {
    step,
    action,
    outcome,
    sameActionCount,
    ...screenReaderFields,
    ...(options.note ? { note: options.note } : {})
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

  return formatDecisionAction(action);
}

function formatMemoryAction(decision: Decision): string {
  return "action" in decision
    ? formatActionForMemory(decision.action)
    : `verdict(${decision.verdict})`;
}

function buildScreenReaderMemoryFields(
  observation: Observation | undefined,
  previousEntry: AgentMemoryEntry | undefined
): Partial<AgentMemoryEntry> {
  if (!observation || observation.kind !== "screenreader") {
    return {};
  }

  const announcementExcerpt = summarizeAnnouncement(observation.announcement);
  const sameAnnouncementCount = previousEntry?.announcementExcerpt === announcementExcerpt
    ? (previousEntry.sameAnnouncementCount ?? 1) + 1
    : 1;

  return {
    announcementExcerpt,
    announcementCapture: observation.announcementCapture,
    ...(typeof observation.announcementCount === "number"
      ? { announcementCount: observation.announcementCount }
      : {}),
    ...(observation.observeReason
      ? { observeReason: observation.observeReason }
      : {}),
    sameAnnouncementCount
  };
}

function summarizeAnnouncement(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 160);
}

export async function captureScreenReaderDomFocus(page: BrowserSession["page"]): Promise<ScreenReaderDomFocusCapture> {
  try {
    return await page.evaluate(() => {
      const active = document.activeElement;

      if (!(active instanceof HTMLElement)) {
        return {
          status: "captured" as const,
          snapshot: {
            hasDocumentFocus: document.hasFocus()
          }
        };
      }

      const label = ((value: string | null | undefined): string | undefined => {
        const trimmed = value?.trim();
        return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
      })(
        active.getAttribute("aria-label")
          ?? (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
            ? Array.from(active.labels ?? [])
              .map((node) => node.textContent ?? "")
              .join(" ")
            : undefined)
      );
      const targetSelector = ((element: Element | null): string | undefined => {
        if (!element) {
          return undefined;
        }

        const parts: string[] = [];
        let current: Element | null = element;
        while (current && parts.length < 3) {
          let part = current.tagName.toLowerCase();
          if (current.id) {
            part += `#${current.id}`;
            parts.unshift(part);
            break;
          }

          const role = current.getAttribute("role");
          if (role) {
            part += `[role="${role}"]`;
          }

          parts.unshift(part);
          current = current.parentElement;
        }

        return parts.join(" > ") || undefined;
      })(active);

      return {
        status: "captured" as const,
        snapshot: {
          hasDocumentFocus: document.hasFocus(),
          targetTagName: active.tagName.toLowerCase(),
          targetId: ((value: string | null | undefined): string | undefined => {
            const trimmed = value?.trim();
            return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
          })(active.id),
          targetType: active instanceof HTMLInputElement
            ? ((value: string | null | undefined): string | undefined => {
                const trimmed = value?.trim();
                return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
              })(active.type)
            : undefined,
          targetName: ((value: string | null | undefined): string | undefined => {
            const trimmed = value?.trim();
            return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
          })(active.getAttribute("name")),
          targetRole: ((value: string | null | undefined): string | undefined => {
            const trimmed = value?.trim();
            return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
          })(active.getAttribute("role")),
          targetLabel: label,
          targetText: ((value: string | null | undefined): string | undefined => {
            const trimmed = value?.trim();
            return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : undefined;
          })(active.textContent),
          targetSelector
        }
      };
    });
  } catch (error) {
    return {
      status: "failed",
      diagnostic: {
        scope: "domFocus",
        level: "error",
        code: "DOM_FOCUS_CAPTURE_FAILED",
        message: "Failed to capture DOM focus.",
        error: getErrorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      }
    };
  }
}
