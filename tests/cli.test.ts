import { loadTask, runCli } from "../apps/cli/src";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI", () => {
  it("loads task files with defaults and resolves relative fixture URLs", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.yml"));

    expect(task.id).toBe("simple-cta");
    expect(task.mode).toBe("keyboard");
    expect(task.url.startsWith("file://")).toBe(true);
  });

  it("runs the keyboard flow and writes outputs", async () => {
    const previousMode = process.env.A11Y_TASK_AGENT_MODE;
    process.env.A11Y_TASK_AGENT_MODE = "stub";

    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-"));

    try {
      const exitCode = await runCli([
        "run",
        resolve("examples/tasks/simple-cta.yml"),
        "--mode",
        "keyboard",
        "--out",
        outDir
      ]);

      expect(exitCode).toBe(0);
      await expect(access(join(outDir, "trace.jsonl"))).resolves.toBeUndefined();
      await expect(access(join(outDir, "metrics.json"))).resolves.toBeUndefined();
      await expect(access(join(outDir, "report", "index.html"))).resolves.toBeUndefined();
    } finally {
      if (previousMode === undefined) {
        delete process.env.A11Y_TASK_AGENT_MODE;
      } else {
        process.env.A11Y_TASK_AGENT_MODE = previousMode;
      }
    }
  });

  it("rejects screenreader mode in v1", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-screenreader-"));
    const exitCode = await runCli([
      "run",
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "screenreader",
      "--out",
      outDir
    ]);

    expect(exitCode).toBe(1);
  });
});
