import { SCREEN_READER_SEMANTICS } from "@rawstep/action-catalog";
import type {
  AllowedKey,
  ScreenReaderActionKind,
  ScreenReaderInvokeMethod,
  ScreenReaderReadMethod,
  ScreenReaderMaintenanceMethod,
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

export type CommandOptions = {
  capture?: boolean | "initial";
  retries?: number;
  timeout?: number;
};

export type KeyboardOptions = CommandOptions & {
  application?: string;
};

export type ClickOptions = CommandOptions & {
  button?: "left" | "right";
  clickCount?: 1 | 2 | 3;
};

export type ScreenReaderPerformCommand = {
  id: string;
  label: string;
  description: string;
  argsHint?: string;
};

export type ScreenReaderCapabilities = {
  invoke: {
    next: boolean;
    previous: boolean;
    act: boolean;
    interact: boolean;
    stopInteracting: boolean;
    press: boolean;
    type: boolean;
    click: boolean;
    perform: boolean;
    supportsRawPerform: boolean;
  };
  read: {
    itemText: boolean;
    itemTextLog: boolean;
    lastSpokenPhrase: boolean;
    spokenPhraseLog: boolean;
  };
  maintenance: {
    clearItemTextLog: boolean;
    clearSpokenPhraseLog: boolean;
  };
  performCatalog: readonly ScreenReaderPerformCommand[];
};

export type ScreenReaderAction =
  | {
      kind: "invoke";
      method: "next" | "previous" | "act" | "interact" | "stopInteracting";
      options?: CommandOptions;
    }
  | {
      kind: "invoke";
      method: "press";
      key: string;
      options?: KeyboardOptions;
    }
  | {
      kind: "invoke";
      method: "type";
      text: string;
      options?: KeyboardOptions;
    }
  | {
      kind: "invoke";
      method: "click";
      options?: ClickOptions;
    }
  | {
      kind: "invoke";
      method: "perform";
      command:
        | { source: "catalog"; id: string; args?: Record<string, unknown> }
        | { source: "raw"; payload: Record<string, unknown> };
      options?: CommandOptions;
    }
  | { kind: "read"; method: ScreenReaderReadMethod }
  | { kind: "maintenance"; method: ScreenReaderMaintenanceMethod };

export type ScreenReaderSemanticAction = (typeof SCREEN_READER_SEMANTICS)[number];

export type PromptObjectSchema<TOutput extends Record<string, unknown> = Record<string, unknown>> = {
  safeParse(value: unknown):
    | { success: true; data: TOutput }
    | { success: false; error?: unknown };
};

type ConfiguredKeyboardActionShape = {
  key: AllowedKey;
  hint?: string;
};

declare const configuredKeyboardActionBrand: unique symbol;

export type ConfiguredKeyboardAction = ConfiguredKeyboardActionShape & {
  readonly [configuredKeyboardActionBrand]: true;
};

export type ResolvedPromptKeyboardAction = {
  key: AllowedKey;
  hint?: string;
};

type ConfiguredScreenReaderActionShape = {
  [Semantic in ScreenReaderSemanticAction]: {
    semantic: Semantic;
    hint?: string;
  };
}[ScreenReaderSemanticAction];

type ConfiguredUnstableScreenReaderActionShape =
  | {
      unstable: "catalog";
      id: string;
      hint: string;
      argsSchema: PromptObjectSchema<Record<string, unknown>>;
      argsExample: Record<string, unknown>;
    }
  | {
      unstable: "rawPerform";
      hint: string;
      payloadSchema: PromptObjectSchema<Record<string, unknown>>;
      payloadExample: Record<string, unknown>;
    };

declare const configuredScreenReaderActionBrand: unique symbol;

export type ConfiguredStableScreenReaderAction = ConfiguredScreenReaderActionShape & {
  readonly [configuredScreenReaderActionBrand]: true;
};

declare const configuredUnstableScreenReaderActionBrand: unique symbol;

export type ConfiguredUnstableScreenReaderAction = ConfiguredUnstableScreenReaderActionShape & {
  readonly [configuredUnstableScreenReaderActionBrand]: true;
};

export type ConfiguredScreenReaderAction =
  | ConfiguredStableScreenReaderAction
  | ConfiguredUnstableScreenReaderAction;

export type ResolvedPromptScreenReaderAction =
  | {
      semantic: ScreenReaderSemanticAction;
      hint?: string;
      runtimeAction: AllowedScreenReaderAction;
    }
  | {
      unstable: "catalog";
      id: string;
      hint: string;
      argsSchema: PromptObjectSchema<Record<string, unknown>>;
      argsExample: Record<string, unknown>;
      runtimeAction: Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }>;
    }
  | {
      unstable: "rawPerform";
      hint: string;
      payloadSchema: PromptObjectSchema<Record<string, unknown>>;
      payloadExample: Record<string, unknown>;
      runtimeAction: Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "raw" }>;
    };

export type AllowedScreenReaderAction =
  | {
      kind: "invoke";
      method: "next" | "previous" | "act" | "interact" | "stopInteracting" | "press" | "type" | "click";
    }
  | {
      kind: "invoke";
      method: "perform";
      source: "catalog";
      id: string;
    }
  | {
      kind: "invoke";
      method: "perform";
      source: "raw";
    }
  | { kind: "read"; method: ScreenReaderReadMethod }
  | { kind: "maintenance"; method: ScreenReaderMaintenanceMethod };

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
  allowedKeys: readonly AllowedKey[];
  allowedScreenReaderActions?: readonly AllowedScreenReaderAction[];
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

export function buildAllowedScreenReaderActions(
  capabilities: ScreenReaderCapabilities
): AllowedScreenReaderAction[] {
  return [
    ...(capabilities.invoke.next ? [{ kind: "invoke" as const, method: "next" as const }] : []),
    ...(capabilities.invoke.previous ? [{ kind: "invoke" as const, method: "previous" as const }] : []),
    ...(capabilities.invoke.act ? [{ kind: "invoke" as const, method: "act" as const }] : []),
    ...(capabilities.invoke.interact ? [{ kind: "invoke" as const, method: "interact" as const }] : []),
    ...(capabilities.invoke.stopInteracting
      ? [{ kind: "invoke" as const, method: "stopInteracting" as const }]
      : []),
    ...(capabilities.invoke.perform
      ? capabilities.performCatalog.map((command) => ({
          kind: "invoke" as const,
          method: "perform" as const,
          source: "catalog" as const,
          id: command.id
        }))
      : []),
    ...(capabilities.invoke.supportsRawPerform
      ? [{ kind: "invoke" as const, method: "perform" as const, source: "raw" as const }]
      : []),
    ...(capabilities.invoke.press ? [{ kind: "invoke" as const, method: "press" as const }] : []),
    ...(capabilities.invoke.type ? [{ kind: "invoke" as const, method: "type" as const }] : []),
    ...(capabilities.invoke.click ? [{ kind: "invoke" as const, method: "click" as const }] : []),
    ...(capabilities.read.itemText ? [{ kind: "read" as const, method: "itemText" as const }] : []),
    ...(capabilities.read.itemTextLog ? [{ kind: "read" as const, method: "itemTextLog" as const }] : []),
    ...(capabilities.read.lastSpokenPhrase
      ? [{ kind: "read" as const, method: "lastSpokenPhrase" as const }]
      : []),
    ...(capabilities.read.spokenPhraseLog
      ? [{ kind: "read" as const, method: "spokenPhraseLog" as const }]
      : []),
    ...(capabilities.maintenance.clearItemTextLog
      ? [{ kind: "maintenance" as const, method: "clearItemTextLog" as const }]
      : []),
    ...(capabilities.maintenance.clearSpokenPhraseLog
      ? [{ kind: "maintenance" as const, method: "clearSpokenPhraseLog" as const }]
      : [])
  ];
}

export function formatDecisionAction(action: Action): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("typeText" in action) {
    return `typeText(${action.typeText})`;
  }

  const sr = action.srAction;

  if (sr.kind === "read") {
    return `srAction.read(${sr.method})`;
  }

  if (sr.kind === "maintenance") {
    return `srAction.maintenance(${sr.method})`;
  }

  switch (sr.method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return `srAction.invoke(${sr.method})`;
    case "perform":
      return sr.command.source === "catalog"
        ? `srAction.perform(${sr.command.id})`
        : "srAction.perform(raw)";
    case "press":
      return `srAction.press(${sr.key})`;
    case "type":
      return `srAction.type(${sr.text})`;
    case "click":
      return `srAction.click(${sr.options?.button ?? "left"},${sr.options?.clickCount ?? 1})`;
  }
}

export function supportsScreenReaderAction(
  capabilities: ScreenReaderCapabilities,
  action: AllowedScreenReaderAction | ScreenReaderAction
): boolean {
  if (action.kind === "read") {
    return capabilities.read[action.method];
  }

  if (action.kind === "maintenance") {
    return capabilities.maintenance[action.method];
  }

  if (action.method === "perform") {
    if (!capabilities.invoke.perform) {
      return false;
    }

    const source = "command" in action ? action.command.source : action.source;
    if (source === "raw") {
      return capabilities.invoke.supportsRawPerform;
    }

    const id = "command" in action
      ? action.command.source === "catalog"
        ? action.command.id
        : undefined
      : action.source === "catalog"
        ? action.id
        : undefined;
    if (!id) {
      return false;
    }

    return capabilities.performCatalog.some((command) => command.id === id);
  }

  return capabilities.invoke[action.method];
}
