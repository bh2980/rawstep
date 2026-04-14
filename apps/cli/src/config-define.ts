import type { AgentProvider } from "@rawstep/agent";
import type {
  ConfiguredKeyboardAction,
  ConfiguredStableScreenReaderAction,
  ConfiguredUnstableScreenReaderAction,
  ScreenReaderSemanticAction,
  ScreenshotPolicy
} from "@rawstep/core";
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

type SharedStableScreenReaderSemantic =
  | "next"
  | "previous"
  | "act"
  | "interact"
  | "stopInteracting"
  | "press"
  | "type"
  | "click"
  | "heading.next"
  | "heading.previous"
  | "form.next"
  | "form.previous"
  | "read.itemText"
  | "read.itemTextLog"
  | "read.lastSpokenPhrase"
  | "read.spokenPhraseLog"
  | "clear.itemTextLog"
  | "clear.spokenPhraseLog";

type VoiceOverStableScreenReaderSemantic = SharedStableScreenReaderSemantic
  | "button.next"
  | "button.previous"
  | "landmark.next"
  | "landmark.previous";

type NvdaStableScreenReaderSemantic = VoiceOverStableScreenReaderSemantic
  | "link.next"
  | "link.previous"
  | "list.next"
  | "list.previous"
  | "table.next"
  | "table.previous"
  | "heading.level.1.next"
  | "heading.level.1.previous"
  | "heading.level.2.next"
  | "heading.level.2.previous"
  | "heading.level.3.next"
  | "heading.level.3.previous"
  | "heading.level.4.next"
  | "heading.level.4.previous"
  | "heading.level.5.next"
  | "heading.level.5.previous"
  | "heading.level.6.next"
  | "heading.level.6.previous";

type VirtualStableScreenReaderSemantic = SharedStableScreenReaderSemantic
  | "link.next"
  | "link.previous"
  | "landmark.next"
  | "landmark.previous"
  | "heading.level.1.next"
  | "heading.level.1.previous"
  | "heading.level.2.next"
  | "heading.level.2.previous"
  | "heading.level.3.next"
  | "heading.level.3.previous"
  | "heading.level.4.next"
  | "heading.level.4.previous"
  | "heading.level.5.next"
  | "heading.level.5.previous"
  | "heading.level.6.next"
  | "heading.level.6.previous";

type BackendStableScreenReaderSemantic<TBackend extends ScreenReaderBackendId> =
  TBackend extends "guidepup-voiceover"
    ? VoiceOverStableScreenReaderSemantic
    : TBackend extends "guidepup-nvda"
      ? NvdaStableScreenReaderSemantic
      : VirtualStableScreenReaderSemantic;

type BackendConfiguredStableScreenReaderAction<TBackend extends ScreenReaderBackendId> = Extract<
  ConfiguredStableScreenReaderAction,
  { semantic: Extract<ScreenReaderSemanticAction, BackendStableScreenReaderSemantic<TBackend>> }
>;

type BackendConfiguredUnstableScreenReaderAction<TBackend extends ScreenReaderBackendId> =
  TBackend extends "guidepup-virtual"
    ? Extract<ConfiguredUnstableScreenReaderAction, { unstable: "catalog" }>
    : ConfiguredUnstableScreenReaderAction;

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
    allowedKeys?: readonly ConfiguredKeyboardAction[];
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
export { srUnstable };
