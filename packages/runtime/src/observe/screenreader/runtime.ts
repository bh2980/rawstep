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
  ScreenReaderRuntimeRecoveryResult,
  ScreenReaderRuntimeOptions,
  ScreenReaderSession,
  AnnouncementState
} from "./types";
import type { PendingDiagnosticEvent } from "../../trace/artifacts";

type InitialAnnouncementClassification = "empty" | "browser-ui" | "unknown" | "mixed" | "web-content";

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
  const pageContext = await readInitialPageContext(page);
  const firstAnnouncementWaitStartedAt = Date.now();
  let firstAnnouncement;
  try {
    firstAnnouncement = await resolveInitialAnnouncement(page, session, backend, readAnnouncement, pageContext);
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
    recoverFromUnexpectedBrowserUi: async ({ observation, domFocus }) => recoverFromUnexpectedBrowserUi(
      page,
      session,
      backend,
      readAnnouncement,
      pageContext,
      observation,
      domFocus
    ),
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
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  pageContext: InitialPageContext
) {
  const diagnostics: PendingDiagnosticEvent[] = [];

  const firstAttempt = await captureAttachAnnouncement(
    page,
    session,
    backend,
    readAnnouncement,
    diagnostics,
    { positioningVariant: "preferred" }
  );
  const initialState = classifyScreenReaderAnnouncementContext(firstAttempt.announcement, pageContext);
  const stabilizedInitial = await stabilizeInitialAnnouncement({
    announcement: firstAttempt,
    classification: initialState,
    readAnnouncement,
    pageContext,
    diagnostics
  });
  if (isAcceptedInitialAnnouncement(stabilizedInitial.classification)) {
    return stabilizedInitial.announcement;
  }

  if (stabilizedInitial.classification === "browser-ui") {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
      message: `Screen reader focus started in browser UI instead of web content: "${stabilizedInitial.announcement.announcement}".`
    });

    const recovered = await recoverFromBrowserUi(
      page,
      session,
      backend,
      readAnnouncement,
      diagnostics,
      pageContext
    );
    const stabilizedRecovery = await stabilizeInitialAnnouncement({
      announcement: recovered.announcement,
      classification: recovered.classification,
      readAnnouncement,
      pageContext,
      diagnostics,
      afterRecovery: true
    });
    if (isAcceptedInitialAnnouncement(stabilizedRecovery.classification)) {
      return stabilizedRecovery.announcement;
    }

    await failInitialAnnouncementResolution(
      session,
      diagnostics,
      resolveTerminalInitialFailureClassification(
        stabilizedRecovery.classification,
        [stabilizedInitial.classification, recovered.classification]
      )
    );
  }

  recordNonWebContentAnnouncement(stabilizedInitial.classification, stabilizedInitial.announcement.announcement, diagnostics);
  const retried = await retryScreenReaderContentSync(
    page,
    session,
    backend,
    readAnnouncement,
    diagnostics,
    pageContext
  );
  const stabilizedRetry = await stabilizeInitialAnnouncement({
    announcement: retried.announcement,
    classification: retried.classification,
    readAnnouncement,
    pageContext,
    diagnostics,
    afterRetry: true
  });
  if (isAcceptedInitialAnnouncement(stabilizedRetry.classification)) {
    return stabilizedRetry.announcement;
  }

  if (stabilizedRetry.classification === "browser-ui") {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
      message: `Screen reader focus entered browser UI after retrying the initial announcement: "${stabilizedRetry.announcement.announcement}".`
    });

    const browserUiRecovered = await recoverFromBrowserUi(
      page,
      session,
      backend,
      readAnnouncement,
      diagnostics,
      pageContext
    );
    const stabilizedRecovery = await stabilizeInitialAnnouncement({
      announcement: browserUiRecovered.announcement,
      classification: browserUiRecovered.classification,
      readAnnouncement,
      pageContext,
      diagnostics,
      afterRecovery: true
    });
    if (isAcceptedInitialAnnouncement(stabilizedRecovery.classification)) {
      return stabilizedRecovery.announcement;
    }

    await failInitialAnnouncementResolution(
      session,
      diagnostics,
      resolveTerminalInitialFailureClassification(
        stabilizedRecovery.classification,
        [stabilizedInitial.classification, stabilizedRetry.classification, browserUiRecovered.classification]
      )
    );
  }

  recordNonWebContentAnnouncement(stabilizedRetry.classification, stabilizedRetry.announcement.announcement, diagnostics);
  await failInitialAnnouncementResolution(
    session,
    diagnostics,
    resolveTerminalInitialFailureClassification(
      stabilizedRetry.classification,
      [stabilizedInitial.classification, retried.classification]
    )
  );
}

async function stabilizeInitialAnnouncement(input: {
  announcement: AnnouncementState;
  classification: InitialAnnouncementClassification;
  readAnnouncement: ReturnType<typeof createAnnouncementReader>;
  pageContext: InitialPageContext;
  diagnostics: PendingDiagnosticEvent[];
  afterRetry?: boolean;
  afterRecovery?: boolean;
}): Promise<{
  announcement: AnnouncementState;
  classification: InitialAnnouncementClassification;
}> {
  if (input.classification === "web-content") {
    return {
      announcement: input.announcement,
      classification: input.classification
    };
  }

  if (input.classification === "browser-ui") {
    return {
      announcement: input.announcement,
      classification: input.classification
    };
  }

  if (input.classification === "mixed") {
    recordMixedAnnouncementDiagnostic(input.diagnostics, input.announcement.announcement);
    const followUp = await input.readAnnouncement();
    const followUpClassification = classifyScreenReaderAnnouncementContext(
      followUp.announcement,
      input.pageContext
    );
    if (followUpClassification === "browser-ui") {
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "browser-ui", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }
    if (followUpClassification === "web-content") {
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "web-content", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }
    if (followUpClassification === "mixed") {
      recordMixedAnnouncementDiagnostic(input.diagnostics, followUp.announcement);
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "mixed", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }

    // Mixed startup speech can still correspond to valid page entry. Keep it fail-open here and rely on
    // the step-0 runtime browser UI recovery path if the first real observation proves to be off-page.
    return {
      announcement: input.announcement,
      classification: input.classification
    };
  }

  let currentAnnouncement = input.announcement;
  let currentClassification = input.classification;
  for (let sample = 0; sample < 2; sample += 1) {
    const followUp = await input.readAnnouncement();
    const followUpClassification = classifyScreenReaderAnnouncementContext(
      followUp.announcement,
      input.pageContext
    );
    if (followUpClassification === "web-content") {
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "web-content", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }
    if (followUpClassification === "mixed") {
      recordMixedAnnouncementDiagnostic(input.diagnostics, followUp.announcement);
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "mixed", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }
    if (followUpClassification === "browser-ui") {
      recordStabilizedAfterRetryDiagnostic(input.diagnostics, "browser-ui", input.afterRetry);
      return {
        announcement: followUp,
        classification: followUpClassification
      };
    }

    if (followUpClassification !== "empty" || currentClassification === "empty") {
      currentAnnouncement = followUp;
      currentClassification = followUpClassification;
    }
  }

  return {
    announcement: currentAnnouncement,
    classification: currentClassification
  };
}

function isAcceptedInitialAnnouncement(
  classification: InitialAnnouncementClassification
): classification is Extract<InitialAnnouncementClassification, "web-content" | "mixed"> {
  return classification === "web-content" || classification === "mixed";
}

function resolveTerminalInitialFailureClassification(
  classification: Exclude<InitialAnnouncementClassification, "web-content" | "mixed">,
  history: readonly InitialAnnouncementClassification[]
): Exclude<InitialAnnouncementClassification, "web-content" | "mixed"> {
  if (classification !== "empty") {
    return classification;
  }

  return history.includes("unknown") ? "unknown" : classification;
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
    stopInteracting: true,
    positioningVariant: "fallback",
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
    classification: classifyScreenReaderAnnouncementContext(announcement.announcement, pageContext)
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
    stopInteracting: true,
    performEscape: true,
    positioningVariant: "preferred",
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
    classification: classifyScreenReaderAnnouncementContext(announcement.announcement, pageContext)
  };
}

async function recoverFromUnexpectedBrowserUi(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  pageContext: InitialPageContext,
  observation: import("@rawstep/definition").ScreenReaderObservation,
  domFocus?: import("@rawstep/definition").ScreenReaderDomFocusSnapshot
): Promise<ScreenReaderRuntimeRecoveryResult> {
  if (!isHighConfidenceBrowserUi(observation.announcement)) {
    return {
      observation,
      recovered: false,
      feedbackNote: "",
      diagnostics: []
    };
  }

  const diagnostics: PendingDiagnosticEvent[] = [{
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_RUNTIME_BROWSER_UI_DETECTED",
    message: `Detected browser UI before agent observation: "${observation.announcement}".`
  }];

  const focusCommandId = resolveRuntimeFocusRealignCommandId(backend);
  if (domFocus?.hasDocumentFocus && focusCommandId) {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_RUNTIME_RECOVERY_STRATEGY",
      message: `Trying focus-based screen reader realignment via "${focusCommandId}".`
    });
    const focusRecovered = await captureRuntimeRecoveryAnnouncement(
      page,
      session,
      backend,
      readAnnouncement,
      diagnostics,
      {
        commandId: focusCommandId,
        commandLabel: focusCommandId,
        browserUiFailureCode: "SCREENREADER_RUNTIME_RECOVERY_FOCUS_SYNC_FAILED"
      }
    );
    if (focusRecovered.classification === "web-content") {
      diagnostics.push({
        scope: "screenReaderInit",
        level: "warn",
        code: "SCREENREADER_RUNTIME_RECOVERY_SUCCEEDED",
        message: "Recovered from browser UI using focus-based screen reader realignment."
      });
      return {
        observation: toRuntimeScreenReaderObservation(focusRecovered.announcement, observation),
        recovered: true,
        feedbackNote: "브라우저 UI 감지 후 자동 복구를 수행했고, 웹 본문으로 다시 정렬했습니다.",
        diagnostics
      };
    }
  }

  const recoveryEscapeCommandId = resolveInitialRecoveryEscapeCommandId(backend);
  const reentryCommandId = resolveRuntimeReentryCommandId(backend);
  diagnostics.push({
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_RUNTIME_RECOVERY_STRATEGY",
    message: `Trying browser UI escape and document re-entry${recoveryEscapeCommandId ? ` via "${recoveryEscapeCommandId}"` : " via Escape"}${reentryCommandId ? `, then "${reentryCommandId}"` : ""}.`
  });
  const recovered = await captureRuntimeRecoveryAnnouncement(
    page,
    session,
    backend,
    readAnnouncement,
    diagnostics,
    {
      stopInteracting: true,
      escapeCommandId: recoveryEscapeCommandId,
      commandId: reentryCommandId,
      commandLabel: reentryCommandId ?? recoveryEscapeCommandId ?? "Escape",
      browserUiFailureCode: "SCREENREADER_RUNTIME_RECOVERY_REENTRY_FAILED"
    }
  );

  if (recovered.classification === "web-content") {
    diagnostics.push({
      scope: "screenReaderInit",
      level: "warn",
      code: "SCREENREADER_RUNTIME_RECOVERY_SUCCEEDED",
      message: "Recovered from browser UI using browser-ui escape and document re-entry."
    });
    return {
      observation: toRuntimeScreenReaderObservation(recovered.announcement, observation),
      recovered: true,
      feedbackNote: "브라우저 UI 감지 후 자동 복구를 수행했고, 웹 본문으로 다시 정렬했습니다.",
      diagnostics
    };
  }

  diagnostics.push({
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_RUNTIME_RECOVERY_FAILED",
    message: `Automatic recovery could not restore in-page content after browser UI detection. Final announcement: "${recovered.announcement.announcement}".`
  });
  return {
    observation,
    recovered: false,
    feedbackNote: "브라우저 UI를 감지했지만 자동 복구에 실패했습니다. 현재 observation은 웹 본문 밖일 수 있습니다.",
    diagnostics
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

async function positionScreenReaderAtStartupTarget(
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  variant: "preferred" | "fallback"
): Promise<void> {
  const commandId = resolveInitialPositionCommandId(backend, variant);
  if (!commandId) {
    return;
  }

  await session.perform(
    { source: "catalog", id: commandId },
    { capture: "initial" }
  );
}

export function classifyScreenReaderAnnouncementContext(
  announcement: string,
  pageContext: InitialPageContext
): InitialAnnouncementClassification {
  const normalized = normalizeText(announcement);
  if (normalized.length === 0) {
    return "empty";
  }

  const overlap = countContextTokenOverlap(normalized, pageContext);
  const hasBrowserUiSignal = BROWSER_UI_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasWebSignal = WEB_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized))
    || matchesPageContext(normalized, pageContext)
    || overlap >= 2
    || (ANNOUNCEMENT_CONTROL_PATTERNS.some((pattern) => pattern.test(normalized)) && overlap >= 1);

  if (hasBrowserUiSignal && hasWebSignal) {
    return "mixed";
  }

  if (hasBrowserUiSignal) {
    return "browser-ui";
  }

  if (hasWebSignal) {
    return "web-content";
  }

  return "unknown";
}

export function isHighConfidenceBrowserUi(announcement: string): boolean {
  const normalized = normalizeText(announcement);
  return normalized.length > 0 && BROWSER_UI_PATTERNS.some((pattern) => pattern.test(normalized));
}

function resolveInitialPositionCommandId(
  backend: Pick<ScreenReaderBackend, "capabilities">
,
  variant: "preferred" | "fallback"
): string | undefined {
  const availableIds = new Set(backend.capabilities.performCatalog.map((command) => command.id));

  const preferredCandidates = [
    "keyboard.moveToNextAutoWebSpot",
    "keyboard.moveToNextWebSpot",
    "keyboard.moveToContainingBrowseModeDocument",
    "keyboard.moveCursorToKeyboardFocus",
    "keyboard.moveToFocusObject"
  ];
  const fallbackCandidates = [
    "keyboard.moveCursorToKeyboardFocus",
    "keyboard.moveToFocusObject",
    "keyboard.moveToNextWebSpot",
    "keyboard.moveToNextAutoWebSpot",
    "keyboard.moveToContainingBrowseModeDocument"
  ];

  for (const candidate of variant === "preferred" ? preferredCandidates : fallbackCandidates) {
    if (availableIds.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveRuntimeFocusRealignCommandId(
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

function resolveRuntimeReentryCommandId(
  backend: Pick<ScreenReaderBackend, "capabilities">
): string | undefined {
  const availableIds = new Set(backend.capabilities.performCatalog.map((command) => command.id));

  for (const candidate of [
    "keyboard.moveToNextAutoWebSpot",
    "keyboard.moveToNextWebSpot",
    "keyboard.moveToContainingBrowseModeDocument",
    "keyboard.moveCursorToKeyboardFocus",
    "keyboard.moveToFocusObject"
  ]) {
    if (availableIds.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveInitialRecoveryEscapeCommandId(
  backend: Pick<ScreenReaderBackend, "capabilities">
): string | undefined {
  const availableIds = new Set(backend.capabilities.performCatalog.map((command) => command.id));

  for (const candidate of [
    "keyboard.stopAction",
    "keyboard.exitFocusMode"
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
  classification: Exclude<InitialAnnouncementClassification, "browser-ui" | "web-content" | "mixed">,
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

function recordMixedAnnouncementDiagnostic(
  diagnostics: PendingDiagnosticEvent[],
  announcement: string
): void {
  diagnostics.push({
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_INIT_MIXED_ANNOUNCEMENT",
    message: `The initial screen reader announcement contained both browser UI and web-content signals: "${announcement}".`
  });
}

function recordStabilizedAfterRetryDiagnostic(
  diagnostics: PendingDiagnosticEvent[],
  stabilizedClassification: "web-content" | "mixed" | "browser-ui",
  afterRetry = false
): void {
  diagnostics.push({
    scope: "screenReaderInit",
    level: "warn",
    code: "SCREENREADER_INIT_STABILIZED_AFTER_RETRY",
    message: afterRetry
      ? `A follow-up startup sample after retry stabilized the announcement as ${stabilizedClassification}.`
      : `A follow-up startup sample stabilized the announcement as ${stabilizedClassification}.`
  });
}

async function captureRuntimeRecoveryAnnouncement(
  page: Page,
  session: ScreenReaderSession,
  backend: ScreenReaderBackend,
  readAnnouncement: ReturnType<typeof createAnnouncementReader>,
  diagnostics: PendingDiagnosticEvent[],
  options: {
    stopInteracting?: boolean;
    escapeCommandId?: string;
    commandId?: string;
    commandLabel: string;
    browserUiFailureCode: string;
  }
): Promise<{
  announcement: AnnouncementState;
  classification: InitialAnnouncementClassification;
}> {
  await page.bringToFront();

  if (options.stopInteracting) {
    try {
      await session.stopInteracting({ capture: "initial" });
    } catch {
      // Best effort only.
    }
  }

  if (options.escapeCommandId) {
    try {
      await session.perform({ source: "catalog", id: options.escapeCommandId }, { capture: "initial" });
    } catch (error) {
      diagnostics.push({
        scope: "screenReaderInit",
        level: "warn",
        code: "SCREENREADER_RUNTIME_RECOVERY_ESCAPE_FAILED",
        message: `Recovery escape command "${options.escapeCommandId}" failed during runtime browser UI recovery.`,
        error: getErrorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      });
    }
  }

  if (options.commandId) {
    try {
      await session.perform({ source: "catalog", id: options.commandId }, { capture: "initial" });
    } catch (error) {
      diagnostics.push({
        scope: "screenReaderInit",
        level: "warn",
        code: options.browserUiFailureCode,
        message: `Recovery command "${options.commandLabel}" failed during runtime browser UI recovery.`,
        error: getErrorMessage(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      });
    }
  }

  const announcement = await readAnnouncement();
  return {
    announcement,
    classification: classifyScreenReaderAnnouncementContext(announcement.announcement, await readInitialPageContext(page))
  };
}

function toRuntimeScreenReaderObservation(
  announcement: AnnouncementState,
  previousObservation: import("@rawstep/definition").ScreenReaderObservation
): import("@rawstep/definition").ScreenReaderObservation {
  return {
    ...previousObservation,
    announcement: announcement.announcement,
    announcementCapture: announcement.announcementCapture,
    announcementCount: announcement.announcementCount,
    observeReason: announcement.observeReason
  };
}

async function failInitialAnnouncementResolution(
  session: ScreenReaderSession,
  diagnostics: PendingDiagnosticEvent[],
  finalClassification: Exclude<InitialAnnouncementClassification, "web-content" | "mixed">
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
  classification: Exclude<InitialAnnouncementClassification, "web-content" | "mixed">
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
    stopInteracting?: boolean;
    performEscape?: boolean;
    positioningVariant?: "preferred" | "fallback";
    escapeSuccessDiagnostic?: PendingDiagnosticEvent;
    escapeFailureDiagnostic?: Omit<PendingDiagnosticEvent, "error" | "stack">;
    syncSuccessDiagnostic?: PendingDiagnosticEvent;
    syncFailureDiagnostic?: Omit<PendingDiagnosticEvent, "error" | "stack">;
  } = {}
) {
  await page.bringToFront();

  if (options.stopInteracting) {
    try {
      await session.stopInteracting({ capture: "initial" });
    } catch {
      // Best effort only. Some sessions are already outside an interaction context.
    }
  }

  if (options.performEscape) {
    try {
      const escapeCommandId = resolveInitialRecoveryEscapeCommandId(backend);
      if (escapeCommandId) {
        await session.perform({ source: "catalog", id: escapeCommandId }, { capture: "initial" });
      } else {
        await session.press("Escape", { capture: "initial" });
      }
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
  }

  try {
    await positionScreenReaderAtStartupTarget(
      session,
      backend,
      options.positioningVariant ?? "fallback"
    );
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
