import { loadTask, parseRunArgs, runCli } from "../apps/cli/src";
import { access, mkdtemp, writeFile } from "node:fs/promises";
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
    expect(task.input).toBeUndefined();
    expect(task.verify?.all).toEqual([
      { textVisible: "Started!" },
      { titleIncludes: "Completed" }
    ]);
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

  it("loads screenreader-hybrid mode tasks without rejecting them at parse time", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.yml"), "screenreader-hybrid");

    expect(task.mode).toBe("screenreader-hybrid");
  });

  it("loads screenreader-strict mode tasks without rejecting them at parse time", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.yml"), "screenreader-strict");

    expect(task.mode).toBe("screenreader-strict");
  });

  it("rejects the removed legacy screenreader mode", async () => {
    await expect(loadTask(resolve("examples/tasks/simple-cta.yml"), "screenreader" as never)).rejects.toThrow(
      "Unsupported mode"
    );
  });

  it("rejects legacy screenreader mode on the CLI", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "screenreader",
      "--out",
      "./tmp/out"
    ])).toThrow("Unsupported mode");
  });

  it("parses provider CLI flags", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out",
      "--screenshots",
      "failure-only",
      "--verifier-auto-complete",
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
    expect(parsed.screenshotPolicy).toBe("failure-only");
    expect(parsed.verifierAutoComplete).toBe(true);
  });

  it("defaults verifier auto-complete to false when omitted", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out"
    ]);

    expect(parsed.verifierAutoComplete).toBe(false);
  });

  it("rejects invalid screenshot policies on the CLI", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "screenreader-strict",
      "--out",
      "./tmp/out",
      "--screenshots",
      "weird"
    ])).toThrow("Unsupported screenshot policy");
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

  it("loads verify rules from task yaml", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-verify-task-"));
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      taskPath,
      [
        "id: verify-task",
        "url: ../fixtures/simple-cta.html",
        "goal: Verify success.",
        "mode: keyboard",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - responseSeen:",
        "        urlIncludes: /api/cart",
        "        method: POST",
        "        status: 200"
      ].join("\n"),
      "utf8"
    );

    const task = await loadTask(taskPath);
    expect(task.verify?.all).toEqual([
      { textVisible: "Started!" },
      { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
    ]);
  });

  it("loads task-scoped input text from task yaml", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-input-task-"));
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      taskPath,
      [
        "id: input-task",
        "url: ../fixtures/search.html",
        "goal: Search for passport.",
        "mode: keyboard",
        "input:",
        "  text: passport"
      ].join("\n"),
      "utf8"
    );

    const task = await loadTask(taskPath);
    expect(task.input).toEqual({ text: "passport" });
  });

  it("rejects invalid verify rules", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-invalid-verify-"));
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      taskPath,
      [
        "id: invalid-verify-task",
        "url: ../../fixtures/simple-cta.html",
        "goal: Verify success.",
        "mode: keyboard",
        "verify:",
        "  all:",
        "    - titleIncludes: Completed",
        "      textVisible: Started!"
      ].join("\n"),
      "utf8"
    );

    await expect(loadTask(taskPath)).rejects.toThrow("exactly one rule type");
  });

  it("rejects invalid task input rules", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-invalid-input-"));
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      taskPath,
      [
        "id: invalid-input-task",
        "url: ../../fixtures/simple-cta.html",
        "goal: Try invalid input.",
        "mode: keyboard",
        "input:",
        '  text: ""'
      ].join("\n"),
      "utf8"
    );

    await expect(loadTask(taskPath)).rejects.toThrow('Task input.text must be a non-empty string.');
  });
});
