import type { KeyboardObservation, Task } from "@a11y-task/core";
import { TraceRecorder } from "@a11y-task/trace";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TraceRecorder", () => {
  it("writes jsonl, metrics, and screenshot files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-trace-"));
    const task: Task = {
      id: "trace-test",
      url: "file:///trace-test.html",
      goal: "Trace one step.",
      mode: "keyboard",
      maxSteps: 2,
      timeoutMs: 1000
    };

    const recorder = new TraceRecorder(task, outDir);
    await recorder.initialize();

    const observation: KeyboardObservation = {
      kind: "keyboard",
      screenshot: {
        pngBase64: Buffer.from("fake-png").toString("base64"),
        viewport: { w: 1280, h: 800 }
      },
      browserChrome: {
        title: "Trace fixture",
        urlPath: "/trace"
      },
      scrollHint: "top"
    };

    await recorder.append(
      0,
      observation,
      { action: { key: "Tab" }, rationale: "Move focus." },
      { ok: true, costDelta: 1 }
    );

    await recorder.append(
      1,
      observation,
      { action: { typeText: "task" }, rationale: "Type the task text." },
      { ok: true, costDelta: 1 }
    );

    const session = await recorder.finalize("stuck");

    expect(session.aggregate.result).toBe("failure");
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 0,
      rawKeyCount: 1,
      typeTextCount: 1
    });
    expect(session.aggregate.terminatedAtStep).toBe(1);
    expect(session.aggregate.durationMs).toBeGreaterThanOrEqual(0);
    expect(session.aggregate.failurePoint?.stepIndex).toBe(1);

    const jsonl = await readFile(join(outDir, "trace.jsonl"), "utf8");
    expect(jsonl.trim().split("\n")).toHaveLength(2);

    await expect(stat(join(outDir, "screenshots", "step-000.png"))).resolves.toBeTruthy();
    const metrics = JSON.parse(await readFile(join(outDir, "metrics.json"), "utf8")) as { endedBy: string };
    expect(metrics.endedBy).toBe("stuck");
  });

  it("writes developer screenshots for screenreader observations without exposing them to the agent path", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-trace-screenreader-"));
    const task: Task = {
      id: "trace-screenreader-test",
      url: "file:///trace-screenreader-test.html",
      goal: "Trace one screenreader step.",
      mode: "screenreader-strict",
      maxSteps: 1,
      timeoutMs: 1000
    };

    const recorder = new TraceRecorder(task, outDir);
    await recorder.initialize();

    await recorder.append(
      0,
      {
        kind: "screenreader",
        announcement: "Get started button"
      },
      { action: { srCommand: "nextItem" }, rationale: "Move to the next item." },
      { ok: true, costDelta: 1 },
      undefined,
      {
        pngBase64: Buffer.from("fake-sr-png").toString("base64"),
        viewport: { w: 1280, h: 800 }
      }
    );

    const session = await recorder.finalize("success");

    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot?.path).toBe("screenshots/step-000.png");
    }
    await expect(stat(join(outDir, "screenshots", "step-000.png"))).resolves.toBeTruthy();
  });
});
