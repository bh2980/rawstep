import type {
  MemorySetting,
  ScreenReaderObserveConfig,
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
import type { AgentProvider } from "./provider";

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

type KeyboardModeConfigSource = SharedModeConfigSource & {
  allowedKeys?: readonly KeyboardActionRef[];
};

type ScreenReaderModeConfigSource = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfigSource & {
    screenReaderBackend: TBackend;
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
    observe?: ScreenReaderObserveConfig;
  };
}[ScreenReaderBackendId];

type ModeConfigFor<Mode extends UserModel> =
  Mode extends "keyboard"
    ? KeyboardModeConfigSource
    : ScreenReaderModeConfigSource;

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
  [Mode in UserModel]: ModeConfigFor<Mode>;
}[UserModel];

export type ProjectConfigSource = {
  version: 1;
  defaults?: ProjectDefaultsSource;
  modes: Partial<{
    [Mode in UserModel]: ModeConfigFor<Mode>;
  }>;
};

export function defineConfig(config: ProjectConfigSource): ProjectConfigSource {
  return config;
}

export { kb };
export { sr };
export { srx };
