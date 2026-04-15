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

type ModeSpecMap = typeof import("@rawstep/definition").MODE_SPEC;
type ModeAllowsRawKeys<Mode extends UserModel> = ModeSpecMap[Mode]["allowsRawKeys"];
type ModeRequiresScreenReaderBackend<Mode extends UserModel> =
  ModeSpecMap[Mode]["requiresScreenReaderBackend"];

type ModeAllowedKeysField<AllowsRawKeys extends boolean> = AllowsRawKeys extends true
  ? { allowedKeys?: readonly KeyboardActionRef[] }
  : { allowedKeys?: never };

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

type ModeWithoutScreenReaderBackendConfig<AllowsRawKeys extends boolean> =
  SharedModeConfigSource
  & ModeAllowedKeysField<AllowsRawKeys>
  & {
    allowedScreenReaderActions?: never;
    screenReaderBackend?: never;
    observe?: never;
  };

type ModeWithScreenReaderBackendConfig<AllowsRawKeys extends boolean> = {
  [TBackend in ScreenReaderBackendId]: SharedModeConfigSource & {
    screenReaderBackend: TBackend;
    allowedKeys?: ModeAllowedKeysField<AllowsRawKeys>["allowedKeys"];
    allowedScreenReaderActions?: readonly BackendConfiguredScreenReaderAction<TBackend>[];
    observe?: ScreenReaderObserveConfig;
  };
}[ScreenReaderBackendId];

type ModeConfigFor<Mode extends UserModel> =
  ModeRequiresScreenReaderBackend<Mode> extends true
    ? ModeWithScreenReaderBackendConfig<ModeAllowsRawKeys<Mode>>
    : ModeWithoutScreenReaderBackendConfig<ModeAllowsRawKeys<Mode>>;

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

export function defineConfig<const TConfig extends ProjectConfigSource>(config: TConfig): ProjectConfigSource {
  return config;
}

export { kb };
export { sr };
export { srx };
