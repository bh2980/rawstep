import { LLMAgent } from "@a11y-task/agent";
import { runTask } from "@a11y-task/runner";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("runTask", () => {
  it("completes the simple CTA fixture with the stub agent", async () => {
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
        agent: new LLMAgent("keyboard", { provider: "stub" })
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.reachedGoal).toBe(true);
    expect(session.aggregate.totalKeystrokes).toBe(3);
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
  });

  it("records a stuck result for the bad focus fixture with the stub agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-stuck-"));
    const session = await runTask(
      {
        id: "bad-focus",
        url: pathToFileURL(resolve("fixtures/bad-focus.html")).toString(),
        goal: "Buy now 버튼을 찾아서 활성화하라.",
        mode: "keyboard",
        maxSteps: 8,
        timeoutMs: 60_000
      },
      {
        outDir,
        agent: new LLMAgent("keyboard", { provider: "stub" })
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.aggregate.reachedGoal).toBe(false);
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
        timeoutMs: 60_000
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
        timeoutMs: 0
      },
      {
        outDir,
        agent: new LLMAgent("keyboard", { provider: "stub" })
      }
    );

    expect(session.aggregate.endedBy).toBe("timeout");
    expect(session.aggregate.totalSteps).toBe(0);
  });

  it("feeds verification failure back into the next agent turn", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-feedback-"));
    const observedHistorySources: string[][] = [];
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
        agent: {
          decide: async (ctx) => {
            observedHistorySources.push(ctx.history.map((entry) => entry.source));
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
    expect(observedHistorySources[1]).toContain("verifier");
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
        timeoutMs: 60_000
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
        input: { text: "passport" }
      },
      {
        outDir,
        agent: {
          decide: async (ctx) => {
            callCount += 1;
            seenHistory.push(...ctx.history.map((entry) => `${entry.source}:${entry.rationale}`));

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
    expect(seenHistory.join(" ")).not.toContain("Action did not produce an observable text-entry state change.");
    expect(seenHistory.join(" ")).not.toContain("contenteditable");
    expect(seenHistory.join(" ")).not.toContain("textarea");
    expect(seenHistory.join(" ")).not.toContain("HTMLInputElement");
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
    expect(session.aggregate.totalKeystrokes).toBe(2);
    expect(session.steps[0].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[1].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[2].verification?.passed).toBe(true);
  });
});
