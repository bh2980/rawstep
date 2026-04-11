import {
  type ActionCounts,
  type AgentHistoryEntry,
  type Decision,
  type EndedBy,
  type ExecutionRecord,
  type KeyboardObservation,
  type Observation,
  type RecordedKeyboardObservation,
  type RecordedObservation,
  type StepRecord,
  type Task,
  type TraceAggregate,
  type TraceSession,
  type VerdictAnalysis,
  type VerificationRecord
} from "@a11y-task/core";
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class TraceRecorder {
  private readonly startedAt = new Date().toISOString();
  private readonly traceJsonlPath: string;
  private readonly traceJsonPath: string;
  private readonly metricsPath: string;
  private readonly screenshotsDir: string;
  private readonly steps: StepRecord[] = [];
  private session?: TraceSession;
  private setupTimings: Omit<TraceAggregate["timings"], "reportMs"> = {
    setupMs: 0,
    browserLaunchMs: 0,
    pageLoadMs: 0,
    voiceOverInitMs: 0,
    firstAnnouncementWaitMs: 0
  };
  private reportMs = 0;

  constructor(
    private readonly task: Task,
    private readonly outDir: string
  ) {
    this.traceJsonlPath = join(outDir, "trace.jsonl");
    this.traceJsonPath = join(outDir, "trace.json");
    this.metricsPath = join(outDir, "metrics.json");
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
    }
  ): Promise<void> {
    const recordedObservation = await this.serializeObservation(step, observation, developerScreenshot);
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
  }

  recentDecisions(limit: number): AgentHistoryEntry[] {
    return this.steps.slice(-limit).map((step) => ({
      stepIndex: step.step,
      source: "agent",
      action: "action" in step.decision ? step.decision.action : undefined,
      rationale: step.decision.rationale
    }));
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
      aggregate
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

  setSetupTimings(timings: Omit<TraceAggregate["timings"], "reportMs">): void {
    this.setupTimings = {
      setupMs: Math.max(0, timings.setupMs),
      browserLaunchMs: Math.max(0, timings.browserLaunchMs),
      pageLoadMs: Math.max(0, timings.pageLoadMs),
      voiceOverInitMs: Math.max(0, timings.voiceOverInitMs),
      firstAnnouncementWaitMs: Math.max(0, timings.firstAnnouncementWaitMs)
    };
  }

  setReportMs(durationMs: number): void {
    this.reportMs = Math.max(0, durationMs);

    if (this.session) {
      this.session.aggregate.timings.reportMs = this.reportMs;
    }
  }

  private async serializeObservation(
    step: number,
    observation: Observation,
    developerScreenshot?: {
      pngBase64: string;
      viewport: { w: number; h: number };
    }
  ): Promise<RecordedObservation> {
    if (observation.kind !== "keyboard") {
      const recorded: RecordedObservation = {
        kind: "screenreader",
        announcement: observation.announcement,
        announcementCapture: observation.announcementCapture,
        announcementCount: observation.announcementCount,
        observeReason: observation.observeReason
      };

      if (developerScreenshot) {
        recorded.screenshot = await serializeScreenshot(step, developerScreenshot, this.screenshotsDir);
      }

      return recorded;
    }

    return serializeKeyboardObservation(step, observation, this.screenshotsDir);
  }
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
  return {
    kind: "keyboard",
    screenshot: await serializeScreenshot(step, observation.screenshot, screenshotsDir),
    browserChrome: observation.browserChrome,
    scrollHint: observation.scrollHint
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
      voiceOverInitMs: Math.max(0, setupTimings.voiceOverInitMs),
      firstAnnouncementWaitMs: Math.max(0, setupTimings.firstAnnouncementWaitMs),
      reportMs: Math.max(0, reportMs)
    },
    actionCounts,
    terminatedAtStep: steps.length > 0 ? steps[steps.length - 1].step : null,
    endedBy
  };

  if (endedBy !== "success" && steps.length > 0) {
    aggregate.failurePoint = {
      stepIndex: steps[steps.length - 1].step,
      reason: failureReasonOverride ?? failureReason(endedBy, steps[steps.length - 1])
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

      if ("srCommand" in step.decision.action) {
        counts.srCommandCount += 1;
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
      srCommandCount: 0,
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
