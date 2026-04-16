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
  resolveScreenReaderObserveProfile
} from "./registry";
import { resolveKeyboardPressKey } from "../../actuator/keys";
import type {
  ScreenReaderBackend,
  ScreenReaderRuntime,
  ScreenReaderRuntimeOptions,
  ScreenReaderSession
} from "./types";
import type { PendingDiagnosticEvent } from "../../trace/artifacts";

type InitialAnnouncementClassification = "empty" | "browser-ui" | "unknown" | "web-content";

type InitialPageContext = {
  title: string;
  heading: string;
  normalizedTitle: string;
  normalizedHeading: string;
  tokens: readonly string[];
};

export class ScreenReaderInitializationError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly PendingDiagnosticEvent[],
    readonly setupTimings: {
      screenReaderInitMs: number;
      firstAnnouncementWaitMs: number;
    }
  ) {
    super(message);
    this.name = "ScreenReaderInitializationError";
  }
}

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
    await session.start();
    screenReaderInitMs = Date.now() - screenReaderInitStartedAt;
  } catch (error) {
    throw new Error(
      `Failed to start screen reader backend "${backend.id}" for screenreader mode. Ensure the screen reader is available and accessibility permissions are granted. ${getErrorMessage(error)}`
    );
  }

  const readAnnouncement = createAnnouncementReader(
    session,
    {},
    resolveScreenReaderObserveProfile(backend, options.observe)
  );
  const firstAnnouncementWaitStartedAt = Date.now();
  let firstAnnouncement;
  try {
    firstAnnouncement = await resolveInitialAnnouncement(page, session, backend, readAnnouncement);
  } catch (error) {
    const firstAnnouncementWaitMs = Date.now() - firstAnnouncementWaitStartedAt;
    if (error instanceof ScreenReaderInitializationError) {
      throw new ScreenReaderInitializationError(
        error.message,
        error.diagnostics,
        {
          screenReaderInitMs,
          firstAnnouncementWaitMs
        }
      );
    }

    throw error;
  }
  const firstAnnouncementWaitMs = Date.now() - firstAnnouncementWaitStartedAt;

  return {
    observer: new ScreenReaderObserver(readAnnouncement, firstAnnouncement),
    controller: {
      execute: async (action) => executeResolvedScreenReaderAction(action, {
        session,
        backend,
        actionPlan: options.actionPlan,
        platform
      }),
      executeInternal: async (action) => executeResolvedScreenReaderAction(action, {
        session,
        backend,
        platform
      })
    },
    capabilities: backend.capabilities,
    setupTimings: {
      screenReaderInitMs,
      firstAnnouncementWaitMs
    },
    captureCursorScreenshot: async () => {
      if (!options.voiceOver?.cursorScreenshot) {
        return { status: "disabled" };
      }

      if (backend.id !== "guidepup-voiceover") {
        return {
          status: "unsupported",
          diagnostic: {
            scope: "cursorScreenshot",
            level: "warn",
            code: "CURSOR_SCREENSHOT_UNSUPPORTED_BACKEND",
            message: `VoiceOver cursor screenshots are not supported by backend "${backend.id}".`
          }
        };
      }

      if (!session.takeCursorScreenshot) {
        return {
          status: "unsupported",
          diagnostic: {
            scope: "cursorScreenshot",
            level: "warn",
            code: "CURSOR_SCREENSHOT_UNSUPPORTED_SESSION",
            message: `VoiceOver cursor screenshots are not supported by backend "${backend.id}" in this session.`
          }
        };
      }

      try {
        const sourcePath = await session.takeCursorScreenshot();
        return { status: "captured", sourcePath };
      } catch (error) {
        return {
          status: "failed",
          diagnostic: {
            scope: "cursorScreenshot",
            level: "error",
            code: "CURSOR_SCREENSHOT_CAPTURE_FAILED",
            message: "Failed to capture the VoiceOver cursor screenshot.",
            error: getErrorMessage(error),
            ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
          }
        };
      }
    },
    close: async () => {
      try {
        await session.stop();
      } catch {
        // Best effort cleanup only.
      }
    }
  };
}

async function executeResolvedScreenReaderAction(
  action: import("@rawstep/definition").ScreenReaderAction,
  options: {
    session: ScreenReaderSession;
    backend: ScreenReaderBackend;
    actionPlan?: ScreenReaderRuntimeOptions["actionPlan"];
    platform: NodeJS.Platform;
  }
): Promise<import("@rawstep/definition").ExecutionRecord> {
  const executableAction = resolveExecutableScreenReaderAction(action, {
    backendId: options.backend.id,
    capabilities: options.backend.capabilities,
    plan: options.actionPlan
  });

  return executeScreenReaderAction(
    options.session,
    normalizeScreenReaderExecutableAction(executableAction, options.platform)
  );
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
): Promise<import("@rawstep/definition").ExecutionRecord> {
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

function normalizeScreenReaderExecutableAction(
  action: ExecutableScreenReaderAction,
  platform: NodeJS.Platform
): ExecutableScreenReaderAction {
  if (action.kind === "invoke" && action.method === "press") {
    return {
      ...action,
      key: resolveKeyboardPressKey(action.key as import("@rawstep/action-catalog").AllowedKey, platform)
    };
  }

  return action;
}

async function resolveInitialAnnouncement(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>
) {
  const diagnostics: PendingDiagnosticEvent[] = [];
  const pageContext = await readInitialPageContext(page);

  try {
    const firstAttempt = await captureAttachAnnouncement(page, session, backend, readAnnouncement, diagnostics, {
      reanchorMessage: "Reanchored keyboard focus to the page root before the first screen reader announcement."
    });
    const initialState = classifyInitialAnnouncement(firstAttempt.announcement, pageContext);
    if (initialState === "web-content") {
      return firstAttempt;
    }

    if (initialState === "browser-ui") {
      diagnostics.push({
        scope: "screenReaderInit",
        level: "warn",
        code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
        message: `Screen reader focus started in browser UI instead of web content: "${firstAttempt.announcement}".`
      });

      const recovered = await recoverFromBrowserUi(
        page,
        session,
        backend,
        readAnnouncement,
        diagnostics,
        pageContext
      );
      if (recovered.classification === "web-content") {
        return recovered.announcement;
      }

      await failInitialAnnouncementResolution(session, diagnostics, recovered.classification);
    }

    recordNonWebContentAnnouncement(initialState, firstAttempt.announcement, diagnostics);
    const retried = await retryScreenReaderContentSync(
      page,
      session,
      backend,
      readAnnouncement,
      diagnostics,
      pageContext
    );
    if (retried.classification === "web-content") {
      return retried.announcement;
    }

    if (retried.classification === "browser-ui") {
      diagnostics.push({
        scope: "screenReaderInit",
        level: "warn",
        code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
        message: `Screen reader focus entered browser UI after retrying the initial announcement: "${retried.announcement.announcement}".`
      });

      const browserUiRecovered = await recoverFromBrowserUi(
        page,
        session,
        backend,
        readAnnouncement,
        diagnostics,
        pageContext
      );
      if (browserUiRecovered.classification === "web-content") {
        return browserUiRecovered.announcement;
      }

      await failInitialAnnouncementResolution(session, diagnostics, browserUiRecovered.classification);
    }

    recordNonWebContentAnnouncement(retried.classification, retried.announcement.announcement, diagnostics);
    await failInitialAnnouncementResolution(session, diagnostics, retried.classification);
  } finally {
    await cleanupBootstrapFocus(page);
  }
}

async function retryScreenReaderContentSync(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  diagnostics: PendingDiagnosticEvent[],
  pageContext: InitialPageContext
) {
  const announcement = await captureAttachAnnouncement(page, session, backend, readAnnouncement, diagnostics, {
    reanchorMessage: "Reanchored keyboard focus to the page root before retrying the initial announcement.",
    syncSuccessDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_SYNC",
      message: "Retried the initial screen reader focus sync after a non-web initial announcement."
    },
    syncFailureDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_SYNC_FAILED",
      message: "Retrying screen reader focus sync failed after a non-web initial announcement."
    }
  });

  return {
    announcement,
    classification: classifyInitialAnnouncement(announcement.announcement, pageContext)
  };
}

async function recoverFromBrowserUi(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  diagnostics: PendingDiagnosticEvent[],
  pageContext: InitialPageContext
) {
  const announcement = await captureAttachAnnouncement(page, session, backend, readAnnouncement, diagnostics, {
    reanchorMessage: "Reanchored keyboard focus to the page root before recovering from browser UI focus.",
    escapeSuccessDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_ESCAPE",
      message: "Pressed Escape while recovering from browser UI focus during initialization."
    },
    escapeFailureDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_ESCAPE_FAILED",
      message: "Escape recovery failed while trying to leave browser UI during initialization."
    },
    syncSuccessDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_SYNC",
      message: "Retried screen reader focus sync after detecting browser UI focus."
    },
    syncFailureDiagnostic: {
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_RECOVERY_SYNC_FAILED",
      message: "Screen reader focus sync failed while recovering from browser UI focus."
    }
  });

  return {
    announcement,
    classification: classifyInitialAnnouncement(announcement.announcement, pageContext)
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

async function synchronizeScreenReaderFocus(
  session: ScreenReaderSession,
  backend: ScreenReaderBackend
): Promise<void> {
  const syncCommandId = resolveInitialFocusSyncCommandId(backend);
  if (!syncCommandId) {
    return;
  }

  await session.perform(
    { source: "catalog", id: syncCommandId },
    { capture: "initial" }
  );
}

function classifyInitialAnnouncement(
  announcement: string,
  pageContext: InitialPageContext
): InitialAnnouncementClassification {
  const normalized = normalizeText(announcement);
  if (normalized.length === 0) {
    return "empty";
  }

  if (BROWSER_UI_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "browser-ui";
  }

  if (WEB_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "web-content";
  }

  if (matchesPageContext(normalized, pageContext)) {
    return "web-content";
  }

  const overlap = countContextTokenOverlap(normalized, pageContext);
  if (overlap >= 2) {
    return "web-content";
  }

  if (ANNOUNCEMENT_CONTROL_PATTERNS.some((pattern) => pattern.test(normalized)) && overlap >= 1) {
    return "web-content";
  }

  return "unknown";
}

function resolveInitialFocusSyncCommandId(
  backend: Pick<ScreenReaderBackend, "capabilities">
): string | undefined {
  const availableIds = new Set(backend.capabilities.performCatalog.map((command) => command.id));

  for (const candidate of [
    "keyboard.moveCursorToKeyboardFocus",
    "keyboard.moveToFocusObject"
  ]) {
    if (availableIds.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function stopSessionBestEffort(session: ScreenReaderSession): Promise<void> {
  try {
    await session.stop();
  } catch {
    // Best effort cleanup only.
  }
}

async function focusPageRoot(page: Page): Promise<boolean> {
  const reanchored = await page.evaluate((marker) => {
    globalThis.focus?.();
    const target = document.body ?? document.documentElement;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const hadTabIndex = target.hasAttribute("tabindex");
    if (!hadTabIndex) {
      target.setAttribute("tabindex", "-1");
      target.setAttribute(marker, "true");
    }

    target.focus({ preventScroll: true });
    return true;
  }, BOOTSTRAP_FOCUS_MARKER);

  return Boolean(reanchored);
}

async function cleanupBootstrapFocus(page: Page): Promise<void> {
  try {
    await page.evaluate((marker) => {
      const target = document.querySelector(`[${marker}='true']`);
      if (!(target instanceof HTMLElement)) {
        return;
      }

      target.removeAttribute("tabindex");
      target.removeAttribute(marker);
    }, BOOTSTRAP_FOCUS_MARKER);
  } catch {
    // Best effort cleanup only.
  }
}

async function readInitialPageContext(page: Page): Promise<InitialPageContext> {
  try {
    const context = await page.evaluate(() => {
      const firstHeading = document.querySelector("h1, h2, h3, h4, h5, h6");
      return {
        title: document.title ?? "",
        heading: firstHeading?.textContent ?? ""
      };
    });

    return createInitialPageContext(context?.title ?? "", context?.heading ?? "");
  } catch {
    return createInitialPageContext("", "");
  }
}

function createInitialPageContext(title: string, heading: string): InitialPageContext {
  const normalizedTitle = normalizeText(title);
  const normalizedHeading = normalizeText(heading);
  const tokens = Array.from(new Set([
    ...tokenizeText(title),
    ...tokenizeText(heading)
  ]));

  return {
    title,
    heading,
    normalizedTitle,
    normalizedHeading,
    tokens
  };
}

function matchesPageContext(normalizedAnnouncement: string, pageContext: InitialPageContext): boolean {
  return [pageContext.normalizedTitle, pageContext.normalizedHeading]
    .some((candidate) => candidate.length > 0 && normalizedAnnouncement.includes(candidate));
}

function countContextTokenOverlap(normalizedAnnouncement: string, pageContext: InitialPageContext): number {
  if (pageContext.tokens.length === 0) {
    return 0;
  }

  const announcementTokens = new Set(tokenizeText(normalizedAnnouncement));
  let overlap = 0;
  for (const token of pageContext.tokens) {
    if (announcementTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenizeText(value: string): string[] {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function recordNonWebContentAnnouncement(
  classification: Exclude<InitialAnnouncementClassification, "browser-ui" | "web-content">,
  announcement: string,
  diagnostics: PendingDiagnosticEvent[]
): void {
  if (classification === "empty") {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_FIRST_ANNOUNCEMENT_TIMEOUT",
      message: "The initial screen reader announcement timed out without any spoken content."
    });
    return;
  }

  diagnostics.push({
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_INIT_UNKNOWN_ANNOUNCEMENT",
    message: `The initial screen reader announcement did not provide enough evidence of web content: "${announcement}".`
  });
}

async function failInitialAnnouncementResolution(
  session: ScreenReaderSession,
  diagnostics: PendingDiagnosticEvent[],
  finalClassification: Exclude<InitialAnnouncementClassification, "web-content">
): Promise<never> {
  await stopSessionBestEffort(session);

  const failure = resolveInitialFailure(finalClassification);
  throw new ScreenReaderInitializationError(
    failure.message,
    [
      ...diagnostics,
      {
        scope: "screenReaderInit",
        level: "error",
        code: "SCREENREADER_INIT_RECOVERY_FAILED",
        message: failure.diagnosticMessage
      }
    ],
    {
      screenReaderInitMs: 0,
      firstAnnouncementWaitMs: 0
    }
  );
}

function resolveInitialFailure(
  classification: Exclude<InitialAnnouncementClassification, "web-content">
): {
  message: string;
  diagnosticMessage: string;
} {
  switch (classification) {
    case "browser-ui":
      return {
        message: "Screen reader initialization failed because focus remained in browser UI instead of web content.",
        diagnosticMessage: "Screen reader initialization could not recover from browser UI focus."
      };
    case "unknown":
      return {
        message: "Screen reader initialization failed because the initial announcement did not provide enough evidence of web content.",
        diagnosticMessage: "Screen reader initialization could not confirm a reliable web content announcement."
      };
    case "empty":
      return {
        message: "Screen reader initialization failed before any web content announcement was captured.",
        diagnosticMessage: "Screen reader initialization could not recover from an empty initial announcement."
      };
  }
}

async function captureAttachAnnouncement(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  diagnostics: PendingDiagnosticEvent[],
  options: {
    reanchorMessage: string;
    escapeSuccessDiagnostic?: PendingDiagnosticEvent;
    escapeFailureDiagnostic?: Omit<PendingDiagnosticEvent, "error" | "stack">;
    syncSuccessDiagnostic?: PendingDiagnosticEvent;
    syncFailureDiagnostic?: Omit<PendingDiagnosticEvent, "error" | "stack">;
  }
) {
  await page.bringToFront();

  const reanchored = await focusPageRoot(page);
  if (reanchored) {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_PAGE_FOCUS_REANCHORED",
      message: options.reanchorMessage
    });
  }

  try {
    await session.stopInteracting({ capture: "initial" });
  } catch {
    // Best effort only. Some sessions are already outside an interaction context.
  }

  try {
    await session.press("Escape", { capture: "initial" });
    if (options.escapeSuccessDiagnostic) {
      diagnostics.push(options.escapeSuccessDiagnostic);
    }
  } catch (error) {
    if (options.escapeFailureDiagnostic) {
      diagnostics.push({
        ...options.escapeFailureDiagnostic,
        error: getErrorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      });
    }
  }

  try {
    await synchronizeScreenReaderFocus(session, backend);
    if (options.syncSuccessDiagnostic) {
      diagnostics.push(options.syncSuccessDiagnostic);
    }
  } catch (error) {
    if (options.syncFailureDiagnostic) {
      diagnostics.push({
        ...options.syncFailureDiagnostic,
        error: getErrorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      });
    }
  }

  return readAnnouncement();
}

const BROWSER_UI_PATTERNS = [
  /닫기 버튼/,
  /새 탭 버튼/,
  /탭 검색/,
  /최소화 버튼/,
  /전체 화면 버튼/,
  /선택됨 탭/,
  /탭 그룹/,
  /google chrome/,
  /chrome for testing/,
  /현재 윈도우/,
  /윈도우/,
  /toolbar/,
  /title bar/
];

const WEB_CONTEXT_PATTERNS = [
  /웹 콘텐츠/,
  /웹 영역/,
  /web content/,
  /web area/
];

const ANNOUNCEMENT_CONTROL_PATTERNS = [
  /텍스트 필드/,
  /입력/,
  /edit text/,
  /text field/,
  /textbox/,
  /button/,
  /버튼/,
  /checkbox/,
  /체크박스/,
  /link/,
  /링크/,
  /form/,
  /랜드마크/,
  /landmark/
];

const BOOTSTRAP_FOCUS_MARKER = "data-a11y-bootstrap-tabindex";
