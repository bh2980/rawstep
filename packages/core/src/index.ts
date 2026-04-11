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
  verify?: VerifySpec;
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
  | { action: Action; rationale: string }
  | { verdict: Verdict; rationale: string };

export type AgentHistoryEntry = {
  stepIndex: number;
  source: "agent" | "verifier";
  action?: Action;
  rationale: string;
};

export type AgentContext = {
  goal: string;
  allowedKeys: readonly AllowedKey[];
  allowedScreenReaderCommands?: readonly ScreenReaderCommand[];
  history: AgentHistoryEntry[];
};

export interface Agent {
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
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
};

export type VerificationRecord = {
  passed: boolean;
  failures: string[];
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

export type TraceAggregate = {
  result: Result;
  totalSteps: number;
  durationMs: number;
  timings: {
    setupMs: number;
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
};
