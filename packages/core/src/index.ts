import type { AllowedKey, ScrollHint } from "./constants";

export {
  ALLOWED_KEYS,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VIEWPORT,
  HISTORY_WINDOW,
  SETTLE_MS,
  SCROLL_HINTS,
  createEmptyKeyCounts,
  isAllowedKey,
  isScrollHint
} from "./constants";
export type { AllowedKey, ScrollHint } from "./constants";

export type UserModel = "keyboard" | "screenreader";

export type Task = {
  id: string;
  url: string;
  goal: string;
  mode: UserModel;
  maxSteps: number;
  timeoutMs: number;
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

export type Action = { key: AllowedKey };
export type Verdict = "success" | "stuck";
export type EndedBy = Verdict | "maxSteps" | "timeout" | "error";

export type Decision =
  | { action: Action; rationale: string }
  | { verdict: Verdict; rationale: string };

export type AgentHistoryEntry = {
  stepIndex: number;
  action?: Action;
  rationale: string;
};

export type AgentContext = {
  goal: string;
  allowedKeys: readonly AllowedKey[];
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
};

export type RecordedObservation = RecordedKeyboardObservation | RecordedScreenReaderObservation;

export type StepRecord = {
  step: number;
  timestamp: string;
  observation: RecordedObservation;
  decision: Decision;
  execution: ExecutionRecord;
};

export type FailurePoint = {
  stepIndex: number;
  reason: string;
};

export type TraceAggregate = {
  totalSteps: number;
  totalKeystrokes: number;
  keyCounts: Record<AllowedKey, number>;
  reachedGoal: boolean;
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
