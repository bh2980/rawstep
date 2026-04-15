import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Action,
  ExecutionRecord,
  ScreenReaderBackendId,
  ScreenReaderObservation
} from "@rawstep/definition";
import type { ScreenReaderController } from "../actuator";

type ScreenReaderDebugPhase = "before-observe" | "after-observe" | "after-action" | "probe-error";

type ScreenReaderDebugEntry = {
  at: string;
  relativeMs: number;
  step: number;
  phase: ScreenReaderDebugPhase;
  action?: Action;
  execution?: {
    ok: boolean;
    error?: string;
    costDelta: number;
  };
  observation?: {
    announcement: string;
    announcementCapture: "log" | "fallback" | "none";
    announcementCount?: number;
    observeReason?: "silence" | "timeout" | "fallback";
  };
  probe?: {
    spokenPhraseLog: string[];
    lastSpokenPhrase: string;
  };
  error?: string;
};

export class ScreenReaderDebugRecorder {
  private readonly startedAt = Date.now();
  private readonly entries: ScreenReaderDebugEntry[] = [];

  constructor(
    private readonly outDir: string,
    private readonly backendId?: ScreenReaderBackendId
  ) {}

  async capture(args: {
    step: number;
    phase: Exclude<ScreenReaderDebugPhase, "probe-error">;
    controller?: ScreenReaderController;
    action?: Action;
    execution?: ExecutionRecord;
    observation?: ScreenReaderObservation;
  }): Promise<void> {
    if (!args.controller) {
      return;
    }

    try {
      const [spokenPhraseLogResult, lastSpokenPhraseResult] = await Promise.all([
        args.controller.execute({ semantic: "read.spokenPhraseLog" }),
        args.controller.execute({ semantic: "read.lastSpokenPhrase" })
      ]);

      this.entries.push({
        at: new Date().toISOString(),
        relativeMs: Date.now() - this.startedAt,
        step: args.step,
        phase: args.phase,
        action: args.action,
        execution: args.execution
          ? {
              ok: args.execution.ok,
              error: args.execution.error,
              costDelta: args.execution.costDelta
            }
          : undefined,
        observation: args.observation
          ? {
              announcement: args.observation.announcement,
              announcementCapture: args.observation.announcementCapture,
              announcementCount: args.observation.announcementCount,
              observeReason: args.observation.observeReason
            }
          : undefined,
        probe: {
          spokenPhraseLog: asStringArray(spokenPhraseLogResult.readResult?.value),
          lastSpokenPhrase: asString(lastSpokenPhraseResult.readResult?.value)
        }
      });
    } catch (error) {
      this.entries.push({
        at: new Date().toISOString(),
        relativeMs: Date.now() - this.startedAt,
        step: args.step,
        phase: "probe-error",
        action: args.action,
        execution: args.execution
          ? {
              ok: args.execution.ok,
              error: args.execution.error,
              costDelta: args.execution.costDelta
            }
          : undefined,
        observation: args.observation
          ? {
              announcement: args.observation.announcement,
              announcementCapture: args.observation.announcementCapture,
              announcementCount: args.observation.announcementCount,
              observeReason: args.observation.observeReason
            }
          : undefined,
        error: getErrorMessage(error)
      });
    }
  }

  async persist(): Promise<void> {
    if (!this.backendId && this.entries.length === 0) {
      return;
    }

    await writeFile(
      join(this.outDir, "screenreader-debug.json"),
      JSON.stringify(
        {
          backendId: this.backendId,
          capturedAt: new Date().toISOString(),
          entries: this.entries
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function asStringArray(value: string | string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function asString(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
