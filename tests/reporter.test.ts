import { publishRunOutputs, renderReport } from "@rawstep/reporter";
import type { StepRecord, TraceSession } from "@rawstep/definition";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function render(session: TraceSession): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-"));
  const reportPath = await renderReport(session, outDir);
  return readFile(reportPath, "utf8");
}

function makeKeyboardStep(step: number, overrides: Partial<StepRecord> = {}): StepRecord {
  const base: StepRecord = {
    step,
    timestamp: `2026-04-12T00:00:0${Math.min(step + 1, 9)}.000Z`,
    observation: {
      kind: "keyboard",
      screenshot: {
        path: `screenshots/step-${String(step).padStart(3, "0")}.png`,
        viewport: { w: 1280, h: 800 },
      },
      browserChrome: {
        title: `Fixture ${step}`,
        urlPath: `/fixture/${step}`,
      },
      focusHint: step % 2 === 0 ? `focus-${step}` : undefined,
      scrollHint: "top",
    },
    decision: {
      action: { key: "Tab" },
      rationale: `step ${step} rationale`,
    },
    execution: {
      ok: true,
      costDelta: 1,
    },
    timings: {
      observeMs: 10 + step,
      decideMs: 20 + step,
      executeMs: 30 + step,
      verifyMs: 0,
    },
  };

  return {
    ...base,
    ...overrides,
    observation: {
      ...base.observation,
      ...(overrides.observation as Partial<typeof base.observation> | undefined),
    },
    execution: {
      ...base.execution,
      ...(overrides.execution ?? {}),
    },
    timings: {
      ...base.timings,
      ...(overrides.timings ?? {}),
    },
  };
}

function makeScreenReaderStep(step: number, overrides: Partial<StepRecord> = {}): StepRecord {
  const base: StepRecord = {
    step,
    timestamp: `2026-04-12T00:00:0${Math.min(step + 1, 9)}.000Z`,
    observation: {
      kind: "screenreader",
      announcement: `announcement ${step}`,
      announcementCapture: "log",
      announcementCount: 1,
      observeReason: "silence",
      screenshot: {
        path: `screenshots/sr-${String(step).padStart(3, "0")}.png`,
        viewport: { w: 1280, h: 800 },
      },
    },
    decision: {
      action: {
        srAction: {
          semantic: "heading.next",
        },
      },
      rationale: `sr step ${step} rationale`,
    },
    execution: {
      ok: true,
      costDelta: 1,
    },
    timings: {
      observeMs: 12 + step,
      decideMs: 2400 + step,
      executeMs: 22 + step,
      verifyMs: 0,
    },
  };

  return {
    ...base,
    ...overrides,
    observation: {
      ...base.observation,
      ...(overrides.observation as Partial<typeof base.observation> | undefined),
    },
    execution: {
      ...base.execution,
      ...(overrides.execution ?? {}),
    },
    timings: {
      ...base.timings,
      ...(overrides.timings ?? {}),
    },
  };
}

function makeSession(
  steps: StepRecord[],
  overrides: Partial<TraceSession> = {}
): TraceSession {
  const aggregate: TraceSession["aggregate"] = {
    result: "failure",
    totalSteps: steps.length,
    durationMs: 5000,
    timings: {
      setupMs: 120,
      browserLaunchMs: 20,
      pageLoadMs: 30,
      screenReaderInitMs: 0,
      firstAnnouncementWaitMs: 0,
      reportMs: 45,
    },
    actionCounts: {
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: steps.filter((step) => "action" in step.decision && "key" in step.decision.action).length,
      typeTextCount: steps.filter((step) => "action" in step.decision && "typeText" in step.decision.action).length,
    },
    terminatedAtStep: steps.length > 0 ? steps[steps.length - 1]!.step : null,
    endedBy: "maxSteps",
  };

  return {
    task: {
      id: "report-task",
      url: "file:///report-task.html",
      goal: "Review the page",
      mode: "keyboard",
      maxSteps: 10,
      timeoutMs: 1000,
      verify: {
        all: [{ titleIncludes: "Fixture" }],
      },
    },
    startedAt: "2026-04-12T00:00:00.000Z",
    endedAt: "2026-04-12T00:00:05.000Z",
    steps,
    aggregate,
    ...overrides,
    task: {
      id: "report-task",
      url: "file:///report-task.html",
      goal: "Review the page",
      mode: "keyboard",
      maxSteps: 10,
      timeoutMs: 1000,
      verify: {
        all: [{ titleIncludes: "Fixture" }],
      },
      ...(overrides.task ?? {}),
    },
    aggregate: {
      ...aggregate,
      ...(overrides.aggregate ?? {}),
      timings: {
        ...aggregate.timings,
        ...(overrides.aggregate?.timings ?? {}),
      },
      actionCounts: {
        ...aggregate.actionCounts,
        ...(overrides.aggregate?.actionCounts ?? {}),
      },
    },
  };
}

describe("reporter", () => {
  it("renders summary first with minimap, filters, and panel shell", async () => {
    const steps = [
      makeKeyboardStep(0),
      makeKeyboardStep(1, {
        verification: {
          passed: false,
          failures: ['button[type="submit"] not reachable via Tab'],
        },
      }),
      makeKeyboardStep(2, {
        decision: {
          verdict: "stuck",
          rationale: "더 이상 진행할 수 없다.",
        },
        execution: {
          ok: true,
          costDelta: 0,
        },
      }),
    ];

    const html = await render(
      makeSession(steps, {
        aggregate: {
          endedBy: "stuck",
          failurePoint: {
            stepIndex: 1,
            reason: 'button[type="submit"] not reachable via Tab',
          },
        },
        experienceSummary: {
          overall: "로그인 버튼까지 가지 못했다.",
          blockers: ["submit 버튼 접근 불가"],
          surprise: "첫 입력 전부터 focus 흐름이 깨졌다.",
          oneLineFeel: "첫 진입부터 막히는 화면이었다.",
        },
      })
    );

    expect(html.indexOf('id="experience-summary"')).toBeLessThan(html.indexOf('id="overview-flow"'));
    expect(html).toContain('id="step-minimap"');
    expect(html.indexOf('data-filter-tab="all"')).toBeLessThan(html.indexOf('data-filter-tab="important"'));
    expect(html).toContain('data-filter-tab="all"');
    expect(html).toContain('class="failure-marker-halo"');
    expect(html).toContain('id="detail-panel"');
    expect(html).toContain("첫 진입부터 막히는 화면이었다.");
    const initialMarkup = html.split("<script>")[0]!;
    const start = initialMarkup.indexOf('id="experience-summary"');
    const end = initialMarkup.indexOf("</section>", start);
    const summarySection = initialMarkup.slice(start, end);
    expect(summarySection).toContain('class="summary-note tone-failure"');
    expect(summarySection).toContain('class="summary-note tone-neutral"');
    expect(summarySection).not.toContain('<span class="pill tone-failure">');
  });

  it("renders a compact summary when blockers and surprise are empty", async () => {
    const html = await render(
      makeSession([], {
        aggregate: {
          result: "success",
          endedBy: "success",
          totalSteps: 0,
          terminatedAtStep: null,
        },
        experienceSummary: {
          overall: "바로 성공 메시지까지 도달했다.",
          blockers: [],
          surprise: null,
          oneLineFeel: "막힘 없이 끝났다.",
        },
      })
    );
    const initialMarkup = html.split("<script>")[0]!;
    const start = initialMarkup.indexOf('id="experience-summary"');
    const end = initialMarkup.indexOf("</section>", start);
    const summarySection = initialMarkup.slice(start, end);

    expect(initialMarkup).toContain('class="card summary-card is-compact"');
    expect(summarySection).not.toContain('<div class="summary-grid">');
    expect(summarySection).toContain("막힘 없이 끝났다.");
  });

  it("defaults to the all filter, paginates 10 rows, and surfaces failure summaries in the list", async () => {
    const steps = [
      makeKeyboardStep(0),
      makeKeyboardStep(1, {
        verification: {
          passed: false,
          failures: ["submit button not reachable"],
        },
      }),
      makeKeyboardStep(2, {
        decision: {
          verdict: "success",
          rationale: "완료로 보인다.",
        },
        execution: {
          ok: true,
          costDelta: 0,
        },
      }),
    ];

    const html = await render(
      makeSession(steps, {
        aggregate: {
          result: "failure",
          failurePoint: {
            stepIndex: 1,
            reason: "submit button not reachable",
          },
        },
      })
    );
    const initialMarkup = html.split("<script>")[0]!;

    expect(initialMarkup).toMatch(/class="step-row is-status-normal"[\s\S]*?data-step-index="0"/);
    expect(initialMarkup).toMatch(/class="step-row is-status-failure-point is-failure-point"[\s\S]*?data-step-index="1"/);
    expect(initialMarkup).toMatch(/class="step-row is-status-success is-verdict-success"[\s\S]*?data-step-index="2"/);
    expect(html).toContain('id="step-pagination"');
    expect(html).toContain("Page 1 / 1");
    expect(html).toContain('aria-label="step 1 Initial');
    expect(html).not.toContain('aria-label="step 0 ');
    expect(html).toContain("Next action: Tab");
    expect(html).toContain("After Tab");
    expect(html).toContain("submit button not reachable");
    expect(html).toContain('loading="lazy"');
    expect(initialMarkup).not.toContain('<img class="detail-screenshot"');
  });

  it("renders action breakdown and timing sparkline for overview navigation", async () => {
    const steps = [
      makeKeyboardStep(0, {
        decision: {
          action: { key: "Enter" },
          rationale: "CTA를 눌러 본다.",
        },
      }),
      makeScreenReaderStep(1),
      makeKeyboardStep(2, {
        decision: {
          action: { typeText: "email" },
          rationale: "이메일을 입력한다.",
        },
      }),
    ];

    const html = await render(
      makeSession(steps, {
        task: {
          mode: "screenreader",
        },
        aggregate: {
          actionCounts: {
            srInvokeCount: 1,
            srReadCount: 0,
            srMaintenanceCount: 0,
            rawKeyCount: 1,
            typeTextCount: 1,
          },
        },
      })
    );

    expect(html).toContain('id="action-breakdown"');
    expect(html).toContain('id="timing-overview"');
    expect(html).toContain('id="timing-sparkline"');
    expect(html).toContain("SR:heading.next");
    expect(html).toContain("Initial");
    expect(html).toContain("After Enter");
    expect(html).toContain("Decision Time");
    expect(html).toContain("grid-template-columns: minmax(96px, 108px) minmax(120px, 1fr) 60px;");
    expect(html).toContain("min-width: 120px;");
    expect(html).toContain("min-height: 28px;");
    expect(html).toContain("padding: 0 10px;");
    expect(html).toContain("font-size: 10px;");
    expect(html).toContain("--panel-w: clamp(480px, 50vw, 760px);");
    expect(html).toContain("width: calc(100vw - var(--panel-w) - 24px);");
    expect(html).toContain("min-height: 320px;");
    expect(html).toContain("max-height: 420px;");
  });

  it("removes noisy infrastructure and debug fields from the report HTML", async () => {
    const steps = [
      makeScreenReaderStep(0, {
        verification: {
          passed: true,
          failures: [],
        },
        verdictAnalysis: {
          verificationResult: "passed",
          finalResult: "success",
          completionSource: "verifier-auto-complete",
        },
      }),
    ];

    const html = await render(makeSession(steps));

    expect(html).not.toContain("announcementCapture");
    expect(html).not.toContain("announcementCount");
    expect(html).not.toContain("observeReason");
    expect(html).not.toContain("browserLaunchMs");
    expect(html).not.toContain("pageLoadMs");
    expect(html).not.toContain("screenReaderInitMs");
    expect(html).not.toContain("reportMs");
    expect(html).not.toContain("costDelta");
    expect(html).not.toContain("verificationResult");
    expect(html).not.toContain("completionSource");
    expect(html).not.toContain("2026-04-12T00:00:01.000Z");
    expect(html).not.toContain("ACTION");
    expect(html).not.toContain("RATIONALE");
    expect(html).not.toContain("OBSERVATION");
    expect(html).not.toContain("TIMINGS");
  });

  it("renders a quiet summary warning when summary generation fails", async () => {
    const html = await render(
      makeSession([], {
        aggregate: {
          result: "success",
          endedBy: "success",
          totalSteps: 0,
          terminatedAtStep: null,
        },
        experienceSummaryError: "summary parser mismatch",
      })
    );

    expect(html).toContain("Summary unavailable. summary parser mismatch");
    expect(html).not.toContain("Experience summary unavailable");
  });

  it("builds detail panel content in observation, verification, decision order and shows timing without a disclosure", async () => {
    const html = await render(
      makeSession([
        makeScreenReaderStep(0, {
          verification: {
            passed: false,
            failures: ["focus trap"],
          },
          timings: {
            observeMs: 120,
            decideMs: 240,
            executeMs: 80,
            verifyMs: 70,
          },
        }),
      ])
    );

    const observationIndex = html.indexOf("panelSection('Observation',");
    const verificationIndex = html.indexOf("panelSection('Verification',");
    const decisionIndex = html.indexOf("panelSection('Decision',");
    const timeIndex = html.indexOf("panelSection('Time', renderTimingGrid(step))");

    expect(observationIndex).toBeLessThan(verificationIndex);
    expect(verificationIndex).toBeLessThan(decisionIndex);
    expect(decisionIndex).toBeLessThan(timeIndex);
    expect(html).toContain('"hasTimingDetails":true');
    expect(html).toContain("detail-subhead\">Announcement</div>");
    expect(html).toContain("<strong>Capture</strong>");
    expect(html).toContain("Phrase log");
    expect(html).toContain("<strong>Count</strong>");
    expect(html).toContain("1 phrase");
    expect(html).toContain("<strong>Reason</strong>");
    expect(html).toContain("Stopped after quiet period");
    expect(html).toContain("Next action");
    expect(html).toContain('<div class="detail-block"><div class="detail-copy">');
    expect(html).not.toContain('<details class="timing-details">');
  });

  it("renders VoiceOver cursor screenshots in the detail panel", async () => {
    const html = await render(
      makeSession([
        makeScreenReaderStep(0, {
          observation: {
            kind: "screenreader",
            announcement: "Get started button",
            announcementCapture: "log",
            announcementCount: 1,
            observeReason: "silence",
            cursorScreenshot: {
              status: "captured",
              path: "screenshots/step-000-voiceover-cursor.png"
            }
          }
        }),
      ])
    );

    expect(html).toContain("VoiceOver Cursor");
    expect(html).toContain('"cursorScreenshot":{"status":"Captured","path":"../screenshots/step-000-voiceover-cursor.png"}');
    expect(html).toContain("step-000-voiceover-cursor.png");
  });

  it("renders status-only diagnostics for failed screenreader helpers", async () => {
    const html = await render(
      makeSession([
        makeScreenReaderStep(0, {
          observation: {
            kind: "screenreader",
            announcement: "",
            announcementCapture: "none",
            observeReason: "timeout",
            domFocus: {
              status: "failed"
            },
            cursorScreenshot: {
              status: "unsupported"
            }
          }
        }),
      ])
    );

    expect(html).toContain('"domFocus":{"status":"Failed","hasDocumentFocus":null,"target":null,"label":null,"selector":null}');
    expect(html).toContain('"cursorScreenshot":{"status":"Unsupported","path":null}');
    expect(html).not.toContain("Capture Error");
    expect(html).not.toContain("__name");
  });

  it("keeps the default list compact even for 400-step runs", async () => {
    const steps = Array.from({ length: 400 }, (_, index) => {
      if (index === 47) {
        return makeKeyboardStep(index, {
          verification: {
            passed: false,
            failures: ["submit button not reachable"],
          },
        });
      }

      if (index === 312) {
        return makeKeyboardStep(index, {
          decision: {
            verdict: "stuck",
            rationale: "더 이상 진행 불가",
          },
          execution: {
            ok: true,
            costDelta: 0,
          },
        });
      }

      return makeKeyboardStep(index);
    });

    const html = await render(
      makeSession(steps, {
        aggregate: {
          totalSteps: 400,
          endedBy: "stuck",
          failurePoint: {
            stepIndex: 312,
            reason: "더 이상 진행 불가",
          },
        },
      })
    );
    const initialMarkup = html.split("<script>")[0]!;

    const minimapSegments = html.match(/class="minimap-segment"/g)?.length ?? 0;
    const rowCount = html.match(/class="step-row/g)?.length ?? 0;
    const hiddenCount = html.match(/class="step-row is-hidden/g)?.length ?? 0;

    expect(minimapSegments).toBe(400);
    expect(rowCount).toBe(400);
    expect(hiddenCount).toBe(390);
    expect(html).toContain("Page 1 / 40");
    expect(initialMarkup).not.toContain('<img class="detail-screenshot"');
  });

  it("publishes CLI-facing output files and summary text", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-publish-"));
    const session = makeSession([], {
      aggregate: {
        result: "success",
        endedBy: "success",
        totalSteps: 0,
        terminatedAtStep: null,
      },
    });

    const published = await publishRunOutputs(session, outDir, [{
      kind: "decision",
      systemPrompt: "system",
      userPromptText: "user",
    }]);

    await expect(access(join(outDir, "trace.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "metrics.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "prompts.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "report/index.html"))).resolves.toBeUndefined();

    expect(published.reportPath).toBe(join(outDir, "report", "index.html"));
    expect(published.summaryText).toContain("Task report-task finished with success.");
    expect(published.summaryText).toContain(join(outDir, "report", "index.html"));
  });

  it("includes diagnostics output in the summary only when the file exists", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-reporter-diagnostics-"));
    const session = makeSession([], {
      aggregate: {
        result: "failure",
        endedBy: "error",
        totalSteps: 0,
        terminatedAtStep: null,
      },
    });

    await readFile(await renderReport(session, outDir), "utf8");
    await access(join(outDir, "report", "index.html"));

    await writeFile(join(outDir, "diagnostics.jsonl"), '{"level":"error"}\n', "utf8");

    const published = await publishRunOutputs(session, outDir, []);

    expect(published.outputPaths.diagnosticsJsonl).toBe(join(outDir, "diagnostics.jsonl"));
    expect(published.summaryText).toContain(join(outDir, "diagnostics.jsonl"));
  });
});
