import type { AgentProvider } from "@a11y-task/agent";
import type { AllowedKey, ScreenshotPolicy, ScreenReaderCommand } from "@a11y-task/core";
import type { ScreenReaderBackendId } from "@a11y-task/observer-screenreader";
import type { MemorySetting } from "./shared";

type VirtualScreenReaderCommand = Exclude<
  ScreenReaderCommand,
  "nextFormControl" | "previousFormControl"
>;

type ScreenReaderCommandForBackend<TBackend extends ScreenReaderBackendId> =
  TBackend extends "guidepup-virtual"
    ? VirtualScreenReaderCommand
    : ScreenReaderCommand;

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
  allowedKeys?: readonly AllowedKey[];
  allowedScreenReaderCommands?: never;
  screenReaderBackend?: never;
};

type ScreenReaderStrictModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: never;
    allowedScreenReaderCommands?: readonly ScreenReaderCommandForBackend<TBackend>[];
  };
}[ScreenReaderBackendId];

type ScreenReaderHybridModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: readonly AllowedKey[];
    allowedScreenReaderCommands?: readonly ScreenReaderCommandForBackend<TBackend>[];
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
  keyHints?: Partial<Record<AllowedKey, string>>;
  screenReaderCommandHints?: Partial<Record<ScreenReaderCommand, string>>;
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
