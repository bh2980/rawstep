import { publishRunOutputs, renderReport } from "@rawstep/reporter";
import type { TraceSession } from "@rawstep/definition";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("reporter", () => {
  it("renders named input actions in the HTML report", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-type-text-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "type-text-task",
          url: "file:///type-text-task.html",
          goal: "Type the fixed email input.",
          mode: "keyboard",
          maxSteps: 2,
          timeoutMs: 1000,
          input: { email: "passport" },
          verify: {
            all: [{ titleIncludes: "Search Fixture" }]
          }
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
              action: { typeText: "email" },
              rationale: "Type the provided email input."
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
            srInvokeCount: 0,
            srReadCount: 0,
            srMaintenanceCount: 0,
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
    expect(html).toContain("typeText(email)");
    expect(html).toContain("typeTextCount");
    expect(html).toContain("Observe: 11 ms");
    expect(html).toContain("Setup");
    expect(html).toContain("Browser launch");
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
          timeoutMs: 1000,
          verify: {
            all: [{ textVisible: "Get started button" }]
          }
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
              action: {
                srAction: {
                  semantic: "heading.next"
                }
              },
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
            srInvokeCount: 1,
            srReadCount: 0,
            srMaintenanceCount: 0,
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
    expect(html).toContain("sr.heading.next");
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
            srInvokeCount: 0,
            srReadCount: 0,
            srMaintenanceCount: 0,
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
          mode: "screenreader",
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
              action: { srAction: { semantic: "click" } }
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
            srInvokeCount: 1,
            srReadCount: 0,
            srMaintenanceCount: 0,
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
          timeoutMs: 1000,
          verify: {
            all: [{ titleIncludes: "summary-task" }]
          }
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
            srInvokeCount: 0,
            srReadCount: 0,
            srMaintenanceCount: 0,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: null,
          endedBy: "success"
        },
        experienceSummary: {
          overall: "The run finished directly.",
          blockers: ["The initial direction was slightly unclear."],
          surprise: "The feedback appeared immediately after the action.",
          oneLineFeel: "Direct run with one small hesitation."
        }
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Experience summary");
    expect(html).toContain("The run finished directly.");
    expect(html).toContain("The initial direction was slightly unclear.");
    expect(html).toContain("Direct run with one small hesitation.");
  });

  it("renders an experience summary warning when summary generation fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-summary-error-"));
    const reportPath = await renderReport(
      {
        task: {
          id: "summary-error-task",
          url: "file:///summary-error-task.html",
          goal: "Render a summary warning.",
          mode: "keyboard",
          maxSteps: 1,
          timeoutMs: 1000,
          verify: {
            all: [{ titleIncludes: "summary-error-task" }]
          }
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
            srInvokeCount: 0,
            srReadCount: 0,
            srMaintenanceCount: 0,
            rawKeyCount: 0,
            typeTextCount: 0
          },
          terminatedAtStep: null,
          endedBy: "success"
        },
        experienceSummaryError: "summary parser mismatch"
      } satisfies TraceSession,
      outDir
    );

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Experience summary unavailable: summary parser mismatch");
  });

  it("publishes CLI-facing output files and summary text", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-publish-"));
    const session = {
      task: {
        id: "publish-task",
        url: "file:///publish-task.html",
        goal: "Write report artifacts.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 1000,
        verify: {
          all: [{ titleIncludes: "publish-task" }]
        }
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
          srInvokeCount: 0,
          srReadCount: 0,
          srMaintenanceCount: 0,
          rawKeyCount: 0,
          typeTextCount: 0
        },
        terminatedAtStep: null,
        endedBy: "success"
      }
    } satisfies TraceSession;

    const published = await publishRunOutputs(session, outDir, [{
      kind: "decision",
      systemPrompt: "system",
      userPromptText: "user"
    }]);

    await expect(access(join(outDir, "trace.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "metrics.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "prompts.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "report", "index.html"))).resolves.toBeUndefined();
    expect(published.summaryText).toContain("Task publish-task finished with success.");
    expect(published.summaryText).toContain(join(outDir, "metrics.json"));
    expect(published.outputPaths.traceJson).toBe(join(outDir, "trace.json"));
    expect(published.outputPaths.reportHtml).toBe(join(outDir, "report", "index.html"));
    expect(session.aggregate.timings.reportMs).toBeGreaterThanOrEqual(0);

    const prompts = JSON.parse(await readFile(join(outDir, "prompts.json"), "utf8")) as Array<{ kind: string }>;
    expect(prompts).toEqual([{ kind: "decision", systemPrompt: "system", userPromptText: "user" }]);
  });
});
