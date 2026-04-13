import type { ScreenReaderController } from "@a11y-task/actuator";
import type { ScreenReaderCommand, ScreenReaderObservation } from "@a11y-task/core";
import type { Page } from "playwright";
export const SCREEN_READER_BACKEND_IDS = [
  "guidepup-voiceover",
  "guidepup-nvda",
  "guidepup-virtual"
] as const;

export type ScreenReaderBackendId = (typeof SCREEN_READER_BACKEND_IDS)[number];

export type ScreenReaderSession = {
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(command: ScreenReaderCommand): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
};

export type ScreenReaderBackend = {
  id: ScreenReaderBackendId;
  supportedCommands: readonly ScreenReaderCommand[];
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
  allowedCommands?: readonly ScreenReaderCommand[];
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
