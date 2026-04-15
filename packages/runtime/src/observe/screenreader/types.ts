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
  ScreenReaderBackendSpec,
  ScreenReaderObservation
} from "@rawstep/definition";
import type { Page } from "playwright";
export type ScreenReaderObserveProfileName = "initial" | "default" | "interactive";

export type ScreenReaderObserveProfile = {
  pollIntervalMs: number;
  silenceWindowMs: number;
  maxObserveMs: number;
  allowFallback: boolean;
};

export type ScreenReaderObservePolicy = Record<ScreenReaderObserveProfileName, ScreenReaderObserveProfile>;

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
};

export type ScreenReaderBackendImplementation = {
  capabilities: ScreenReaderCapabilities;
  createSession(page: Page): Promise<ScreenReaderSession>;
};

export type ScreenReaderBackend = ScreenReaderBackendImplementation & ScreenReaderBackendSpec & {
  id: ScreenReaderBackendId;
  observePolicy: ScreenReaderObservePolicy;
};

export type ScreenReaderRuntimeObserver = {
  observe(): Promise<ScreenReaderObservation>;
  prepareNextObservation?(profile: ScreenReaderObserveProfileName): void;
};

export type ScreenReaderRuntime = {
  observer: ScreenReaderRuntimeObserver;
  controller: ScreenReaderController;
  capabilities: ScreenReaderCapabilities;
  setupTimings: {
    screenReaderInitMs: number;
    firstAnnouncementWaitMs: number;
  };
  close(): Promise<void>;
};

export type ScreenReaderRuntimeFactory = (page: Page) => Promise<ScreenReaderRuntime>;

export type ScreenReaderRuntimeOptions = {
  backendId?: ScreenReaderBackendId;
  backend?: ScreenReaderBackend;
  actionPlan?: ScreenReaderActionPlan;
  platform?: NodeJS.Platform;
  observeProfiles?: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>>;
};

export type AnnouncementState = Pick<
  ScreenReaderObservation,
  "announcement" | "announcementCapture" | "announcementCount" | "observeReason"
>;

export type AnnouncementReader = (
  profile?: ScreenReaderObserveProfileName
) => Promise<AnnouncementState>;
