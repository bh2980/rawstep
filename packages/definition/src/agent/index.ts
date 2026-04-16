import type {
  KeyboardActionDescriptor,
  KeyboardSupportedKey,
  PromptObjectSchema,
  ScreenReaderActionDescriptor,
  ScreenReaderActionPlan,
  ScreenReaderActionRef,
  ScreenReaderCapabilities,
  ScreenReaderClickOptions,
  ScreenReaderCommandOptions,
  ScreenReaderIntent,
  ScreenReaderKeyboardOptions,
  ScreenReaderPerformCommand,
  ScreenReaderSemanticAction,
} from "@rawstep/action-catalog";
import type { Observation } from "../observation";
import type { ResolvedTask } from "../task";
import type { StepRecord, TraceAggregate } from "../trace";

export type AllowedKey = KeyboardSupportedKey;
export type CommandOptions = ScreenReaderCommandOptions;
export type KeyboardOptions = ScreenReaderKeyboardOptions;
export type ClickOptions = ScreenReaderClickOptions;
export type ScreenReaderAction = ScreenReaderIntent;
export type { PromptObjectSchema, ScreenReaderPerformCommand, ScreenReaderCapabilities, ScreenReaderSemanticAction };
export type { ScreenReaderActionRef, ScreenReaderActionDescriptor, ScreenReaderActionPlan };

export type Action =
  | { key: AllowedKey }
  | { typeText: string }
  | { replaceText: string }
  | { srAction: ScreenReaderAction };

export type Verdict = "success" | "stuck";

export type Decision =
  | { action: Action; rationale?: string }
  | { verdict: Verdict; rationale?: string };

export type AgentMemoryEntry = {
  step: number;
  action: string;
  outcome: "continued" | "success" | "failure";
  announcementExcerpt?: string;
  announcementCapture?: Extract<Observation, { kind: "screenreader" }>["announcementCapture"];
  announcementCount?: Extract<Observation, { kind: "screenreader" }>["announcementCount"];
  observeReason?: Extract<Observation, { kind: "screenreader" }>["observeReason"];
  sameAnnouncementCount?: number;
  sameActionCount?: number;
  note?: string;
};

export type PlanState = {
  steps: string[];
  currentFocus: string;
  successSignals: string[];
};

export type ReflectionState = {
  status: "progressing" | "flat" | "drifting";
  assessment: string;
  strategyNote: string;
  updatedFocus?: string;
};

export type AgentContext = {
  goal: string;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
  memory: AgentMemoryEntry[];
  plan?: PlanState;
  currentFocus?: string;
  strategyNote?: string;
  lastReflection?: ReflectionState;
};

export type ExperienceSummary = {
  overall: string;
  blockers: string[];
  surprise: string | null;
  oneLineFeel: string;
};

export interface Agent {
  planTask?(ctx: AgentContext, obs: Observation): Promise<PlanState>;
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
  reflectProgress?(input: {
    ctx: AgentContext;
    steps: StepRecord[];
  }): Promise<ReflectionState>;
  recordStepOutcome?(entry: AgentMemoryEntry): void;
  getMemoryExcerpt?(): AgentMemoryEntry[];
  getPromptLog?(): unknown[];
  summarizeExperience?(input: {
    task: ResolvedTask;
    aggregate: TraceAggregate;
    steps: StepRecord[];
  }): Promise<ExperienceSummary>;
  flushPromptLog?(): Promise<void>;
}
