import type { AgentProvider } from "@rawstep/agent";
import type {
  MemorySetting,
  ScreenReaderBackendId,
  ScreenReaderBackendsSupportingRawPerform,
  ScreenshotPolicy,
  UserModel
} from "@rawstep/definition";
import type {
  KeyboardActionRef,
  ScreenReaderExtensionCatalogActionRef,
  ScreenReaderExtensionRawPerformActionRef,
  ScreenReaderSemanticAction,
  ScreenReaderStableActionRef
} from "@rawstep/action-catalog";
import { kb } from "../keyboard-actions";
import {
  type BackendStableScreenReaderSemantic,
  sr,
  srx
} from "../screenreader-actions";

type SharedModeConfigSource = {
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

type KeyboardModeConfigSource = SharedModeConfigSource & {
  allowedKeys?: readonly KeyboardActionRef[];
  allowedScreenReaderActions?: never;
  screenReaderBackend?: never;
};

type StableScreenReaderActionRefFor<TSemantic extends ScreenReaderSemanticAction> =
  ScreenReaderStableActionRef & { semantic: TSemantic };

type BackendConfiguredStableScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  StableScreenReaderActionRefFor<BackendStableScreenReaderSemantic<TBackend>>;

type BackendConfiguredUnstableScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  TBackend extends ScreenReaderBackendsSupportingRawPerform
    ? ScreenReaderExtensionCatalogActionRef | ScreenReaderExtensionRawPerformActionRef
    : ScreenReaderExtensionCatalogActionRef;

type BackendConfiguredScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  | BackendConfiguredStableScreenReaderAction<TBackend>
  | BackendConfiguredUnstableScreenReaderAction<TBackend>;

type ScreenReaderStrictModeConfigSource = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfigSource & {
    screenReaderBackend: TBackend;
    allowedKeys?: never;
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
  };
}[ScreenReaderBackendId];

type ScreenReaderHybridModeConfigSource = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfigSource & {
    screenReaderBackend: TBackend;
    allowedKeys?: readonly KeyboardActionRef[];
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
  };
}[ScreenReaderBackendId];

export type ProjectPromptSource = {
  dir?: string;
};

export type ProjectDefaultsSource = {
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  prompt?: ProjectPromptSource;
};

export type ModeConfigSource = {
  [Mode in UserModel]:
    Mode extends "keyboard"
      ? KeyboardModeConfigSource
      : Mode extends "screenreader-strict"
        ? ScreenReaderStrictModeConfigSource
        : ScreenReaderHybridModeConfigSource;
}[UserModel];

export type ProjectConfigSource = {
  version: 1;
  defaults?: ProjectDefaultsSource;
  modes: Partial<{
    [Mode in UserModel]:
      Mode extends "keyboard"
        ? KeyboardModeConfigSource
        : Mode extends "screenreader-strict"
          ? ScreenReaderStrictModeConfigSource
          : ScreenReaderHybridModeConfigSource;
  }>;
};

export function defineConfig<const TConfig extends ProjectConfigSource>(config: TConfig): TConfig {
  return config;
}

export { kb };
export { sr };
export { srx };
