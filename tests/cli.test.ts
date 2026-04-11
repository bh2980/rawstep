import { loadTask, parseRunArgs, runCli } from "../apps/cli/src";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("CLI", () => {
  it("loads task files with defaults and resolves relative fixture URLs", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.yml"));

    expect(task.id).toBe("simple-cta");
    expect(task.mode).toBe("keyboard");
    expect(task.url.startsWith("file://")).toBe(true);
  });

  it("runs the keyboard flow and writes outputs", async () => {
    process.env.A11Y_TASK_AGENT_PROVIDER = "stub";

    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-"));

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

  it("parses provider CLI flags", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out",
      "--provider",
      "openai-compatible",
      "--model",
      "openrouter/model",
      "--base-url",
      "https://openrouter.ai/api/v1"
    ]);

    expect(parsed.provider).toBe("openai-compatible");
    expect(parsed.model).toBe("openrouter/model");
    expect(parsed.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("fails fast when openai-compatible is missing a model", async () => {
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";

    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-openai-compatible-"));
    const exitCode = await runCli([
      "run",
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard",
      "--out",
      outDir,
      "--provider",
      "openai-compatible"
    ]);

    expect(exitCode).toBe(1);
  });
});
