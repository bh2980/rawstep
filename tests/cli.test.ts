import { loadTask, parseRunArgs, resolveRunOptions, runCli } from "../apps/cli/src";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.chdir(ORIGINAL_CWD);
});

describe.sequential("CLI", () => {
  it("loads task files with defaults and resolves relative fixture URLs", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.yml"));

    expect(task.id).toBe("simple-cta");
    expect(task.mode).toBe("keyboard");
    expect(task.url.startsWith("file://")).toBe(true);
    expect(task.input).toBeUndefined();
    expect(task.verify.all).toEqual([
      { textVisible: "Started!" },
      { titleIncludes: "Completed" }
    ]);
  });

  it("runs the keyboard flow and writes outputs", { timeout: 15_000 }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-"));

    const exitCode = await runCli([
      "run",
      resolve("examples/tasks/simple-cta.yml"),
      "--provider",
      "stub",
      "--mode",
      "keyboard",
      "--out",
      outDir
    ]);

    expect(exitCode).toBe(0);
    await expect(access(join(outDir, "trace.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "metrics.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "prompts.json"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "report", "index.html"))).resolves.toBeUndefined();

    const prompts = JSON.parse(await readFile(join(outDir, "prompts.json"), "utf8")) as Array<{
      kind: string;
      systemPrompt: string;
      userPromptText: string;
      imageCount: number;
    }>;
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]?.kind).toBe("decision");
    expect(prompts[0]?.systemPrompt).toContain("keyboard");
    expect(prompts[0]?.userPromptText).toContain("goal:");
    expect(prompts[0]?.imageCount).toBeGreaterThanOrEqual(1);
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
      "--config",
      "./rawstep.config.yml",
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out",
      "--screenshots",
      "failure-only",
      "--verifier-auto-complete",
      "--agent-memory-window",
      "3",
      "--agent-memory-all",
      "--include-experience-summary",
      "--include-rationale",
      "--provider",
      "openai-compatible",
      "--model",
      "openrouter/model",
      "--base-url",
      "https://openrouter.ai/api/v1"
    ]);

    expect(parsed.configFile).toBe(resolve("rawstep.config.yml"));
    expect(parsed.provider).toBe("openai-compatible");
    expect(parsed.model).toBe("openrouter/model");
    expect(parsed.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(parsed.screenshotPolicy).toBe("failure-only");
    expect(parsed.verifierAutoComplete).toBe(true);
    expect(parsed.agentMemoryWindow).toBe(3);
    expect(parsed.agentMemoryAll).toBe(true);
    expect(parsed.includeExperienceSummary).toBe(true);
    expect(parsed.includeRationale).toBe(true);
  });

  it("leaves optional CLI overrides undefined when omitted", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard"
    ]);

    expect(parsed.outDir).toBeUndefined();
    expect(parsed.verifierAutoComplete).toBeUndefined();
    expect(parsed.agentMemoryWindow).toBeUndefined();
    expect(parsed.agentMemoryAll).toBeUndefined();
    expect(parsed.includeExperienceSummary).toBeUndefined();
    expect(parsed.includeRationale).toBeUndefined();
  });

  it("rejects invalid agent memory window values", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.yml"),
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out",
      "--agent-memory-window",
      "-1"
    ])).toThrow("agent-memory-window");
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

  it("auto-discovers rawstep.config.yml from the current working directory and runs with config defaults", { timeout: 15_000 }, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-discovery-"));
    const taskDir = join(tempDir, "tasks");
    const taskPath = join(taskDir, "task.yml");
    const outDir = join(tempDir, ".a11y-task", "out");

    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(tempDir, "rawstep.config.yml"),
      [
        "version: 1",
        "defaults:",
        "  run:",
        "    outDir: ./.a11y-task/out",
        "  agent:",
        "    provider: stub"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      taskPath,
      [
        "id: config-discovery-task",
        `url: ${resolve("fixtures/simple-cta.html")}`,
        "goal: Complete the CTA task.",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - titleIncludes: Completed"
      ].join("\n"),
      "utf8"
    );

    process.chdir(taskDir);
    const exitCode = await runCli(["run", taskPath]);

    expect(exitCode).toBe(0);
    await expect(access(join(outDir, "trace.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "report", "index.html"))).resolves.toBeUndefined();
  });

  it("lets --config override the auto-discovered rawstep.config.yml file", { timeout: 15_000 }, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-explicit-"));
    const taskDir = join(tempDir, "tasks");
    const taskPath = join(taskDir, "task.yml");
    const discoveredOutDir = join(tempDir, "discovered-out");
    const explicitOutDir = join(tempDir, "explicit-out");
    const explicitConfigPath = join(tempDir, "override.yml");

    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(tempDir, "rawstep.config.yml"),
      [
        "version: 1",
        "defaults:",
        "  run:",
        "    outDir: ./discovered-out",
        "  agent:",
        "    provider: stub"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      explicitConfigPath,
      [
        "version: 1",
        "defaults:",
        "  run:",
        "    outDir: ./explicit-out",
        "  agent:",
        "    provider: stub"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      taskPath,
      [
        "id: explicit-config-task",
        `url: ${resolve("fixtures/simple-cta.html")}`,
        "goal: Complete the CTA task.",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - titleIncludes: Completed"
      ].join("\n"),
      "utf8"
    );

    process.chdir(taskDir);
    const exitCode = await runCli(["run", taskPath, "--config", explicitConfigPath]);

    expect(exitCode).toBe(0);
    await expect(access(join(explicitOutDir, "trace.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(discoveredOutDir, "trace.jsonl"))).rejects.toThrow();
  });

  it("merges env, config, task override, and CLI using the documented precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-precedence-"));
    const configPath = join(tempDir, "rawstep.config.yml");
    const taskPath = join(tempDir, "precedence-task.yml");

    process.env.A11Y_TASK_AGENT_PROVIDER = "openai-compatible";
    process.env.A11Y_TASK_AGENT_MODEL = "env-model";
    process.env.A11Y_TASK_AGENT_BASE_URL = "https://env.example/v1";

    await writeFile(
      configPath,
      [
        "version: 1",
        "defaults:",
        "  run:",
        "    mode: keyboard",
        "    outDir: ./config-out",
        "    maxSteps: 30",
        "    timeoutMs: 2000",
        "    screenshots: important",
        "    verifierAutoComplete: false",
        "  agent:",
        "    provider: anthropic",
        "    model: config-model",
        "    baseURL: https://config.example/v1",
        "    includeExperienceSummary: false",
        "    includeRationale: false",
        "    memory:",
        "      window: 5",
        "      all: false",
        "tasks:",
        "  precedence-task:",
        "    run:",
        "      mode: screenreader-strict",
        "      maxSteps: 40",
        "    agent:",
        "      provider: openai-compatible",
        "      model: task-map-model",
        "      memory:",
        "        window: 6"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      taskPath,
      [
        "id: precedence-task",
        `url: ${resolve("fixtures/simple-cta.html")}`,
        "goal: Complete the CTA task.",
        "mode: keyboard",
        "maxSteps: 50",
        "timeoutMs: 3000",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - titleIncludes: Completed",
        "config:",
        "  run:",
        "    mode: screenreader-hybrid",
        "    outDir: ./task-out",
        "    maxSteps: 60",
        "    timeoutMs: 4000",
        "    screenshots: none",
        "    verifierAutoComplete: true",
        "  agent:",
        "    provider: stub",
        "    model: task-model",
        "    baseURL: https://task.example/v1",
        "    includeExperienceSummary: true",
        "    includeRationale: true",
        "    memory:",
        "      window: 7",
        "      all: true"
      ].join("\n"),
      "utf8"
    );

    const options = await resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath,
      "--out",
      "./cli-out",
      "--mode",
      "keyboard",
      "--provider",
      "anthropic",
      "--model",
      "cli-model",
      "--base-url",
      "https://cli.example/v1",
      "--agent-memory-window",
      "3",
      "--include-rationale"
    ]));

    expect(options.task.mode).toBe("keyboard");
    expect(options.task.maxSteps).toBe(60);
    expect(options.task.timeoutMs).toBe(4000);
    expect(options.outDir).toBe(resolve("cli-out"));
    expect(options.screenshotPolicy).toBe("none");
    expect(options.verifierAutoComplete).toBe(true);
    expect(options.provider).toBe("anthropic");
    expect(options.model).toBe("cli-model");
    expect(options.baseURL).toBe("https://cli.example/v1");
    expect(options.agentMemoryWindow).toBe(3);
    expect(options.agentMemoryAll).toBe(true);
    expect(options.includeExperienceSummary).toBe(true);
    expect(options.includeRationale).toBe(true);
  });

  it("rejects apiKey in rawstep.config.yml and task.yml", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-secrets-"));
    const configPath = join(tempDir, "rawstep.config.yml");
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      configPath,
      [
        "version: 1",
        "defaults:",
        "  run:",
        "    outDir: ./out",
        "  agent:",
        "    provider: stub",
        "    apiKey: secret"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      taskPath,
      [
        "id: invalid-secret-task",
        `url: ${resolve("fixtures/simple-cta.html")}`,
        "goal: Complete the CTA task.",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - titleIncludes: Completed"
      ].join("\n"),
      "utf8"
    );

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).rejects.toThrow("apiKey is not allowed");

    await writeFile(
      taskPath,
      [
        "id: invalid-secret-task",
        `url: ${resolve("fixtures/simple-cta.html")}`,
        "goal: Complete the CTA task.",
        "verify:",
        "  all:",
        "    - textVisible: Started!",
        "    - titleIncludes: Completed",
        "config:",
        "  agent:",
        "    apiKey: secret"
      ].join("\n"),
      "utf8"
    );

    await expect(resolveRunOptions(parseRunArgs([
      taskPath
    ]))).rejects.toThrow("apiKey is not allowed");
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
    expect(task.verify.all).toEqual([
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
        "verify:",
        "  all:",
        "    - titleIncludes: Search",
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
        "verify:",
        "  all:",
        "    - titleIncludes: Simple CTA Fixture",
        "input:",
        '  text: ""'
      ].join("\n"),
      "utf8"
    );

    await expect(loadTask(taskPath)).rejects.toThrow('Task input.text must be a non-empty string.');
  });

  it("rejects task files without verify", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-missing-verify-"));
    const taskPath = join(tempDir, "task.yml");

    await writeFile(
      taskPath,
      [
        "id: missing-verify-task",
        "url: ../../fixtures/simple-cta.html",
        "goal: Missing verify.",
        "mode: keyboard"
      ].join("\n"),
      "utf8"
    );

    await expect(loadTask(taskPath)).rejects.toThrow('Task file must include verify with a non-empty "all" array.');
  });
});
