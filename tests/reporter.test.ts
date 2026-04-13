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
            },
            timings: {
              observeMs: 11,
              decideMs: 22,
              executeMs: 33,
              verifyMs: 0
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 5000,
          timings: {
            setupMs: 120,
            browserLaunchMs: 20,
            pageLoadMs: 30,
            screenReaderInitMs: 0,
            firstAnnouncementWaitMs: 0,
            reportMs: 45
          },
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
    expect(html).toContain("Observe: 11 ms");
    expect(html).toContain("Setup");
    expect(html).toContain("Browser launch");
  });

  it("renders screenreader-hybrid actions in the HTML report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-screenreader-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "screenreader-task",
          url: "file:///screenreader-task.html",
          goal: "Move to the next announced item.",
          mode: "screenreader-hybrid",
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
              announcement: "Get started button",
              announcementCapture: "log",
              announcementCount: 1,
              observeReason: "silence",
              screenshot: {
                path: "screenshots/step-000.png",
                viewport: { w: 1280, h: 800 }
              }
            },
            decision: {
              action: { srCommand: "nextItem" },
              rationale: "Move the VoiceOver cursor forward."
            },
            execution: {
              ok: true,
              costDelta: 1
            },
            timings: {
              observeMs: 10,
              decideMs: 20,
              executeMs: 30,
              verifyMs: 0
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 3000,
          timings: {
            setupMs: 100,
            browserLaunchMs: 10,
            pageLoadMs: 20,
            screenReaderInitMs: 30,
            firstAnnouncementWaitMs: 40,
            reportMs: 40
          },
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
    expect(html).toContain("Announcement capture");
    expect(html).toContain("log");
    expect(html).toContain("Announcement count");
    expect(html).toContain("Observe reason");
    expect(html).toContain("silence");
    expect(html).toContain("../screenshots/step-000.png");
    expect(html).not.toContain("No screenshot");
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
            timings: {
              observeMs: 12,
              decideMs: 24,
              executeMs: 0,
              verifyMs: 18
            },
            verification: {
              passed: false,
              failures: ['Verification failed: expected visible text "Started!" was not observed.']
            },
            verdictAnalysis: {
              agentVerdict: "success",
              verificationResult: "failed",
              finalResult: "continued",
              completionSource: "agent"
            }
          }
        ],
        aggregate: {
          result: "failure",
          totalSteps: 1,
          durationMs: 5000,
          timings: {
            setupMs: 130,
            browserLaunchMs: 13,
            pageLoadMs: 26,
            screenReaderInitMs: 0,
            firstAnnouncementWaitMs: 0,
            reportMs: 55
          },
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
    expect(html).toContain("Agent verdict");
    expect(html).toContain("Final result at this step");
    expect(html).toContain("Completion source");
    expect(html).toContain("expected visible text");
    expect(html).toContain("Verified success was not reached");
  });

  it("renders verifier auto-complete steps without an agent verdict", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-auto-complete-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "auto-complete-task",
          url: "file:///auto-complete-task.html",
          goal: "Finish via verifier auto-complete.",
          mode: "screenreader-hybrid",
          maxSteps: 2,
          timeoutMs: 1000,
          verify: {
            all: [{ textVisible: "Started!" }]
          }
        },
        startedAt: "2026-04-12T00:00:00.000Z",
        endedAt: "2026-04-12T00:00:02.000Z",
        steps: [
          {
            step: 0,
            timestamp: "2026-04-12T00:00:01.000Z",
            observation: {
              kind: "screenreader",
              announcement: "Started!",
              announcementCapture: "log",
              announcementCount: 1,
              observeReason: "silence"
            },
            decision: {
              action: { srCommand: "act" }
            },
            execution: {
              ok: true,
              costDelta: 1
            },
            timings: {
              observeMs: 10,
              decideMs: 20,
              executeMs: 30,
              verifyMs: 15
            },
            verification: {
              passed: true,
              failures: []
            },
            verdictAnalysis: {
              verificationResult: "passed",
              finalResult: "success",
              completionSource: "verifier-auto-complete"
            }
          }
        ],
        aggregate: {
          result: "success",
          totalSteps: 1,
          durationMs: 2000,
          timings: {
            setupMs: 100,
            browserLaunchMs: 10,
            pageLoadMs: 20,
            screenReaderInitMs: 30,
            firstAnnouncementWaitMs: 40,
            reportMs: 20
          },
          actionCounts: {
            srCommandCount: 1,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: 0,
          endedBy: "success"
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("not-declared");
    expect(html).toContain("verifier-auto-complete");
    expect(html).not.toContain("<p>undefined</p>");
  });

  it("renders experience summary when present", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-summary-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "summary-task",
          url: "file:///summary-task.html",
          goal: "Finish and summarize.",
          mode: "keyboard",
          maxSteps: 1,
          timeoutMs: 1000
        },
        startedAt: "2026-04-12T00:00:00.000Z",
        endedAt: "2026-04-12T00:00:01.000Z",
        steps: [],
        aggregate: {
          result: "success",
          totalSteps: 0,
          durationMs: 1000,
          timings: {
            setupMs: 10,
            browserLaunchMs: 1,
            pageLoadMs: 2,
            screenReaderInitMs: 0,
            firstAnnouncementWaitMs: 0,
            reportMs: 0
          },
          actionCounts: {
            srCommandCount: 0,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: null,
          endedBy: "success"
        },
        experienceSummary: {
          overall: "The run finished directly.",
          biggestFriction: "The initial direction was slightly unclear.",
          nextChecks: ["Check the initial guidance.", "Check the feedback after interaction."]
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Experience summary");
    expect(html).toContain("The run finished directly.");
    expect(html).toContain("Check the initial guidance.");
  });
});
