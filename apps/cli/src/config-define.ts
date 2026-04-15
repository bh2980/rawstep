import type { AgentProvider } from "@rawstep/agent";
import type {
  MemorySetting,
  ScreenReaderBackendId,
  ScreenReaderBackendsSupportingRawPerform,
  ScreenshotPolicy,
  UserModel
} from "@rawstep/definition";
import {
  type KeyboardActionRef,
  type ScreenReaderExtensionCatalogActionRef,
  type ScreenReaderExtensionRawPerformActionRef,
  type ScreenReaderSemanticAction,
  type ScreenReaderStableActionRef
} from "@rawstep/action-catalog";
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
  modes: Partial<{
    [Mode in UserModel]:
      Mode extends "keyboard"
        ? KeyboardModeConfig
        : Mode extends "screenreader-strict"
          ? ScreenReaderStrictModeConfig
          : ScreenReaderHybridModeConfig;
  }>;
};

export function screenReaderActionsFor<const TBackend extends ScreenReaderBackendId>(
  _backend: TBackend,
  actions: readonly BackendConfiguredScreenReaderAction<TBackend>[]
): readonly BackendConfiguredScreenReaderAction<TBackend>[] {
  return actions;
}

export function defineConfig<const TConfig extends RawstepConfig>(config: TConfig): RawstepConfig {
  return config;
}

export { kb };
export { sr };
export { srx };
