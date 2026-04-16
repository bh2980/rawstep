import type { ScreenReaderController } from "../../actuator";
import type {
  ScreenReaderActionPlan,
  ScreenReaderCapabilities,
  ScreenReaderClickOptions,
  ScreenReaderCommandOptions,
  ScreenReaderKeyboardOptions,
} from "@rawstep/action-catalog";
import type {
  ScreenReaderBackendId,
  ScreenReaderObserveConfig,
  ScreenReaderBackendSpec,
  ScreenReaderObservation,
  VoiceOverConfig,
} from "@rawstep/definition";
import type { Page } from "playwright";
import type { ScreenReaderCursorScreenshotCapture } from "../../trace/artifacts";
import type { PendingDiagnosticEvent } from "../../trace/artifacts";

export type ScreenReaderObserveProfile = {
  pollIntervalMs: number;
  silenceWindowMs: number;
  maxObserveMs: number;
  allowFallback: boolean;
};

export type ScreenReaderSession = {
  start(options?: ScreenReaderCommandOptions): Promise<void>;
  stop(options?: ScreenReaderCommandOptions): Promise<void>;
  next(options?: ScreenReaderCommandOptions): Promise<void>;
  previous(options?: ScreenReaderCommandOptions): Promise<void>;
  act(options?: ScreenReaderCommandOptions): Promise<void>;
  interact(options?: ScreenReaderCommandOptions): Promise<void>;
  stopInteracting(options?: ScreenReaderCommandOptions): Promise<void>;
  perform(command: unknown, options?: ScreenReaderCommandOptions): Promise<void>;
  press(key: string, options?: ScreenReaderKeyboardOptions): Promise<void>;
  type(text: string, options?: ScreenReaderKeyboardOptions): Promise<void>;
  click(options?: ScreenReaderClickOptions): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  itemText(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  itemTextLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  clearItemTextLog(): Promise<void>;
  takeCursorScreenshot?(): Promise<string>;
};

export type ScreenReaderBackendImplementation = {
  capabilities: ScreenReaderCapabilities;
  createSession(page: Page): Promise<ScreenReaderSession>;
};

export type ScreenReaderBackend = ScreenReaderBackendImplementation & ScreenReaderBackendSpec & {
  id: ScreenReaderBackendId;
  observeProfile: ScreenReaderObserveProfile;
};

export type ScreenReaderRuntime = {
  observer: ScreenReaderRuntimeObserver;
  controller: ScreenReaderController;
  capabilities: ScreenReaderCapabilities;
  setupTimings: {
    screenReaderInitMs: number;
    firstAnnouncementWaitMs: number;
  };
  recoverFromUnexpectedBrowserUi(args: {
    observation: ScreenReaderObservation;
    domFocus?: ScreenReaderDomFocusSnapshot;
  }): Promise<ScreenReaderRuntimeRecoveryResult>;
  captureCursorScreenshot(): Promise<ScreenReaderCursorScreenshotCapture>;
  close(): Promise<void>;
};

export type ScreenReaderRuntimeFactory = (page: Page) => Promise<ScreenReaderRuntime>;

export type ScreenReaderRuntimeOptions = {
  backendId?: ScreenReaderBackendId;
  backend?: ScreenReaderBackend;
  actionPlan?: ScreenReaderActionPlan;
  platform?: NodeJS.Platform;
  observe?: ScreenReaderObserveConfig;
  voiceOver?: VoiceOverConfig;
};

export type AnnouncementState = Pick<
  ScreenReaderObservation,
  "announcement" | "announcementCapture" | "announcementCount" | "observeReason"
>;

export type AnnouncementReadOptions = {
  followUpAfterAlert?: boolean;
};

export type AnnouncementReader = (
  options?: AnnouncementReadOptions
) => Promise<AnnouncementState>;

export type ScreenReaderRuntimeObserver = {
  observe(options?: AnnouncementReadOptions): Promise<ScreenReaderObservation>;
};

export type ScreenReaderRuntimeRecoveryResult = {
  observation: ScreenReaderObservation;
  recovered: boolean;
  feedbackNote: string;
  diagnostics: PendingDiagnosticEvent[];
};
