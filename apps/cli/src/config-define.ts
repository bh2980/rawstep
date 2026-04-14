import type { AgentProvider } from "@rawstep/agent";
import type {
  ScreenshotPolicy
} from "@rawstep/core";
import {
  type KeyboardActionRef,
  type ScreenReaderExtensionCatalogActionRef,
  type ScreenReaderExtensionRawPerformActionRef,
  type ScreenReaderStableActionRef,
  type ScreenReaderBackendId
} from "@rawstep/action-catalog";
import type { MemorySetting } from "./shared";
import { kb } from "./keyboard-actions";
import {
  BackendStableScreenReaderSemantic,
  sr,
  srx
} from "./screenreader-actions";

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
  allowedKeys?: readonly KeyboardActionRef[];
  allowedScreenReaderActions?: never;
  screenReaderBackend?: never;
};

type BackendConfiguredStableScreenReaderAction<TBackend extends ScreenReaderBackendId> = Extract<
  ScreenReaderStableActionRef,
  { semantic: BackendStableScreenReaderSemantic<TBackend> }
>;

type BackendConfiguredUnstableScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  TBackend extends "guidepup-virtual"
    ? ScreenReaderExtensionCatalogActionRef
    : ScreenReaderExtensionCatalogActionRef | ScreenReaderExtensionRawPerformActionRef;

type BackendConfiguredScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  | BackendConfiguredStableScreenReaderAction<TBackend>
  | BackendConfiguredUnstableScreenReaderAction<TBackend>;

type ScreenReaderStrictModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: never;
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
  };
}[ScreenReaderBackendId];

type ScreenReaderHybridModeConfig = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfig & {
    screenReaderBackend: TBackend;
    allowedKeys?: readonly KeyboardActionRef[];
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
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

export function defineConfig<const TConfig extends RawstepConfig>(config: TConfig): RawstepConfig {
  return config;
}

export { kb };
export { sr };
export { srx };
