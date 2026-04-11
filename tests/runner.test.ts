import { LLMAgent } from "@a11y-task/agent";
import { runTask } from "@a11y-task/runner";
import { mkdtemp } from "node:fs/promises";
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
        timeoutMs: 60_000
      },
      {
        outDir,
        agent: new LLMAgent("keyboard", { backend: "stub" })
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.reachedGoal).toBe(true);
    expect(session.aggregate.totalKeystrokes).toBe(3);
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
        agent: new LLMAgent("keyboard", { backend: "stub" })
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
        agent: new LLMAgent("keyboard", { backend: "stub" })
      }
    );

    expect(session.aggregate.endedBy).toBe("timeout");
    expect(session.aggregate.totalSteps).toBe(0);
  });
});
