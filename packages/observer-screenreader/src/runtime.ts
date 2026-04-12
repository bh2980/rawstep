import type { ScreenReaderController } from "@a11y-task/actuator";
import type { ScreenReaderCommand } from "@a11y-task/core";
import type { Page } from "playwright";
import { createAnnouncementReader } from "./announcement";
import { ScreenReaderObserver } from "./observer";
import type {
  AnnouncementReader,
  AnnouncementState,
  ScreenReaderRuntime,
  VoiceOverApi,
  VoiceOverRuntimeDependencies
} from "./types";

export async function createVoiceOverRuntime(
  page: Page,
  dependencies: VoiceOverRuntimeDependencies = {}
): Promise<ScreenReaderRuntime> {
  if (process.platform !== "darwin") {
    throw new Error("screenreader mode currently supports only macOS VoiceOver.");
  }

  const importGuidepup = dependencies.importGuidepup
    ?? (async () => import("@guidepup/guidepup") as unknown as Promise<{ voiceOver: VoiceOverApi }>);

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
): Promise<AnnouncementState> {
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
      case "nextHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextHeading);
        return;
      case "previousHeading":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousHeading);
        return;
      case "nextFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findNextControl);
        return;
      case "previousFormControl":
        await this.voiceOver.perform(this.voiceOver.keyboardCommands.findPreviousControl);
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

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-a11y-bootstrap-tabindex", "true");
    }

    target.focus();
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
