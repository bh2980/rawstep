import type { AllowedKey, ScreenReaderCommand, ScrollHint } from "./constants";

export {
  ALLOWED_KEYS,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VIEWPORT,
  HISTORY_WINDOW,
  SCREENREADER_COMMANDS,
  SETTLE_MS,
  SCROLL_HINTS,
  createEmptyKeyCounts,
  isAllowedKey,
  isScreenReaderCommand,
  isScrollHint
} from "./constants";
export type { AllowedKey, ScreenReaderCommand, ScrollHint } from "./constants";

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

export type TaskInput = {
  text: string;
};

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
  scrollHint?: ScrollHint;
};

export type ScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;
  announcementCapture: "log" | "fallback" | "none"; // 발화를 무엇으로 잡았는지
  announcementCount?: number; // 고유 발화 수가 아니라 이번 step에서 캡처된 phrase line 수
  observeReason?: "silence" | "timeout" | "fallback"; // 관측을 왜 여기서 닫았는지
  previousAnnouncement?: string;
};

export type Observation = KeyboardObservation | ScreenReaderObservation;

export type Action =
  | { key: AllowedKey }
  | { typeText: "task" }
  | { srCommand: ScreenReaderCommand };
export type Verdict = "success" | "stuck";
export type EndedBy = Verdict | "maxSteps" | "timeout" | "error";

export type Decision =
  | { action: Action; rationale?: string }
  | { verdict: Verdict; rationale?: string };

export type AgentMemoryEntry = {
  step: number;
  action: string;
  outcome: "continued" | "success" | "failure";
};

export type AgentContext = {
  goal: string;
  allowedKeys: readonly AllowedKey[];
  allowedScreenReaderCommands?: readonly ScreenReaderCommand[];
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
  }): Promise<ExperienceSummary>;
}

export type ExecutionRecord = {
  ok: boolean;
  error?: string;
  costDelta: number;
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
  scrollHint?: ScrollHint;
};

export type RecordedScreenReaderObservation = {
  kind: "screenreader";
  announcement: string;
  announcementCapture: "log" | "fallback" | "none";
  announcementCount?: number;
  observeReason?: "silence" | "timeout" | "fallback";
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
  srCommandCount: number;
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
    voiceOverInitMs: number;
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
