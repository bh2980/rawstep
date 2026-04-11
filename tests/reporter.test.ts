import { renderReport } from "@a11y-task/reporter";
import type { TraceSession } from "@a11y-task/core";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("reporter", () => {
  it("renders task text input actions in the HTML report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-type-text-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "type-text-task",
          url: "file:///type-text-task.html",
          goal: "Type the fixed task text.",
          mode: "keyboard",
          maxSteps: 2,
          timeoutMs: 1000,
          input: { text: "passport" }
        },
        startedAt: "2026-04-12T00:00:00.000Z",
        endedAt: "2026-04-12T00:00:05.000Z",
        steps: [
          {
            step: 0,
            timestamp: "2026-04-12T00:00:01.000Z",
            observation: {
              kind: "keyboard",
              screenshot: {
                path: "screenshots/step-000.png",
                viewport: { w: 1280, h: 800 }
              },
              browserChrome: {
                title: "Search Fixture",
                urlPath: "/fixture"
              },
              scrollHint: "top"
            },
            decision: {
              action: { typeText: "task" },
              rationale: "Type the provided task text."
            },
            execution: {
              ok: true,
              costDelta: 1
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 5000,
          actionCounts: {
            srCommandCount: 0,
            rawKeyCount: 0,
            typeTextCount: 1
          },
          terminatedAtStep: 0,
          endedBy: "maxSteps"
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("typeText(task)");
    expect(html).toContain("typeTextCount");
  });

  it("renders screenreader actions in the HTML report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-screenreader-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "screenreader-task",
          url: "file:///screenreader-task.html",
          goal: "Move to the next announced item.",
          mode: "screenreader",
          maxSteps: 2,
          timeoutMs: 1000
        },
        startedAt: "2026-04-12T00:00:00.000Z",
        endedAt: "2026-04-12T00:00:03.000Z",
        steps: [
          {
            step: 0,
            timestamp: "2026-04-12T00:00:01.000Z",
            observation: {
              kind: "screenreader",
              announcement: "Get started button"
            },
            decision: {
              action: { srCommand: "nextItem" },
              rationale: "Move the VoiceOver cursor forward."
            },
            execution: {
              ok: true,
              costDelta: 1
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 3000,
          actionCounts: {
            srCommandCount: 1,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: 0,
          endedBy: "maxSteps"
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("srCommand(nextItem)");
    expect(html).toContain("Get started button");
  });

  it("renders verification results in the HTML report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "verified-task",
          url: "file:///verified-task.html",
          goal: "Finish with verified success.",
          mode: "keyboard",
          maxSteps: 2,
          timeoutMs: 1000,
          verify: {
            all: [{ textVisible: "Started!" }]
          }
        },
        startedAt: "2026-04-12T00:00:00.000Z",
        endedAt: "2026-04-12T00:00:05.000Z",
        steps: [
          {
            step: 0,
            timestamp: "2026-04-12T00:00:03.000Z",
            observation: {
              kind: "keyboard",
              screenshot: {
                path: "screenshots/step-000.png",
                viewport: { w: 1280, h: 800 }
              },
              browserChrome: {
                title: "Simple CTA Fixture",
                urlPath: "/fixture"
              },
              scrollHint: "top"
            },
            decision: {
              verdict: "success",
              rationale: "Looks done."
            },
            execution: {
              ok: true,
              costDelta: 0
            },
            verification: {
              passed: false,
              failures: ['Verification failed: expected visible text "Started!" was not observed.']
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 5000,
          actionCounts: {
            srCommandCount: 0,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: 0,
          endedBy: "stuck",
          failurePoint: {
            stepIndex: 0,
            reason: 'Verified success was not reached: Verification failed: expected visible text "Started!" was not observed.'
          }
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Verification: <code>failed</code>");
    expect(html).toContain("expected visible text");
    expect(html).toContain("Verified success was not reached");
  });
});
