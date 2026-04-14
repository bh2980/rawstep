import {
  type KeyboardActionDescriptor,
  formatScreenReaderIntent,
  type PromptObjectSchema,
  type ScreenReaderActionDescriptor,
  type ScreenReaderActionPlan,
  type ScreenReaderActionRef,
  type ScreenReaderCapabilities,
  type ScreenReaderClickOptions,
  type ScreenReaderCommandOptions,
  type ScreenReaderIntent,
  type ScreenReaderKeyboardOptions,
  type ScreenReaderMaintenanceMethod,
  type ScreenReaderPerformCommand,
  type ScreenReaderReadMethod,
  type ScreenReaderSemanticAction
} from "@rawstep/action-catalog";
import type {
  AllowedKey,
  ScreenReaderActionKind,
  ScreenReaderInvokeMethod,
  ScrollHint
} from "./constants";

export {
  ALLOWED_KEYS,
  DEFAULT_ALLOWED_KEYS,
  DEFAULT_VIEWPORT,
  SCREEN_READER_ACTION_KINDS,
  SCREEN_READER_INVOKE_METHODS,
  SCREEN_READER_READ_METHODS,
  SCREEN_READER_MAINTENANCE_METHODS,
  SETTLE_MS,
  SCROLL_HINTS,
  SUPPORTED_KEYS,
  SUPPORTED_KEY_LABELS,
  createEmptyKeyCounts,
  isAllowedKey,
  isScreenReaderInvokeMethod,
  isScreenReaderReadMethod,
  isScreenReaderMaintenanceMethod,
  isScreenReaderActionKind,
  isScrollHint
} from "./constants";
export type {
  AllowedKey,
  ScreenReaderActionKind,
  ScreenReaderInvokeMethod,
  ScreenReaderReadMethod,
  ScreenReaderMaintenanceMethod,
  ScrollHint
} from "./constants";

export type UserModel = "keyboard" | "screenreader-strict" | "screenreader-hybrid";

export type RequestVerificationRule = {
  requestSeen: {
    urlIncludes: string;
    method?: string;
  };
};

export type ResponseVerificationRule = {
  responseSeen: {
    urlIncludes: string;
    method?: string;
    status?: number;
  };
};

export type VerifyRule =
  | { titleIncludes: string }
  | { urlIncludes: string }
  | { textVisible: string }
  | RequestVerificationRule
  | ResponseVerificationRule;

export type VerifySpec = {
  all: VerifyRule[];
};

export type TaskInput = Record<string, string>;

export type Task = {
  id: string;
  url: string;
  goal: string;
  mode: UserModel;
  maxSteps: number;
  timeoutMs: number;
  verify: VerifySpec;
  input?: TaskInput;
};

export type KeyboardObservation = {
  kind: "keyboard";
  screenshot: {
    pngBase64: string;
    viewport: { w: number; h: number };
  };
  previousScreenshot?: { pngBase64: string };
  browserChrome: {
    title: string;
    urlPath: string;
  };
  focusHint?: string;
  scrollHint?: ScrollHint;
};

export type ScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;
  announcementCapture: "log" | "fallback" | "none"; // 발화를 무엇으로 잡았는지
  announcementCount?: number; // 고유 발화 수가 아니라 이번 step에서 캡처된 phrase line 수
  observeReason?: "silence" | "timeout" | "fallback"; // 관측을 왜 여기서 닫았는지
  previousAnnouncement?: string;
  readbacks?: ScreenReaderReadback[];
};

export type Observation = KeyboardObservation | ScreenReaderObservation;

export type CommandOptions = ScreenReaderCommandOptions;
export type KeyboardOptions = ScreenReaderKeyboardOptions;
export type ClickOptions = ScreenReaderClickOptions;
export type ScreenReaderAction = ScreenReaderIntent;
export type { PromptObjectSchema, ScreenReaderPerformCommand, ScreenReaderCapabilities, ScreenReaderSemanticAction };
export type { ScreenReaderActionRef, ScreenReaderActionDescriptor, ScreenReaderActionPlan };

export type Action =
  | { key: AllowedKey }
  | { typeText: string }
  | { srAction: ScreenReaderAction };
export type Verdict = "success" | "stuck";
export type EndedBy = Verdict | "maxSteps" | "timeout" | "error";

export type Decision =
  | { action: Action; rationale?: string }
  | { verdict: Verdict; rationale?: string };

export type AgentMemoryEntry = {
  step: number;
  action: string;
  outcome: "continued" | "success" | "failure";
  note?: string;
};

export type AgentContext = {
  goal: string;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
  memory: AgentMemoryEntry[];
};

export type ExperienceSummary = {
  overall: string;
  biggestFriction: string;
  nextChecks: string[];
};

export interface Agent {
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
  recordStepOutcome?(entry: AgentMemoryEntry): void;
  getMemoryExcerpt?(): AgentMemoryEntry[];
  getPromptLog?(): unknown[];
  summarizeExperience?(input: {
    task: Task;
    aggregate: TraceAggregate;
    steps: StepRecord[];
  }): Promise<ExperienceSummary>;
}

export type ExecutionRecord = {
  ok: boolean;
  error?: string;
  costDelta: number;
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
  announcementCapture: "log" | "fallback" | "none";
  announcementCount?: number;
  observeReason?: "silence" | "timeout" | "fallback";
  readbacks?: ScreenReaderReadback[];
  screenshot?: {
    path: string;
    viewport: { w: number; h: number };
  };
};

export type RecordedObservation = RecordedKeyboardObservation | RecordedScreenReaderObservation;

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
  task: Task;
  startedAt: string;
  endedAt: string;
  steps: StepRecord[];
  aggregate: TraceAggregate;
  experienceSummary?: ExperienceSummary;
};

export type ScreenReaderReadback = {
  method: ScreenReaderReadMethod | ScreenReaderMaintenanceMethod;
  value?: string | string[];
  status?: "cleared";
};

export function formatDecisionAction(action: Action): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("typeText" in action) {
    return `typeText(${action.typeText})`;
  }

  return formatScreenReaderIntent(action.srAction);
}
