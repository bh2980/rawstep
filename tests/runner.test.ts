import { createBrowserSession } from "@a11y-task/browser";
import { runTask } from "@a11y-task/runner";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

function createFixtureAgent(fixture: "simple-cta" | "bad-focus") {
  return {
    async decide(ctx: { memory: Array<{ step: number }> }, obs: { kind: string; browserChrome?: { title: string } }) {
      if (obs.kind !== "keyboard" || !obs.browserChrome) {
        return { verdict: "stuck" as const, rationale: "Only keyboard observations are supported." };
      }

      const stepCount = ctx.memory.length;
      const title = obs.browserChrome.title;

      if (title.includes("Completed")) {
        return { verdict: "success" as const, rationale: "The completion state is visible." };
      }

      if (fixture === "simple-cta" && title.includes("Simple CTA Fixture")) {
        if (stepCount < 2) {
          return { action: { key: "Tab" as const }, rationale: "Move focus to the CTA." };
        }

        return { action: { key: "Enter" as const }, rationale: "Activate the CTA." };
      }

      if (fixture === "bad-focus" && title.includes("Bad Focus Fixture")) {
        if (stepCount < 4) {
          return { action: { key: "Tab" as const }, rationale: "Keep searching for focus." };
        }

        return { verdict: "stuck" as const, rationale: "No useful focus target appeared." };
      }

      return { verdict: "stuck" as const, rationale: "No known action." };
    }
  };
}

describe("runTask", () => {
  it("completes the simple CTA fixture with a fake deterministic agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-success-"));
    const session = await runTask(
      {
        id: "simple-cta",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
        mode: "keyboard",
        maxSteps: 20,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        agent: createFixtureAgent("simple-cta")
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.result).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 0,
      rawKeyCount: 3,
      typeTextCount: 0
    });
    expect(session.aggregate.timings.setupMs).toBeGreaterThanOrEqual(0);
    expect(session.aggregate.timings.browserLaunchMs).toBeGreaterThanOrEqual(0);
    expect(session.aggregate.timings.pageLoadMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.observeMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.decideMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.executeMs).toBeGreaterThanOrEqual(0);
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
    expect(session.steps.at(-1)?.verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "agent"
    });
    expect(session.steps.at(-1)?.timings.verifyMs).toBeGreaterThanOrEqual(0);
  });

  it("records a stuck result for the bad focus fixture with a fake deterministic agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-stuck-"));
    const session = await runTask(
      {
        id: "bad-focus",
        url: pathToFileURL(resolve("fixtures/bad-focus.html")).toString(),
        goal: "Buy now 버튼을 찾아서 활성화하라.",
        mode: "keyboard",
        maxSteps: 8,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Bad Focus Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        agent: createFixtureAgent("bad-focus")
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.aggregate.result).toBe("failure");
  });

  it("ends by maxSteps when the agent never returns a verdict", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-maxsteps-"));
    const session = await runTask(
      {
        id: "max-steps",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Never finish.",
        mode: "keyboard",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => ({
            action: { key: "Tab" as const },
            rationale: "Keep moving."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("maxSteps");
    expect(session.aggregate.totalSteps).toBe(2);
  });

  it("ends by timeout when the deadline is already exhausted", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-timeout-"));
    const session = await runTask(
      {
        id: "timeout",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Time out immediately.",
        mode: "keyboard",
        maxSteps: 20,
        timeoutMs: 0,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: createFixtureAgent("simple-cta")
      }
    );

    expect(session.aggregate.endedBy).toBe("timeout");
    expect(session.aggregate.totalSteps).toBe(0);
  });

  it("uses the configured agent memory window and can attach an experience summary", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-memory-summary-"));
    const seenMemoryLengths: number[] = [];
    const recordedMemoryValues: string[] = [];
    const seenSummaryStepCounts: number[] = [];

    const agent = {
      recordStepOutcome: (entry: { action: string }) => {
        recordedMemoryValues.push(entry.action);
      },
      summarizeExperience: async (input: { steps: Array<unknown> }) => {
        seenSummaryStepCounts.push(input.steps.length);
        return {
          overall: `Recorded ${recordedMemoryValues.length} steps.`,
          biggestFriction: "Navigation took more than one step.",
          nextChecks: ["Check the initial guidance.", "Check the interaction feedback."]
        };
      },
      decide: async (ctx: { memory: unknown[] }) => {
        seenMemoryLengths.push(ctx.memory.length);

        if (seenMemoryLengths.length < 3) {
          return {
            action: { key: "Tab" as const }
          };
        }

        return {
          verdict: "stuck" as const
        };
      }
    };

    const session = await runTask(
      {
        id: "memory-summary",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Inspect memory behavior.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 1,
        includeExperienceSummary: true,
        agent
      }
    );

    expect(seenMemoryLengths).toEqual([0, 1, 1]);
    expect(seenSummaryStepCounts).toEqual([3]);
    expect(session.experienceSummary).toEqual({
      overall: "Recorded 3 steps.",
      biggestFriction: "Navigation took more than one step.",
      nextChecks: ["Check the initial guidance.", "Check the interaction feedback."]
    });
  });

  it("feeds verification failure back into the next agent turn", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-feedback-"));
    const observedMemoryActions: string[][] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "verify-feedback",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Need verified success.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        agent: {
          decide: async (ctx) => {
            observedMemoryActions.push(ctx.memory.map((entry) => entry.action));
            callCount += 1;

            if (callCount === 1) {
              return {
                verdict: "success",
                rationale: "Looks done."
              };
            }

            return {
              verdict: "stuck",
              rationale: "Verifier says not done."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification).toEqual({
      passed: false,
      failures: ['Verification failed: expected visible text "Never appears" was not observed.']
    });
    expect(session.steps[0].verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "failed",
      finalResult: "continued",
      completionSource: "agent"
    });
    expect(observedMemoryActions[1]).toContain("verdict(success)");
  });

  it("stops after two failed verified-success attempts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-retries-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "verify-retries",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Need verified success.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => {
            callCount += 1;
            return {
              verdict: "success",
              rationale: `Attempt ${callCount}`
            };
          }
        }
      }
    );

    expect(callCount).toBe(2);
    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.aggregate.failurePoint?.reason).toContain("Verified success was not reached");
    expect(session.steps).toHaveLength(2);
    expect(session.steps[1].verification?.passed).toBe(false);
  });

  it("ends with an error when task text input is used without opt-in input text", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-disabled-"));

    const session = await runTask(
      {
        id: "type-text-disabled",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try text input without opt-in.",
        mode: "keyboard",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => ({
            action: { typeText: "task" },
            rationale: "Attempt task text input."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("error");
    expect(session.steps[0].execution.error).toContain("Task-scoped text input is not enabled");
  });

  it("does not feed gated text input failures back into agent history", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-gate-fail-"));
    const seenHistory: string[] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "type-text-gate-fail",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try text input on a non-input target.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        input: { text: "passport" },
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        agent: {
          decide: async (ctx) => {
            callCount += 1;
            seenHistory.push(...ctx.memory.map((entry) => `${entry.action}:${entry.outcome}`));

            if (callCount === 1) {
              return {
                action: { typeText: "task" },
                rationale: "Try the task text."
              };
            }

            return {
              verdict: "stuck",
              rationale: "No visible progress."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].execution).toEqual({
      ok: false,
      costDelta: 0,
      error: "Action did not produce an observable text-entry state change."
    });
    expect(seenHistory.join(" ")).toContain("typeText(task)");
  });

  it("completes a verified task with task-scoped text input", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-success-"));
    const fixtureDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-fixture-"));
    const fixturePath = join(fixtureDir, "search-fixture.html");

    await writeFile(
      fixturePath,
      [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        "    <meta charset=\"utf-8\" />",
        "    <title>Search Fixture</title>",
        "  </head>",
        "  <body>",
        "    <label for=\"search\">Search</label>",
        "    <input id=\"search\" autofocus />",
        "    <p id=\"status\">Idle</p>",
        "    <script>",
        "      const input = document.getElementById('search');",
        "      const status = document.getElementById('status');",
        "      window.addEventListener('load', () => input.focus());",
        "      input.addEventListener('keydown', (event) => {",
        "        if (event.key === 'Enter' && input.value === 'passport') {",
        "          document.title = 'Search Results';",
        "          status.textContent = 'Results for passport';",
        "        }",
        "      });",
        "    </script>",
        "  </body>",
        "</html>"
      ].join("\n"),
      "utf8"
    );

    let callCount = 0;
    const session = await runTask(
      {
        id: "type-text-success",
        url: pathToFileURL(fixturePath).toString(),
        goal: "Search for passport and show results.",
        mode: "keyboard",
        maxSteps: 4,
        timeoutMs: 60_000,
        input: { text: "passport" },
        verify: {
          all: [
            { titleIncludes: "Results" },
            { textVisible: "Results for passport" }
          ]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => {
            callCount += 1;
            if (callCount === 1) {
              return {
                action: { typeText: "task" },
                rationale: "Type the provided task text."
              };
            }

            if (callCount === 2) {
              return {
                action: { key: "Enter" },
                rationale: "Submit the search."
              };
            }

            return {
              verdict: "success",
              rationale: "The results are visible."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 0,
      rawKeyCount: 1,
      typeTextCount: 1
    });
    expect(session.steps[0].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[1].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[2].verification?.passed).toBe(true);
  });

  it("runs the screenreader-hybrid path with mocked announcements and canonical commands", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-"));
    const observedCommands: string[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-basic",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find and activate the main call to action.",
        mode: "screenreader-hybrid",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Simple CTA heading",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (command) => {
              observedCommands.push(command);
            }
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async (ctx, obs) => {
            expect(ctx.allowedScreenReaderCommands).toContain("nextItem");
            expect(obs.kind).toBe("screenreader");

            if (observeCalls === 1) {
              return {
                action: { srCommand: "nextItem" },
                rationale: "Move to the next announced item."
              };
            }

            return {
              verdict: "success",
              rationale: "The button announcement is present."
            };
          }
        }
      }
    );

    expect(observedCommands).toEqual(["nextItem"]);
    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    expect(session.steps[0].decision).toEqual({
      action: { srCommand: "nextItem" },
      rationale: "Move to the next announced item."
    });
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot?.path).toBe("screenshots/step-000.png");
      expect(session.steps[0].observation.announcementCapture).toBe("log");
    }
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 1,
      rawKeyCount: 0,
      typeTextCount: 0
    });
  });

  it("can disable developer screenshots for screenreader steps", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-no-shots-"));

    const session = await runTask(
      {
        id: "screenreader-no-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Finish without saving developer screenshots.",
        mode: "screenreader-strict",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "none",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          },
          controller: {
            execute: async () => undefined
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async () => ({
            verdict: "success",
            rationale: "The button announcement is present."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot).toBeUndefined();
    }
  });

  it("fails when screenreader-strict returns a raw key action", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-strict-key-"));

    const session = await runTask(
      {
        id: "screenreader-strict-key",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Do not allow raw keys.",
        mode: "screenreader-strict",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Simple CTA heading",
              announcementCapture: "log"
            })
          },
          controller: {
            execute: async () => undefined
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async (ctx) => {
            expect(ctx.allowedKeys).toEqual([]);
            expect(ctx.allowedScreenReaderCommands).toContain("nextItem");
            return {
              action: { key: "Tab" },
              rationale: "This should be rejected in strict mode."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("error");
    expect(session.steps[0].execution.error).toBe("Raw key actions are not allowed in screenreader-strict mode.");
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 0,
      rawKeyCount: 1,
      typeTextCount: 0
    });
  });

  it("runs the screenreader-strict path with screen reader commands only", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-strict-"));
    const observedCommands: string[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-strict-basic",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find and activate the main call to action.",
        mode: "screenreader-strict",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Simple CTA heading",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (command) => {
              observedCommands.push(command);
            }
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async (ctx, obs) => {
            expect(ctx.allowedKeys).toEqual([]);
            expect(ctx.allowedScreenReaderCommands).toContain("nextItem");
            expect(obs.kind).toBe("screenreader");

            if (observeCalls === 1) {
              return {
                action: { srCommand: "nextItem" },
                rationale: "Move to the next announced item."
              };
            }

            return {
              verdict: "success",
              rationale: "The button announcement is present."
            };
          }
        }
      }
    );

    expect(observedCommands).toEqual(["nextItem"]);
    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srCommandCount: 1,
      rawKeyCount: 0,
      typeTextCount: 0
    });
    expect(session.aggregate.timings.screenReaderInitMs).toBe(12);
    expect(session.aggregate.timings.firstAnnouncementWaitMs).toBe(34);
    expect(session.steps[1].verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "agent"
    });
  });

  it("can auto-complete verified success after a successful action when the option is enabled", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "verifier-auto-complete",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Activate the CTA.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => {
            callCount += 1;

            if (callCount === 1 || callCount === 2) {
              return {
                action: { key: "Tab" as const },
                rationale: "Move focus forward."
              };
            }

            return {
              action: { key: "Enter" as const },
              rationale: "Activate the focused CTA."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps).toHaveLength(3);
    expect(session.steps[2].verification).toEqual({
      passed: true,
      failures: []
    });
    expect(session.steps[2].verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("does not auto-complete on step 0 before any successful action", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-step0-"));

    const session = await runTask(
      {
        id: "verifier-auto-complete-step0",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Do not auto-complete before the agent acts.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => ({
            verdict: "stuck" as const,
            rationale: "I am not attempting the task."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification).toBeUndefined();
    expect(session.steps[0].verdictAnalysis).toEqual({
      agentVerdict: "stuck",
      verificationResult: "not-run",
      finalResult: "failure",
      completionSource: "agent"
    });
  });

  it("keeps running when verifier auto-complete is enabled but verification still fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-fail-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "verifier-auto-complete-fail",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try the CTA even though verify will fail.",
        mode: "keyboard",
        maxSteps: 4,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => {
            callCount += 1;
            if (callCount < 4) {
              return {
                action: { key: "Tab" as const },
                rationale: "Keep moving."
              };
            }

            return {
              verdict: "stuck" as const,
              rationale: "This still is not verified."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps.every((step) => step.verification === undefined)).toBe(true);
  });

  it("can auto-complete using network-only verification rules", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-network-"));

    const session = await runTask(
      {
        id: "verifier-auto-network",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Trigger the checkout network call.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [{ responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        browserSessionFactory: async (url) => {
          const session = await createBrowserSession(url, { headless: true });
          session.network.responses.push({
            url: "http://fixture.local/api/cart",
            method: "POST",
            status: 200,
            ok: true,
            timestamp: new Date().toISOString()
          });
          return session;
        },
        agent: {
          decide: async () => {
            return {
              action: { key: "Tab" as const },
              rationale: "Perform one successful action before verification."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
    expect(session.steps.at(-1)?.verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("switches the next screenreader observation to interactive after a successful act command", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-interactive-"));
    const observedProfiles: string[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-interactive",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Activate the main button.",
        mode: "screenreader-strict",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Get started button",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Started!",
                announcementCapture: "log"
              };
            },
            prepareNextObservation: (profile) => {
              observedProfiles.push(profile);
            }
          },
          controller: {
            execute: async () => undefined
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async () => {
            if (observeCalls === 1) {
              return {
                action: { srCommand: "act" as const },
                rationale: "Activate the button."
              };
            }

            return {
              verdict: "success" as const,
              rationale: "The result announcement is present."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(observedProfiles).toEqual(["interactive"]);
  });

  it("feeds verifier feedback back into the screenreader-hybrid path", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-verify-"));
    const seenHistorySources: string[][] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "screenreader-verify",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach verified success.",
        mode: "screenreader-hybrid",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        agentMemoryWindow: 5,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          },
          controller: {
            execute: async () => undefined
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async (ctx) => {
            seenHistorySources.push(ctx.memory.map((entry) => entry.outcome));
            callCount += 1;

            if (callCount === 1) {
              return {
                verdict: "success",
                rationale: "Sounds complete."
              };
            }

            return {
              verdict: "stuck",
              rationale: "Verifier says it is not complete."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification?.passed).toBe(false);
    expect(seenHistorySources[1]).toContain("continued");
  });

  it("stores only failed screenreader steps when screenshot policy is failure-only", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-failure-shots-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "screenreader-failure-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach verified success.",
        mode: "screenreader-hybrid",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "failure-only",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async () => ({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          },
          controller: {
            execute: async () => undefined
          },
          setupTimings: {
            screenReaderInitMs: 12,
            firstAnnouncementWaitMs: 34
          },
          close: async () => undefined
        }),
        agent: {
          decide: async () => {
            callCount += 1;

            if (callCount === 1) {
              return {
                action: { srCommand: "nextItem" },
                rationale: "Move once before deciding."
              };
            }

            return {
              verdict: "success",
              rationale: "Sounds complete."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    expect(session.steps[1].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot).toBeUndefined();
    }
    if (session.steps[1].observation.kind === "screenreader") {
      expect(session.steps[1].observation.screenshot?.path).toBe("screenshots/step-001.png");
    }
  });

  it("stores verifier auto-complete success steps even when screenshot policy is failure-only", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-shots-"));

    const session = await runTask(
      {
        id: "verifier-auto-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach auto-completed verified success.",
        mode: "screenreader-hybrid",
        maxSteps: 4,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Started!" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "failure-only",
        verifierAutoComplete: true,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderRuntimeFactory: async (page) => {
          await page.evaluate(() => {
            const button = document.querySelector("button");
            if (button instanceof HTMLElement) {
              button.focus();
            }
          });

          return {
            observer: {
              observe: async () => ({
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              })
            },
            controller: {
              execute: async () => {
                await page.evaluate(() => {
                  document.title = "Completed";
                  const result = document.getElementById("result");
                  if (result instanceof HTMLElement) {
                    result.hidden = false;
                    result.textContent = "Started!";
                  }
                });
              }
            },
            setupTimings: {
              screenReaderInitMs: 12,
              firstAnnouncementWaitMs: 34
            },
            close: async () => undefined
          };
        },
        agent: {
          decide: async () => {
            return {
              action: { srCommand: "act" as const },
              rationale: "Activate the CTA."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot?.path).toBe("screenshots/step-000.png");
    }
    expect(session.steps[0].verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });
});
