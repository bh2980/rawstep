import type {
  KeyboardSupportedKey,
  ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import type { ScreenReaderBackendId } from "../backends";
import type { UserModel } from "../modes";
import type { ScreenshotPolicy } from "../trace";
import type { VerifySpec } from "../verify";

export type MemorySetting = number | "all";
export const REASONING_EFFORT_VALUES = ["none", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = typeof REASONING_EFFORT_VALUES[number];
export const NAVIGATION_STRATEGY_VALUES = ["same-origin", "start-url-prefix", "allow-url-list"] as const;
export type NavigationStrategy = typeof NAVIGATION_STRATEGY_VALUES[number];
export type TaskInput = Record<string, string>;
export type ScreenReaderObserveConfig = {
  pollIntervalMs?: number;
  silenceWindowMs?: number;
  maxObserveMs?: number;
  allowFallback?: boolean;
};

export type VoiceOverConfig = {
  cursorScreenshot?: boolean;
};

export type PlanningConfig = {
  enabled?: boolean;
  reflectionCadence?: number;
  initialDelaySteps?: number;
  firstReflectionDelaySteps?: number;
};

export type NavigationPolicy =
  | {
      strategy?: "same-origin";
    }
  | {
      strategy: "start-url-prefix";
    }
  | {
      strategy: "allow-url-list";
      allowUrlList: string[];
    };

export type ResolvedNavigationPolicy =
  | {
      strategy: "same-origin";
    }
  | {
      strategy: "start-url-prefix";
    }
  | {
      strategy: "allow-url-list";
      allowUrlList: string[];
    };

export type TaskPrompt = {
  system?: string;
  user?: string;
};

export type TaskOverrideSource = {
  mode?: UserModel;
  outDir?: string;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  maxVerificationRetries?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  reasoningEffort?: ReasoningEffort;
  memory?: MemorySetting;
  allowedKeys?: KeyboardSupportedKey[];
  allowedScreenReaderActions?: ScreenReaderActionRef[];
  screenReaderBackend?: ScreenReaderBackendId;
  observe?: ScreenReaderObserveConfig;
  voiceOver?: VoiceOverConfig;
  planning?: PlanningConfig;
  navigation?: NavigationPolicy;
};

export type TaskSource = {
  id?: string;
  url: string;
  goal: string;
  prompt?: TaskPrompt;
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
  verify: VerifySpec;
  input?: TaskInput;
  config?: TaskOverrideSource;
};
