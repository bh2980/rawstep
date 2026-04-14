import type { Page } from "playwright";
import { supportsScreenReaderAction } from "@rawstep/core";
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
  ScreenReaderRuntimeOptions,
  ScreenReaderSession
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
  validateAllowedActions(options.allowedActions, backend);
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
      execute: async (action) => {
        if (options.allowedActions && !isAllowedByConfiguredActions(options.allowedActions, action)) {
          throw new Error(`Screen reader action is not allowed by the configured allowedScreenReaderActions: ${formatScreenReaderActionForError(action)}.`);
        }

        if (!supportsScreenReaderAction(backend.capabilities, action)) {
          throw new Error(`Screen reader backend "${backend.id}" does not support action ${formatScreenReaderActionForError(action)}.`);
        }

        return executeScreenReaderAction(session, action);
      }
    },
    capabilities: backend.capabilities,
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

function validateAllowedActions(
  allowedActions: ScreenReaderRuntimeOptions["allowedActions"],
  backend: ScreenReaderBackend
): void {
  if (!allowedActions) {
    return;
  }

  const unsupported = allowedActions.filter((action) => !supportsScreenReaderAction(backend.capabilities, action));
  if (unsupported.length > 0) {
    throw new Error(
      `Screen reader backend "${backend.id}" does not support actions: ${unsupported
        .map((action) => formatAllowedScreenReaderActionForError(action))
        .join(", ")}.`
    );
  }
}

async function executeScreenReaderAction(
  session: ScreenReaderSession,
  action: import("@rawstep/core").ScreenReaderAction
): Promise<import("@rawstep/core").ExecutionRecord> {
  if (action.kind === "read") {
    const value = await readScreenReaderValue(session, action.method);
    return {
      ok: true,
      costDelta: 1,
      readResult: {
        method: action.method,
        value
      }
    };
  }

  if (action.kind === "maintenance") {
    await runScreenReaderMaintenance(session, action.method);
    return {
      ok: true,
      costDelta: 1,
      maintenanceResult: {
        method: action.method,
        status: "cleared"
      }
    };
  }

  switch (action.method) {
    case "next":
      await session.next(action.options);
      break;
    case "previous":
      await session.previous(action.options);
      break;
    case "act":
      await session.act(action.options);
      break;
    case "interact":
      await session.interact(action.options);
      break;
    case "stopInteracting":
      await session.stopInteracting(action.options);
      break;
    case "perform":
      await session.perform(action.command, action.options);
      break;
    case "press":
      await session.press(action.key, action.options);
      break;
    case "type":
      await session.type(action.text, action.options);
      break;
    case "click":
      await session.click(action.options);
      break;
  }

  return {
    ok: true,
    costDelta: 1
  };
}

async function readScreenReaderValue(
  session: ScreenReaderSession,
  method: import("@rawstep/core").ScreenReaderReadMethod
): Promise<string | string[]> {
  switch (method) {
    case "itemText":
      return session.itemText();
    case "itemTextLog":
      return session.itemTextLog();
    case "lastSpokenPhrase":
      return session.lastSpokenPhrase();
    case "spokenPhraseLog":
      return session.spokenPhraseLog();
  }
}

async function runScreenReaderMaintenance(
  session: ScreenReaderSession,
  method: import("@rawstep/core").ScreenReaderMaintenanceMethod
): Promise<void> {
  switch (method) {
    case "clearItemTextLog":
      await session.clearItemTextLog();
      break;
    case "clearSpokenPhraseLog":
      await session.clearSpokenPhraseLog();
      break;
  }
}

function isAllowedByConfiguredActions(
  allowedActions: readonly import("@rawstep/core").AllowedScreenReaderAction[],
  action: import("@rawstep/core").ScreenReaderAction
): boolean {
  return allowedActions.some((allowed) => matchesAllowedScreenReaderAction(allowed, action));
}

function matchesAllowedScreenReaderAction(
  allowed: import("@rawstep/core").AllowedScreenReaderAction,
  action: import("@rawstep/core").ScreenReaderAction
): boolean {
  if (allowed.kind !== action.kind) {
    return false;
  }

  if (allowed.kind === "read" || allowed.kind === "maintenance") {
    return allowed.method === action.method;
  }

  if (allowed.method !== action.method) {
    return false;
  }

  if (allowed.method !== "perform") {
    return true;
  }

  if (action.method !== "perform") {
    return false;
  }

  return allowed.source === action.command.source
    && (allowed.source !== "catalog" || (action.command.source === "catalog" && allowed.id === action.command.id));
}

function formatAllowedScreenReaderActionForError(
  action: import("@rawstep/core").AllowedScreenReaderAction
): string {
  if (action.kind !== "invoke") {
    return `${action.kind}:${action.method}`;
  }

  if (action.method !== "perform") {
    return `invoke:${action.method}`;
  }

  return action.source === "catalog"
    ? `invoke:perform:catalog:${action.id}`
    : "invoke:perform:raw";
}

function formatScreenReaderActionForError(
  action: import("@rawstep/core").ScreenReaderAction
): string {
  if (action.kind !== "invoke") {
    return `${action.kind}:${action.method}`;
  }

  if (action.method !== "perform") {
    return `invoke:${action.method}`;
  }

  return action.command.source === "catalog"
    ? `invoke:perform:catalog:${action.command.id}`
    : "invoke:perform:raw";
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
