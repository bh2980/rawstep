import type { Page } from "playwright";
import type { ScreenReaderCommand } from "@a11y-task/core";
import { createAnnouncementReader } from "./announcement";
import {
  guidepupNvdaBackend,
  guidepupVirtualBackend,
  guidepupVoiceOverBackend
} from "./backends/guidepup-voiceover";
import { ScreenReaderObserver } from "./observer";
import type {
  AnnouncementReader,
  AnnouncementState,
  ScreenReaderBackendId,
  ScreenReaderBackend,
  ScreenReaderRuntime,
  ScreenReaderRuntimeOptions
} from "./types";

export const BUILTIN_SCREEN_READER_BACKENDS: readonly ScreenReaderBackend[] = [
  guidepupVoiceOverBackend,
  guidepupNvdaBackend,
  guidepupVirtualBackend
];

export async function createScreenReaderRuntime(
  page: Page,
  options: ScreenReaderRuntimeOptions = {}
): Promise<ScreenReaderRuntime> {
  const platform = options.platform ?? process.platform;
  const backend = resolveScreenReaderBackend(options, platform);
  validateAllowedCommands(options.allowedCommands, backend);
  const session = await backend.createSession(page);

  let screenReaderInitMs = 0;
  try {
    const screenReaderInitStartedAt = Date.now();
    await page.bringToFront();
    await focusPageRoot(page);
    await session.start();
    await focusPageRoot(page);
    screenReaderInitMs = Date.now() - screenReaderInitStartedAt;
  } catch (error) {
    throw new Error(
      `Failed to start screen reader backend "${backend.id}" for screenreader mode. Ensure the screen reader is available and accessibility permissions are granted. ${getErrorMessage(error)}`
    );
  }

  const readAnnouncement = createAnnouncementReader(session, options.observeProfiles);
  const firstAnnouncementWaitStartedAt = Date.now();
  const firstAnnouncement = await captureInitialAnnouncement(page, readAnnouncement);
  const firstAnnouncementWaitMs = Date.now() - firstAnnouncementWaitStartedAt;

  return {
    observer: new ScreenReaderObserver(readAnnouncement, firstAnnouncement),
    controller: {
      execute: (command) => session.execute(command)
    },
    setupTimings: {
      screenReaderInitMs,
      firstAnnouncementWaitMs
    },
    close: async () => {
      try {
        await session.stop();
      } catch {
        // Best effort cleanup only.
      }

      await cleanupBootstrapFocus(page);
    }
  };
}

export function findScreenReaderBackendById(id: ScreenReaderBackendId): ScreenReaderBackend {
  const backend = BUILTIN_SCREEN_READER_BACKENDS.find((candidate) => candidate.id === id);
  if (!backend) {
    throw new Error(`Unknown screen reader backend "${id}".`);
  }

  return backend;
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

function resolveScreenReaderBackend(
  options: ScreenReaderRuntimeOptions,
  platform: NodeJS.Platform
): ScreenReaderBackend {
  if (options.backend) {
    if (!options.backend.supports(platform)) {
      throw new Error(`Screen reader backend "${options.backend.id}" is not supported on platform "${platform}".`);
    }

    return options.backend;
  }

  if (!options.backendId) {
    throw new Error(
      'screenreader mode requires an explicit screenReaderBackend. Set screenReaderBackend to "guidepup-voiceover", "guidepup-nvda", or "guidepup-virtual".'
    );
  }

  const backend = findScreenReaderBackendById(options.backendId);
  if (!backend.supports(platform)) {
    throw new Error(`Screen reader backend "${options.backendId}" is not supported on platform "${platform}".`);
  }

  return backend;
}

function validateAllowedCommands(
  allowedCommands: readonly ScreenReaderCommand[] | undefined,
  backend: ScreenReaderBackend
): void {
  if (!allowedCommands) {
    return;
  }

  const unsupported = allowedCommands.filter((command) => !backend.supportedCommands.includes(command));
  if (unsupported.length > 0) {
    throw new Error(
      `Screen reader backend "${backend.id}" does not support commands: ${unsupported.join(", ")}.`
    );
  }
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
