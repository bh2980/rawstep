import {
  createEmptyKeyCounts,
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
    verification?: VerificationRecord
  ): Promise<void> {
    const recordedObservation = await this.serializeObservation(step, observation);
    const record: StepRecord = {
      step,
      timestamp: new Date().toISOString(),
      observation: recordedObservation,
      decision,
      execution,
      verification
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
    keyCounts = createEmptyKeyCounts(),
    failureReasonOverride?: string
  ): Promise<TraceSession> {
    const aggregate = buildAggregate(this.steps, endedBy, keyCounts, failureReasonOverride);
    const session: TraceSession = {
      task: this.task,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      steps: [...this.steps],
      aggregate
    };

    this.session = session;
    await writeFile(this.traceJsonPath, JSON.stringify(session, null, 2), "utf8");
    await writeFile(this.metricsPath, JSON.stringify(aggregate, null, 2), "utf8");
    return session;
  }

  getSession(): TraceSession {
    if (!this.session) {
      throw new Error("Trace session has not been finalized yet.");
    }

    return this.session;
  }

  private async serializeObservation(step: number, observation: Observation): Promise<RecordedObservation> {
    if (observation.kind !== "keyboard") {
      return {
        kind: "screenreader",
        announcement: observation.announcement
      };
    }

    return serializeKeyboardObservation(step, observation, this.screenshotsDir);
  }
}

async function serializeKeyboardObservation(
  step: number,
  observation: KeyboardObservation,
  screenshotsDir: string
): Promise<RecordedKeyboardObservation> {
  const filename = `step-${String(step).padStart(3, "0")}.png`;
  const relativePath = `screenshots/${filename}`;
  const absolutePath = join(screenshotsDir, filename);

  await writeFile(absolutePath, Buffer.from(observation.screenshot.pngBase64, "base64"));

  return {
    kind: "keyboard",
    screenshot: {
      path: relativePath,
      viewport: observation.screenshot.viewport
    },
    browserChrome: observation.browserChrome,
    scrollHint: observation.scrollHint
  };
}

function buildAggregate(
  steps: StepRecord[],
  endedBy: EndedBy,
  keyCounts: TraceAggregate["keyCounts"],
  failureReasonOverride?: string
): TraceAggregate {
  const totalKeystrokes = steps.reduce((sum, step) => sum + step.execution.costDelta, 0);
  const aggregate: TraceAggregate = {
    totalSteps: steps.length,
    totalKeystrokes,
    keyCounts,
    reachedGoal: endedBy === "success",
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
