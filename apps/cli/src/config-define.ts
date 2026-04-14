import type { AgentProvider } from "@rawstep/agent";
import type { ConfiguredKeyboardAction, ConfiguredScreenReaderAction, ScreenshotPolicy } from "@rawstep/core";
import type { ScreenReaderBackendId } from "@rawstep/observer-screenreader";
import type { MemorySetting } from "./shared";
import { kb } from "./keyboard-actions";
import { sr } from "./screenreader-actions";

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
  prompt?: PromptOverrideConfig;
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

type PromptOverrideConfig = {
  extraInstructions?: string;
};

type ProjectPromptConfig = PromptOverrideConfig & {
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
