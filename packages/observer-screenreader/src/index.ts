import type { ScreenReaderController } from "@a11y-task/actuator";
import type { ScreenReaderCommand, ScreenReaderObservation } from "@a11y-task/core";
import type { Page } from "playwright";

type VoiceOverApi = {
  start(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  act(): Promise<void>;
  perform(command: unknown): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
  keyboardCommands: {
    findNextHeading: unknown;
    findPreviousHeading: unknown;
    findNextControl: unknown;
    findPreviousControl: unknown;
  };
};

type GuidepupModule = {
  voiceOver: VoiceOverApi;
};

export type ScreenReaderRuntime = {
  observer: ScreenReaderObserver;
  controller: ScreenReaderController;
  setupTimings: {
    voiceOverInitMs: number;
    firstAnnouncementWaitMs: number;
  };
  close(): Promise<void>;
};

export type ScreenReaderRuntimeFactory = (page: Page) => Promise<ScreenReaderRuntime>;

export type VoiceOverRuntimeDependencies = {
  importGuidepup?: () => Promise<GuidepupModule>;
  observeProfiles?: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>>;
};

export type ScreenReaderObserveProfileName = "initial" | "default" | "interactive";

type ScreenReaderObserveProfile = {
  pollIntervalMs: number;
  silenceWindowMs: number;
  maxObserveMs: number;
  allowFallback: boolean;
};

const DEFAULT_OBSERVE_PROFILES: Record<ScreenReaderObserveProfileName, ScreenReaderObserveProfile> = {
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

type AnnouncementReader = (
  profile?: ScreenReaderObserveProfileName
) => Promise<Pick<ScreenReaderObservation, "announcement" | "announcementCapture" | "announcementCount" | "observeReason">>;

export class ScreenReaderObserver {
  private previousAnnouncement?: string;
  private pendingInitialObservation?: Pick<ScreenReaderObservation, "announcement" | "announcementCapture" | "announcementCount" | "observeReason">;
  private nextProfile: ScreenReaderObserveProfileName = "default";

  constructor(
    private readonly readAnnouncement: AnnouncementReader,
    private readonly prefetchedInitialObservation?: Pick<ScreenReaderObservation, "announcement" | "announcementCapture" | "announcementCount" | "observeReason">
  ) {
    this.pendingInitialObservation = prefetchedInitialObservation;
  }

  prepareNextObservation(profile: ScreenReaderObserveProfileName): void {
    this.nextProfile = profile;
  }

  async observe(): Promise<ScreenReaderObservation> {
    const profile = this.pendingInitialObservation ? "initial" : this.nextProfile;
    this.nextProfile = "default";
    const announcementState = this.pendingInitialObservation ?? await this.readAnnouncement(profile);
    this.pendingInitialObservation = undefined;
    const observation: ScreenReaderObservation = {
      kind: "screenreader",
      announcement: announcementState.announcement,
      announcementCapture: announcementState.announcementCapture,
      announcementCount: announcementState.announcementCount,
      observeReason: announcementState.observeReason
    };

    if (this.previousAnnouncement !== undefined) {
      observation.previousAnnouncement = this.previousAnnouncement;
    }

    this.previousAnnouncement = announcementState.announcement;
    return observation;
  }
}

export async function createVoiceOverRuntime(
  page: Page,
  dependencies: VoiceOverRuntimeDependencies = {}
): Promise<ScreenReaderRuntime> {
  if (process.platform !== "darwin") {
    throw new Error("screenreader mode currently supports only macOS VoiceOver.");
  }

  const importGuidepup = dependencies.importGuidepup
    ?? (async () => import("@guidepup/guidepup") as unknown as Promise<GuidepupModule>);

  const { voiceOver } = await importGuidepup();

  let voiceOverInitMs = 0;
  try {
    const voiceOverInitStartedAt = Date.now();
    await page.bringToFront();
    await focusPageRoot(page);
    await voiceOver.start();
    await focusPageRoot(page);
    voiceOverInitMs = Date.now() - voiceOverInitStartedAt;
  } catch (error) {
    throw new Error(
      `Failed to start VoiceOver for screenreader mode. Ensure VoiceOver is available and accessibility permissions are granted. ${getErrorMessage(error)}`
    );
  }

  const readAnnouncement = createAnnouncementReader(voiceOver, dependencies.observeProfiles);
  const firstAnnouncementWaitStartedAt = Date.now();
  const firstAnnouncement = await captureInitialAnnouncement(page, readAnnouncement);
  const firstAnnouncementWaitMs = Date.now() - firstAnnouncementWaitStartedAt;

  return {
    observer: new ScreenReaderObserver(readAnnouncement, firstAnnouncement),
    controller: new VoiceOverCommandController(voiceOver),
    setupTimings: {
      voiceOverInitMs,
      firstAnnouncementWaitMs
    },
    close: async () => {
      try {
        await voiceOver.stop();
      } catch {
        // Best effort cleanup only.
      }

      await cleanupBootstrapFocus(page);
    }
  };
}

async function captureInitialAnnouncement(
  page: Page,
  readAnnouncement: AnnouncementReader
): Promise<Pick<ScreenReaderObservation, "announcement" | "announcementCapture" | "announcementCount" | "observeReason">> {
  const firstAttempt = await readAnnouncement("initial");
  if (firstAttempt.announcementCapture !== "none") {
    return firstAttempt;
  }

  await focusPageRoot(page);
  const secondAttempt = await readAnnouncement("initial");
  return secondAttempt.announcementCapture === "none"
    ? firstAttempt
    : secondAttempt;
}

export function createAnnouncementReader(voiceOver: Pick<
  VoiceOverApi,
  "lastSpokenPhrase" | "spokenPhraseLog" | "clearSpokenPhraseLog"
>,
profiles: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>> = {}
): AnnouncementReader {
  const resolvedProfiles = resolveObserveProfiles(profiles);

  return async (profileName = "default") => {
    const profile = resolvedProfiles[profileName];
    const collected: string[] = [];
    const startedAt = Date.now();
    let lastNewPhraseAt: number | undefined;

    while (Date.now() - startedAt < profile.maxObserveMs) {
      const phrases = await readAndClearSpokenPhrases(voiceOver);
      if (phrases.length > 0) {
        collected.push(...phrases);
        lastNewPhraseAt = Date.now();
      }

      if (collected.length > 0) {
        if (lastNewPhraseAt !== undefined && Date.now() - lastNewPhraseAt >= profile.silenceWindowMs) {
          return {
            announcement: collected.join("\n"),
            announcementCapture: "log",
            announcementCount: collected.length,
            observeReason: "silence"
          };
        }
      }

      await sleep(profile.pollIntervalMs);
    }

    if (collected.length > 0) {
      return {
        announcement: collected.join("\n"),
        announcementCapture: "log",
        announcementCount: collected.length,
        observeReason: "timeout"
      };
    }

    if (profile.allowFallback) {
      const fallback = (await voiceOver.lastSpokenPhrase()).trim();
      return fallback
        ? {
            announcement: fallback,
            announcementCapture: "fallback",
            announcementCount: 1,
            observeReason: "fallback"
          }
        : {
            announcement: "",
            announcementCapture: "none",
            announcementCount: 0,
            observeReason: "timeout"
          };
    }

    return {
      announcement: "",
      announcementCapture: "none",
      announcementCount: 0,
      observeReason: "timeout"
    };
  };
}

class VoiceOverCommandController implements ScreenReaderController {
  constructor(private readonly voiceOver: VoiceOverApi) {}

  async execute(command: ScreenReaderCommand): Promise<void> {
    switch (command) {
      case "nextItem":
        await this.voiceOver.next();
        return;
      case "previousItem":
        await this.voiceOver.previous();
        return;
      case "nextFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextControl);
        return;
      case "previousFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousControl);
        return;
      case "nextHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextHeading);
        return;
      case "previousHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousHeading);
        return;
      case "act":
        await this.voiceOver.act();
        return;
      default:
        assertUnreachable(command);
    }
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled screen reader command: ${String(value)}`);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function focusPageRoot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.body ?? document.documentElement;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-a11y-bootstrap-tabindex", "true");
    }

    target.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
}

async function cleanupBootstrapFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector("[data-a11y-bootstrap-tabindex='true']");
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.removeAttribute("tabindex");
    target.removeAttribute("data-a11y-bootstrap-tabindex");
  });
}

async function readAndClearSpokenPhrases(voiceOver: Pick<
  VoiceOverApi,
  "spokenPhraseLog" | "clearSpokenPhraseLog"
>): Promise<string[]> {
  const log = (await voiceOver.spokenPhraseLog()) ?? [];
  const phrases = log
    .map((phrase) => phrase.trim())
    .filter(Boolean);
  await voiceOver.clearSpokenPhraseLog();
  return phrases;
}

function resolveObserveProfiles(
  overrides: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>>
): Record<ScreenReaderObserveProfileName, ScreenReaderObserveProfile> {
  return {
    initial: { ...DEFAULT_OBSERVE_PROFILES.initial, ...overrides.initial },
    default: { ...DEFAULT_OBSERVE_PROFILES.default, ...overrides.default },
    interactive: { ...DEFAULT_OBSERVE_PROFILES.interactive, ...overrides.interactive }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
