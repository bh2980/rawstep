import {
  type ActionCounts,
  type DiagnosticEvent,
  type Decision,
  type EndedBy,
  type ExperienceSummary,
  type ExecutionRecord,
  type KeyboardObservation,
  type Observation,
  type PlanState,
  type RecordedKeyboardObservation,
  type RecordedScreenReaderCursorScreenshot,
  type RecordedScreenReaderDomFocus,
  type RecordedObservation,
  type ReflectionEvent,
  type ReflectionState,
  type ResolvedTask,
  type StepRecord,
  type TraceAggregate,
  type TraceSession,
  type VerdictAnalysis,
  type VerificationRecord
} from "@rawstep/definition";
import { copyFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PendingDiagnosticEvent,
  ScreenReaderTraceArtifacts,
} from "./artifacts";

export class TraceRecorder {
  private readonly startedAt = new Date().toISOString();
  private readonly traceJsonlPath: string;
  private readonly diagnosticsJsonlPath: string;
  private readonly screenshotsDir: string;
  private readonly steps: StepRecord[] = [];
  private session?: TraceSession;
  private diagnosticsInitialized = false;
  private plan?: PlanState;
  private planningError?: string;
  private readonly reflections: ReflectionEvent[] = [];
  private setupTimings: Omit<TraceAggregate["timings"], "reportMs"> = {
    setupMs: 0,
    browserLaunchMs: 0,
    pageLoadMs: 0,
    screenReaderInitMs: 0,
    firstAnnouncementWaitMs: 0
  };
  private reportMs = 0;

  constructor(
    private readonly task: ResolvedTask,
    private readonly outDir: string
  ) {
    this.traceJsonlPath = join(outDir, "trace.jsonl");
    this.diagnosticsJsonlPath = join(outDir, "diagnostics.jsonl");
    this.screenshotsDir = join(outDir, "screenshots");
  }

  async initialize(): Promise<void> {
    await mkdir(this.outDir, { recursive: true });
    await mkdir(this.screenshotsDir, { recursive: true });
    await writeFile(this.traceJsonlPath, "");
  }

  async append(
    step: number,
    observation: Observation,
    decision: Decision,
    execution: ExecutionRecord,
    timings: StepRecord["timings"],
    verification?: VerificationRecord,
    verdictAnalysis?: VerdictAnalysis,
    developerScreenshot?: {
      pngBase64: string;
      viewport: { w: number; h: number };
    },
    screenReaderArtifacts?: ScreenReaderTraceArtifacts
  ): Promise<void> {
    const recordedObservation = await this.serializeObservation(
      step,
      observation,
      developerScreenshot,
      screenReaderArtifacts
    );
    const record: StepRecord = {
      step,
      timestamp: new Date().toISOString(),
      observation: recordedObservation,
      decision,
      execution,
      timings,
      verification,
      verdictAnalysis
    };

    this.steps.push(record);
    await appendFile(this.traceJsonlPath, `${JSON.stringify(record)}\n`, "utf8");
    await this.appendDiagnostics(step, screenReaderArtifacts);
  }

  async appendDiagnostic(step: number, diagnostic: PendingDiagnosticEvent): Promise<void> {
    if (!this.diagnosticsInitialized) {
      await writeFile(this.diagnosticsJsonlPath, "");
      this.diagnosticsInitialized = true;
    }

    const event: DiagnosticEvent = {
      ts: new Date().toISOString(),
      step,
      ...diagnostic
    };
    await appendFile(this.diagnosticsJsonlPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async finalize(
    endedBy: EndedBy,
    failureReasonOverride?: string
  ): Promise<TraceSession> {
    const endedAt = new Date().toISOString();
    const aggregate = buildAggregate(
      this.steps,
      this.startedAt,
      endedAt,
      endedBy,
      this.setupTimings,
      this.reportMs,
      failureReasonOverride
    );
    const session: TraceSession = {
      task: this.task,
      startedAt: this.startedAt,
      endedAt,
      steps: [...this.steps],
      aggregate,
      ...(this.plan ? { plan: this.plan } : {}),
      ...(this.planningError ? { planningError: this.planningError } : {}),
      ...(this.reflections.length > 0 ? { reflections: [...this.reflections] } : {})
    };

    this.session = session;
    await persistFinalizedTraceSession(session, this.outDir);
    return session;
  }

  getSession(): TraceSession {
    if (!this.session) {
      throw new Error("Trace session has not been finalized yet.");
    }

    return this.session;
  }

  getSteps(): StepRecord[] {
    return [...this.steps];
  }

  setSetupTimings(timings: Omit<TraceAggregate["timings"], "reportMs">): void {
    this.setupTimings = {
      setupMs: Math.max(0, timings.setupMs),
      browserLaunchMs: Math.max(0, timings.browserLaunchMs),
      pageLoadMs: Math.max(0, timings.pageLoadMs),
      screenReaderInitMs: Math.max(0, timings.screenReaderInitMs),
      firstAnnouncementWaitMs: Math.max(0, timings.firstAnnouncementWaitMs)
    };
  }

  setReportMs(durationMs: number): void {
    this.reportMs = Math.max(0, durationMs);

    if (this.session) {
      this.session.aggregate.timings.reportMs = this.reportMs;
    }
  }

  setExperienceSummary(experienceSummary: ExperienceSummary): void {
    if (this.session) {
      this.session.experienceSummary = experienceSummary;
      delete this.session.experienceSummaryError;
    }
  }

  setExperienceSummaryError(error: string): void {
    if (this.session) {
      this.session.experienceSummaryError = error;
    }
  }

  setPlan(plan: PlanState): void {
    this.plan = plan;

    if (this.session) {
      this.session.plan = plan;
      delete this.session.planningError;
    }
  }

  setPlanningError(error: string): void {
    this.planningError = error;

    if (this.session) {
      this.session.planningError = error;
    }
  }

  appendReflection(step: number, reflection: ReflectionState): void {
    const event: ReflectionEvent = {
      step,
      timestamp: new Date().toISOString(),
      reflection
    };
    this.reflections.push(event);

    if (this.session) {
      this.session.reflections = [...this.reflections];
    }
  }

  private async serializeObservation(
    step: number,
    observation: Observation,
    developerScreenshot?: {
      pngBase64: string;
      viewport: { w: number; h: number };
    },
    screenReaderArtifacts?: ScreenReaderTraceArtifacts
  ): Promise<RecordedObservation> {
    if (observation.kind !== "keyboard") {
      const recorded: RecordedObservation = {
        kind: "screenreader",
        announcement: observation.announcement,
        announcementCapture: observation.announcementCapture,
        announcementCount: observation.announcementCount,
        observeReason: observation.observeReason,
        readbacks: observation.readbacks,
        ...(screenReaderArtifacts?.domFocus
          ? { domFocus: serializeDomFocus(screenReaderArtifacts.domFocus) }
          : {}),
        ...(screenReaderArtifacts?.cursorScreenshot
          ? {
              cursorScreenshot: await serializeCursorScreenshot(
                step,
                screenReaderArtifacts.cursorScreenshot,
                this.screenshotsDir
              )
            }
          : {})
      };

      if (developerScreenshot) {
        recorded.screenshot = await serializeScreenshot(step, developerScreenshot, this.screenshotsDir);
      }

      return recorded;
    }

    return serializeKeyboardObservation(step, observation, this.screenshotsDir);
  }

  private async appendDiagnostics(
    step: number,
    screenReaderArtifacts?: ScreenReaderTraceArtifacts
  ): Promise<void> {
    const diagnostics: PendingDiagnosticEvent[] = [];
    if (screenReaderArtifacts?.domFocus?.status === "failed") {
      diagnostics.push(screenReaderArtifacts.domFocus.diagnostic);
    }
    if (
      screenReaderArtifacts?.cursorScreenshot?.status === "unsupported"
      || screenReaderArtifacts?.cursorScreenshot?.status === "failed"
    ) {
      diagnostics.push(screenReaderArtifacts.cursorScreenshot.diagnostic);
    }

    if (diagnostics.length === 0) {
      return;
    }

    for (const diagnostic of diagnostics) {
      await this.appendDiagnostic(step, diagnostic);
    }
  }
}

function serializeDomFocus(
  capture: ScreenReaderTraceArtifacts["domFocus"]
): RecordedScreenReaderDomFocus {
  if (!capture || capture.status === "failed") {
    return { status: "failed" };
  }

  return {
    status: "captured",
    ...capture.snapshot
  };
}

async function serializeCursorScreenshot(
  step: number,
  capture: NonNullable<ScreenReaderTraceArtifacts["cursorScreenshot"]>,
  screenshotsDir: string
): Promise<RecordedScreenReaderCursorScreenshot> {
  if (capture.status !== "captured") {
    return { status: capture.status };
  }

  const filename = `step-${String(step).padStart(3, "0")}-voiceover-cursor.png`;
  const relativePath = `screenshots/${filename}`;
  const absolutePath = join(screenshotsDir, filename);

  await copyFile(capture.sourcePath, absolutePath);

  return {
    status: "captured",
    path: relativePath
  };
}

export async function persistFinalizedTraceSession(session: TraceSession, outDir: string): Promise<void> {
  await writeFile(join(outDir, "trace.json"), JSON.stringify(session, null, 2), "utf8");
  await writeFile(join(outDir, "metrics.json"), JSON.stringify(session.aggregate, null, 2), "utf8");
}

async function serializeKeyboardObservation(
  step: number,
  observation: KeyboardObservation,
  screenshotsDir: string
): Promise<RecordedKeyboardObservation> {
  const recorded: RecordedKeyboardObservation = {
    kind: "keyboard",
    screenshot: await serializeScreenshot(step, observation.screenshot, screenshotsDir),
    browserChrome: observation.browserChrome,
    focusHint: observation.focusHint,
    scrollHint: observation.scrollHint
  };

  if (observation.previousScreenshot && step > 0) {
    recorded.previousScreenshot = {
      path: `screenshots/step-${String(step - 1).padStart(3, "0")}.png`
    };
  }

  if (observation.diffScreenshot) {
    recorded.diffScreenshot = await serializeDiffScreenshot(
      step,
      observation.diffScreenshot,
      screenshotsDir
    );
  }

  return recorded;
}

async function serializeDiffScreenshot(
  step: number,
  screenshot: {
    pngBase64: string;
    viewport: { w: number; h: number };
    changeRatio?: number;
  },
  screenshotsDir: string
): Promise<{ path: string; changeRatio?: number }> {
  const filename = `step-${String(step).padStart(3, "0")}-diff.png`;
  const relativePath = `screenshots/${filename}`;
  const absolutePath = join(screenshotsDir, filename);

  await writeFile(absolutePath, Buffer.from(screenshot.pngBase64, "base64"));

  return {
    path: relativePath,
    ...(screenshot.changeRatio !== undefined ? { changeRatio: screenshot.changeRatio } : {})
  };
}

async function serializeScreenshot(
  step: number,
  screenshot: {
    pngBase64: string;
    viewport: { w: number; h: number };
  },
  screenshotsDir: string
): Promise<{ path: string; viewport: { w: number; h: number } }> {
  const filename = `step-${String(step).padStart(3, "0")}.png`;
  const relativePath = `screenshots/${filename}`;
  const absolutePath = join(screenshotsDir, filename);

  await writeFile(absolutePath, Buffer.from(screenshot.pngBase64, "base64"));

  return {
    path: relativePath,
    viewport: screenshot.viewport
  };
}

function buildAggregate(
  steps: StepRecord[],
  startedAt: string,
  endedAt: string,
  endedBy: EndedBy,
  setupTimings: Omit<TraceAggregate["timings"], "reportMs">,
  reportMs: number,
  failureReasonOverride?: string
): TraceAggregate {
  const actionCounts = countActions(steps);
  const aggregate: TraceAggregate = {
    result: endedBy === "success" ? "success" : "failure",
    totalSteps: steps.length,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    timings: {
      setupMs: Math.max(0, setupTimings.setupMs),
      browserLaunchMs: Math.max(0, setupTimings.browserLaunchMs),
      pageLoadMs: Math.max(0, setupTimings.pageLoadMs),
      screenReaderInitMs: Math.max(0, setupTimings.screenReaderInitMs),
      firstAnnouncementWaitMs: Math.max(0, setupTimings.firstAnnouncementWaitMs),
      reportMs: Math.max(0, reportMs)
    },
    actionCounts,
    terminatedAtStep: steps.length > 0 ? steps[steps.length - 1].step : null,
    endedBy
  };

  if (endedBy !== "success" && (steps.length > 0 || failureReasonOverride)) {
    aggregate.failurePoint = {
      stepIndex: steps.length > 0 ? steps[steps.length - 1].step : -1,
      reason: failureReasonOverride ?? failureReason(endedBy, steps[steps.length - 1]!)
    };
  }

  return aggregate;
}

function countActions(steps: StepRecord[]): ActionCounts {
  return steps.reduce<ActionCounts>(
    (counts, step) => {
      if (!("action" in step.decision)) {
        return counts;
      }

      if ("srAction" in step.decision.action) {
        if ("extension" in step.decision.action.srAction) {
          counts.srInvokeCount += 1;
          return counts;
        }

        if (step.decision.action.srAction.semantic.startsWith("read.")) {
          counts.srReadCount += 1;
          return counts;
        }

        if (step.decision.action.srAction.semantic.startsWith("clear.")) {
          counts.srMaintenanceCount += 1;
          return counts;
        }

        counts.srInvokeCount += 1;
        return counts;
      }

      if ("key" in step.decision.action) {
        counts.rawKeyCount += 1;
        return counts;
      }

      counts.typeTextCount += 1;
      return counts;
    },
    {
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 0,
      typeTextCount: 0
    }
  );
}

function failureReason(endedBy: EndedBy, lastStep: StepRecord): string {
  switch (endedBy) {
    case "stuck":
      return "Agent reported that it could not progress further.";
    case "maxSteps":
      return "Task reached the configured maxSteps limit.";
    case "timeout":
      return "Task exceeded the configured timeout.";
    case "error":
      return lastStep.execution.error ?? "Task ended due to an execution error.";
    default:
      return "Task did not reach success.";
  }
}
