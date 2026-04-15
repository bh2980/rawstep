import type {
  KeyboardSupportedKey,
  ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import type { ScreenReaderBackendId } from "../backends";
import type { UserModel } from "../modes";
import type { ScreenshotPolicy } from "../trace";
import type { VerifySpec } from "../verify";

export type MemorySetting = number | "all";
export type TaskInput = Record<string, string>;
export type ScreenReaderObserveConfig = {
  pollIntervalMs?: number;
  silenceWindowMs?: number;
  maxObserveMs?: number;
  allowFallback?: boolean;
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
  memory?: MemorySetting;
  allowedKeys?: KeyboardSupportedKey[];
  allowedScreenReaderActions?: ScreenReaderActionRef[];
  screenReaderBackend?: ScreenReaderBackendId;
  observe?: ScreenReaderObserveConfig;
};

export type TaskSource = {
  id?: string;
  url: string;
  goal: string;
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
  verify: VerifySpec;
  input?: TaskInput;
  config?: TaskOverrideSource;
};
