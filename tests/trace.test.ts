import type { KeyboardObservation, ResolvedTask } from "@rawstep/definition";
import { TraceRecorder } from "@rawstep/runtime";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TraceRecorder", () => {
  it("writes jsonl, metrics, and screenshot files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-trace-"));
    const task: ResolvedTask = {
      id: "trace-test",
      url: "file:///trace-test.html",
      goal: "Trace one step.",
      mode: "keyboard",
      maxSteps: 2,
      timeoutMs: 1000,
      verify: {
        all: [{ titleIncludes: "Trace fixture" }]
      }
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
      focusHint: 'button "Continue"',
      scrollHint: "top"
    };

    await recorder.append(
      0,
      observation,
      { action: { key: "Tab" }, rationale: "Move focus." },
      { ok: true, costDelta: 1 },
      { observeMs: 10, decideMs: 20, executeMs: 30, verifyMs: 0 }
    );

    await recorder.append(
      1,
      observation,
      { action: { typeText: "email" }, rationale: "Type the email input." },
      { ok: true, costDelta: 1 },
      { observeMs: 11, decideMs: 21, executeMs: 31, verifyMs: 0 }
    );

    recorder.setSetupTimings({
      setupMs: 123,
      browserLaunchMs: 23,
      pageLoadMs: 34,
      screenReaderInitMs: 0,
      firstAnnouncementWaitMs: 0
    });
    const session = await recorder.finalize("stuck");

    expect(session.aggregate.result).toBe("failure");
    expect(session.steps[0].timings).toEqual({
      observeMs: 10,
      decideMs: 20,
      executeMs: 30,
      verifyMs: 0
    });
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 1,
      typeTextCount: 1
    });
    expect(session.aggregate.timings).toEqual({
      setupMs: 123,
      browserLaunchMs: 23,
      pageLoadMs: 34,
      screenReaderInitMs: 0,
      firstAnnouncementWaitMs: 0,
      reportMs: 0
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
    const task: ResolvedTask = {
      id: "trace-screenreader-test",
      url: "file:///trace-screenreader-test.html",
      goal: "Trace one screenreader step.",
      mode: "screenreader-strict",
      maxSteps: 1,
      timeoutMs: 1000,
      verify: {
        all: [{ textVisible: "Get started button" }]
      }
    };

    const recorder = new TraceRecorder(task, outDir);
    await recorder.initialize();

    await recorder.append(
      0,
      {
        kind: "screenreader",
        announcement: "Get started button",
        announcementCapture: "log",
        announcementCount: 1,
        observeReason: "silence"
      },
      {
        action: {
          srAction: {
            semantic: "heading.next"
          }
        },
        rationale: "Move to the next item."
      },
      { ok: true, costDelta: 1 },
      { observeMs: 9, decideMs: 19, executeMs: 29, verifyMs: 0 },
      undefined,
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
      expect(session.steps[0].observation.announcementCapture).toBe("log");
      expect(session.steps[0].observation.announcementCount).toBe(1);
      expect(session.steps[0].observation.observeReason).toBe("silence");
    }
    await expect(stat(join(outDir, "screenshots", "step-000.png"))).resolves.toBeTruthy();
  });
});
