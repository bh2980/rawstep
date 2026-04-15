import type {
  ScreenReaderMaintenanceMethod,
  ScreenReaderReadMethod,
} from "@rawstep/action-catalog";
import type { Decision, Verdict } from "../agent";
import type {
  ScrollHint,
  ScreenReaderReadback,
} from "../observation";
import type { ResolvedTask } from "../task";

export type EndedBy = Verdict | "maxSteps" | "timeout" | "error";

export type ExecutionRecord = {
  ok: boolean;
  error?: string;
  costDelta: number;
  textEntryResult?: {
    expected: string;
    observed: string;
    verified: boolean;
    fieldLabel?: string;
    fieldRole?: string;
    isSensitive?: boolean;
    syntheticAnnouncement?: string;
  };
  readResult?: {
    method: ScreenReaderReadMethod;
    value: string | string[];
  };
  maintenanceResult?: {
    method: ScreenReaderMaintenanceMethod;
    status: "cleared";
  };
};

export type RecordedKeyboardObservation = {
  kind: "keyboard";
  screenshot: {
    path: string;
    viewport: { w: number; h: number };
  };
  browserChrome: {
    title: string;
    urlPath: string;
  };
  focusHint?: string;
  scrollHint?: ScrollHint;
};

export type RecordedScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;
  announcementCapture: "log" | "fallback" | "none" | "synthetic";
  announcementCount?: number;
  observeReason?: "silence" | "timeout" | "fallback" | "synthetic";
  readbacks?: ScreenReaderReadback[];
  screenshot?: {
    path: string;
    viewport: { w: number; h: number };
  };
};

export type RecordedObservation = RecordedKeyboardObservation | RecordedScreenReaderObservation;

export type VerificationRecord = {
  passed: boolean;
  failures: string[];
};

export type VerdictAnalysis = {
  agentVerdict?: Verdict;
  verificationResult: "passed" | "failed" | "not-run";
  finalResult: "success" | "failure" | "continued";
  completionSource: "agent" | "verifier-auto-complete";
};

export type StepRecord = {
  step: number;
  timestamp: string;
  observation: RecordedObservation;
  decision: Decision;
  execution: ExecutionRecord;
  timings: {
    observeMs: number;
    decideMs: number;
    executeMs: number;
    verifyMs: number;
  };
  verification?: VerificationRecord;
  verdictAnalysis?: VerdictAnalysis;
};

export type FailurePoint = {
  stepIndex: number;
  reason: string;
};

export type Result = "success" | "failure";

export type ActionCounts = {
  srInvokeCount: number;
  srReadCount: number;
  srMaintenanceCount: number;
  rawKeyCount: number;
  typeTextCount: number;
};

export type ScreenshotPolicy = "all" | "important" | "failure-only" | "none";

export type TraceAggregate = {
  result: Result;
  totalSteps: number;
  durationMs: number;
  timings: {
    setupMs: number;
    browserLaunchMs: number;
    pageLoadMs: number;
    screenReaderInitMs: number;
    firstAnnouncementWaitMs: number;
    reportMs: number;
  };
  actionCounts: ActionCounts;
  terminatedAtStep: number | null;
  endedBy: EndedBy;
  failurePoint?: FailurePoint;
};

export type TraceSession = {
  task: ResolvedTask;
  startedAt: string;
  endedAt: string;
  steps: StepRecord[];
  aggregate: TraceAggregate;
  experienceSummary?: import("../agent").ExperienceSummary;
  experienceSummaryError?: string;
};
