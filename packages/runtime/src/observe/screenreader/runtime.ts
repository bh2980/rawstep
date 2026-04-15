import type { Page } from "playwright";
import {
  buildScreenReaderActionPlan,
  resolveExecutableScreenReaderAction,
  type ExecutableScreenReaderAction,
  type ScreenReaderMaintenanceMethod,
  type ScreenReaderReadMethod
} from "@rawstep/action-catalog";
import { createAnnouncementReader } from "./announcement";
import { ScreenReaderObserver } from "./observer";
import {
  resolveScreenReaderBackend,
  resolveScreenReaderObserveProfiles
} from "./registry";
import type {
  AnnouncementReader,
  AnnouncementState,
  ScreenReaderBackend,
  ScreenReaderRuntime,
  ScreenReaderRuntimeOptions,
  ScreenReaderSession
} from "./types";

export async function createScreenReaderRuntime(
  page: Page,
  options: ScreenReaderRuntimeOptions = {}
): Promise<ScreenReaderRuntime> {
  const platform = options.platform ?? process.platform;
  const backend = resolveScreenReaderBackend(options, platform);
  validateActionPlan(options.actionPlan, backend);
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

  const readAnnouncement = createAnnouncementReader(
    session,
    undefined,
    resolveScreenReaderObserveProfiles(backend, options.observeProfiles)
  );
  const firstAnnouncementWaitStartedAt = Date.now();
  const firstAnnouncement = await captureInitialAnnouncement(page, readAnnouncement);
  const firstAnnouncementWaitMs = Date.now() - firstAnnouncementWaitStartedAt;

  return {
    observer: new ScreenReaderObserver(readAnnouncement, firstAnnouncement),
    controller: {
      execute: async (action) => {
        const executableAction = resolveExecutableScreenReaderAction(action, {
          backendId: backend.id,
          capabilities: backend.capabilities,
          plan: options.actionPlan
        });

        return executeScreenReaderAction(session, executableAction);
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

function validateActionPlan(
  actionPlan: ScreenReaderRuntimeOptions["actionPlan"],
  backend: ScreenReaderBackend
): void {
  if (!actionPlan) {
    return;
  }

  if (actionPlan.backendId !== backend.id) {
    throw new Error(
      `Screen reader action plan backend "${actionPlan.backendId}" does not match runtime backend "${backend.id}".`
    );
  }

  buildScreenReaderActionPlan(actionPlan.refs, backend.id, backend.capabilities);
}

async function executeScreenReaderAction(
  session: ScreenReaderSession,
  action: ExecutableScreenReaderAction
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
  method: ScreenReaderReadMethod
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
  method: ScreenReaderMaintenanceMethod
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
