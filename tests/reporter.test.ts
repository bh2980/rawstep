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
          totalSteps: 1,
          totalKeystrokes: 1,
          keyCounts: {
            Tab: 0,
            "Shift+Tab": 0,
            ArrowUp: 0,
            ArrowDown: 0,
            ArrowLeft: 0,
            ArrowRight: 0,
            Enter: 0,
            Space: 0,
            Escape: 0
          },
          reachedGoal: false,
          endedBy: "maxSteps"
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("typeText(task)");
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
          totalSteps: 1,
          totalKeystrokes: 0,
          keyCounts: {
            Tab: 0,
            "Shift+Tab": 0,
            ArrowUp: 0,
            ArrowDown: 0,
            ArrowLeft: 0,
            ArrowRight: 0,
            Enter: 0,
            Space: 0,
            Escape: 0
          },
          reachedGoal: false,
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
