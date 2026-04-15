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
  | { srAction: ScreenReaderAction };

export type Verdict = "success" | "stuck";

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
  blockers: string[];
  surprise: string | null;
  oneLineFeel: string;
};

export interface Agent {
  decide(ctx: AgentContext, obs: Observation): Promise<Decision>;
  recordStepOutcome?(entry: AgentMemoryEntry): void;
  getMemoryExcerpt?(): AgentMemoryEntry[];
  getPromptLog?(): unknown[];
  summarizeExperience?(input: {
    task: ResolvedTask;
    aggregate: TraceAggregate;
    steps: StepRecord[];
  }): Promise<ExperienceSummary>;
}
