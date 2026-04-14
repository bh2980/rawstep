import type { ScreenReaderController } from "../../actuator";
import type {
  ClickOptions,
  CommandOptions,
  KeyboardOptions,
  ScreenReaderActionPlan,
  ScreenReaderCapabilities,
  ScreenReaderObservation
} from "@rawstep/core";
import { SCREEN_READER_BACKEND_IDS } from "@rawstep/action-catalog";
import type { Page } from "playwright";

export { SCREEN_READER_BACKEND_IDS };

export type ScreenReaderBackendId = (typeof SCREEN_READER_BACKEND_IDS)[number];

export type ScreenReaderSession = {
  start(options?: CommandOptions): Promise<void>;
  stop(options?: CommandOptions): Promise<void>;
  next(options?: CommandOptions): Promise<void>;
  previous(options?: CommandOptions): Promise<void>;
  act(options?: CommandOptions): Promise<void>;
  interact(options?: CommandOptions): Promise<void>;
  stopInteracting(options?: CommandOptions): Promise<void>;
  perform(command: unknown, options?: CommandOptions): Promise<void>;
  press(key: string, options?: KeyboardOptions): Promise<void>;
  type(text: string, options?: KeyboardOptions): Promise<void>;
  click(options?: ClickOptions): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  itemText(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  itemTextLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  clearItemTextLog(): Promise<void>;
};

export type ScreenReaderBackend = {
  id: ScreenReaderBackendId;
  capabilities: ScreenReaderCapabilities;
  supports(platform: NodeJS.Platform): boolean;
  createSession(page: Page): Promise<ScreenReaderSession>;
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

export type ScreenReaderObserveProfileName = "initial" | "default" | "interactive";

export type ScreenReaderObserveProfile = {
  pollIntervalMs: number;
  silenceWindowMs: number;
  maxObserveMs: number;
  allowFallback: boolean;
};

export const DEFAULT_OBSERVE_PROFILES: Record<ScreenReaderObserveProfileName, ScreenReaderObserveProfile> = {
  initial: {
    pollIntervalMs: 120,
    silenceWindowMs: 700,
    maxObserveMs: 6000,
    allowFallback: true
  },
  default: {
    pollIntervalMs: 100,
    silenceWindowMs: 500,
    maxObserveMs: 3000,
    allowFallback: false
  },
  interactive: {
    pollIntervalMs: 120,
    silenceWindowMs: 800,
    maxObserveMs: 5000,
    allowFallback: false
  }
};

export type AnnouncementState = Pick<
  ScreenReaderObservation,
  "announcement" | "announcementCapture" | "announcementCount" | "observeReason"
>;

export type AnnouncementReader = (
  profile?: ScreenReaderObserveProfileName
) => Promise<AnnouncementState>;

export function isScreenReaderBackendId(value: string): value is ScreenReaderBackendId {
  return (SCREEN_READER_BACKEND_IDS as readonly string[]).includes(value);
}
