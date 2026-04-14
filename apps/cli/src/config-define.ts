import type { AgentProvider } from "@rawstep/agent";
import type { ConfiguredKeyboardAction, ConfiguredScreenReaderAction, ScreenshotPolicy } from "@rawstep/core";
import type { ScreenReaderBackendId } from "@rawstep/runtime";
import type { MemorySetting } from "./shared";
import { kb } from "./keyboard-actions";
import { sr, srUnstable } from "./screenreader-actions";

type SharedModeConfig = {
  outDir: string;
  headless?: boolean;
  maxSteps: number;
  timeoutMs: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory: MemorySetting;
};

type KeyboardModeConfig = SharedModeConfig & {
  allowedKeys?: readonly ConfiguredKeyboardAction[];
  allowedScreenReaderActions?: never;
  screenReaderBackend?: never;
};

type ScreenReaderStrictModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: never;
    allowedScreenReaderActions?: readonly ConfiguredScreenReaderAction[];
  };
}[ScreenReaderBackendId];

type ScreenReaderHybridModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: readonly ConfiguredKeyboardAction[];
    allowedScreenReaderActions?: readonly ConfiguredScreenReaderAction[];
  };
}[ScreenReaderBackendId];

type ProjectDefaultsConfig = {
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  prompt?: ProjectPromptConfig;
};
type ProjectPromptConfig = {
  dir?: string;
};

export type RawstepConfig = {
  version: 1;
  defaults?: ProjectDefaultsConfig;
  modes: {
    keyboard?: KeyboardModeConfig;
    "screenreader-strict"?: ScreenReaderStrictModeConfig;
    "screenreader-hybrid"?: ScreenReaderHybridModeConfig;
  };
};

export function defineConfig<const TConfig extends RawstepConfig>(config: TConfig): TConfig {
  return config;
}

export { kb };
export { sr };
export { srUnstable };
