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

function createFixtureAgent() {
  return {
    getPromptLog() {
      return [{
        kind: "decision" as const,
        sequence: 0,
        provider: "anthropic" as const,
        model: "fake-model",
        systemPrompt: "keyboard system prompt",
        userPromptText: "goal: Complete the CTA task.",
        imageCount: 2
      }];
    },
    async decide(ctx: { memory: Array<{ step: number }> }, obs: { kind: string; browserChrome?: { title: string } }) {
      if (obs.kind !== "keyboard" || !obs.browserChrome) {
        return { verdict: "stuck" as const, rationale: "Only keyboard observations are supported." };
      }

      if (obs.browserChrome.title.includes("Completed")) {
        return { verdict: "success" as const, rationale: "The completion state is visible." };
      }

      if (ctx.memory.length < 2) {
        return { action: { key: "Tab" as const }, rationale: "Move focus to the CTA." };
      }

      return { action: { key: "Enter" as const }, rationale: "Activate the CTA." };
    }
  };
}

async function writeConfigModule(configPath: string, body: string): Promise<void> {
  await writeFile(
    configPath,
    [
      'import { defineConfig, kb, sr, srUnstable } from "@rawstep/cli/config";',
      'import { z } from "zod";',
      "",
      "export default defineConfig(",
      body,
      ");"
    ].join("\n"),
    "utf8"
  );
}

async function writeTaskFile(taskPath: string, body: unknown): Promise<void> {
  await writeFile(taskPath, JSON.stringify(body, null, 2), "utf8");
}

describe.sequential("CLI", () => {
  it("loads task files with explicit task settings and resolves relative fixture URLs", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.json"));

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
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-run-config-"));
    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-test"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    const exitCode = await runCli([
      "run",
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--provider",
      "anthropic",
      "--mode",
      "keyboard",
      "--out",
      outDir
    ], {
      createAgent: () => createFixtureAgent()
    });

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

  it("fails when rawstep.config.ts is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-no-config-"));
    const taskPath = resolve("examples/tasks/simple-cta.json");
    process.chdir(tempDir);

    await expect(resolveRunOptions(parseRunArgs([
      taskPath
    ]))).rejects.toThrow("Missing rawstep.config.ts");
  });

  it("loads screenreader-hybrid mode tasks without rejecting them at parse time", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.json"), "screenreader-hybrid");

    expect(task.mode).toBe("screenreader-hybrid");
  });

  it("loads screenreader-strict mode tasks without rejecting them at parse time", async () => {
    const task = await loadTask(resolve("examples/tasks/simple-cta.json"), "screenreader-strict");

    expect(task.mode).toBe("screenreader-strict");
  });

  it("loads the email login example with named inputs", async () => {
    const task = await loadTask(resolve("examples/tasks/email-login.json"));

    expect(task.id).toBe("email-login");
    expect(task.input).toEqual({ email: "traveler@example.com" });
    expect(task.verify.all).toEqual([
      { textVisible: "Magic link sent." },
      { textVisible: "traveler@example.com" },
      { titleIncludes: "Completed" }
    ]);
  });

  it("rejects the removed legacy screenreader mode", async () => {
    await expect(loadTask(resolve("examples/tasks/simple-cta.json"), "screenreader" as never)).rejects.toThrow(
      "Unsupported mode"
    );
  });

  it("rejects legacy screenreader mode on the CLI", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--mode",
      "screenreader",
      "--out",
      "./tmp/out"
    ])).toThrow("Unsupported mode");
  });

  it("parses provider and run override CLI flags", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      "./rawstep.config.ts",
      "--mode",
      "keyboard",
      "--out",
      "./tmp/out",
      "--headed",
      "--screenshots",
      "failure-only",
      "--max-steps",
      "12",
      "--timeout-ms",
      "240000",
      "--allowed-keys",
      "Tab,Enter,Space",
      "--screen-reader-backend",
      "guidepup-virtual",
      "--allowed-screen-reader-actions",
      "heading.next,click",
      "--no-verifier-auto-complete",
      "--agent-memory-window",
      "3",
      "--no-agent-memory-all",
      "--no-include-experience-summary",
      "--no-include-rationale",
      "--provider",
      "openai-compatible",
      "--model",
      "openrouter/model",
      "--base-url",
      "https://openrouter.ai/api/v1"
    ]);

    expect(parsed.configFile).toBe(resolve("rawstep.config.ts"));
    expect(parsed.provider).toBe("openai-compatible");
    expect(parsed.model).toBe("openrouter/model");
    expect(parsed.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(parsed.headless).toBe(false);
    expect(parsed.screenshotPolicy).toBe("failure-only");
    expect(parsed.maxSteps).toBe(12);
    expect(parsed.timeoutMs).toBe(240000);
    expect(parsed.allowedKeys).toEqual(["Tab", "Enter", "Space"]);
    expect(parsed.screenReaderBackendId).toBe("guidepup-virtual");
    expect(parsed.allowedScreenReaderActions).toEqual([
      { semantic: "heading.next" },
      { semantic: "click" }
    ]);
    expect(parsed.verifierAutoComplete).toBe(false);
    expect(parsed.agentMemoryWindow).toBe(3);
    expect(parsed.agentMemoryAll).toBe(false);
    expect(parsed.includeExperienceSummary).toBe(false);
    expect(parsed.includeRationale).toBe(false);
  });

  it("leaves optional CLI overrides undefined when omitted", () => {
    const parsed = parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--mode",
      "keyboard"
    ]);

    expect(parsed.outDir).toBeUndefined();
    expect(parsed.maxSteps).toBeUndefined();
    expect(parsed.timeoutMs).toBeUndefined();
    expect(parsed.verifierAutoComplete).toBeUndefined();
    expect(parsed.agentMemoryWindow).toBeUndefined();
    expect(parsed.agentMemoryAll).toBeUndefined();
    expect(parsed.includeExperienceSummary).toBeUndefined();
    expect(parsed.includeRationale).toBeUndefined();
    expect(parsed.headless).toBeUndefined();
    expect(parsed.allowedKeys).toBeUndefined();
    expect(parsed.allowedScreenReaderActions).toBeUndefined();
    expect(parsed.screenReaderBackendId).toBeUndefined();
  });

  it("rejects invalid comma-separated allowed keys and screen reader actions", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--allowed-keys",
      "Tab,BadKey"
    ])).toThrow("--allowed-keys[1] must be one of");

    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--allowed-screen-reader-actions",
      "heading.next,badAction"
    ])).toThrow("--allowed-screen-reader-actions[1] must be one of");
  });

  it("rejects invalid agent memory window values", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
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
      resolve("examples/tasks/simple-cta.json"),
      "--mode",
      "screenreader-strict",
      "--out",
      "./tmp/out",
      "--screenshots",
      "weird"
    ])).toThrow("Unsupported screenshot policy");
  });

  it("rejects the removed stub provider on the CLI", () => {
    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--provider",
      "stub"
    ])).toThrow("Unsupported agent provider");
  });

  it("rejects the removed stub provider in rawstep.config.ts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-stub-config-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "stub"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "stub-config-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).rejects.toThrow("Unsupported agent provider");
  });

  it("fails fast when openai-compatible is missing a model", async () => {
    process.env.A11Y_TASK_AGENT_API_KEY = "shared-key";

    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-openai-config-"));
    const outDir = await mkdtemp(join(tmpdir(), "a11y-cli-openai-compatible-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    const exitCode = await runCli([
      "run",
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "keyboard",
      "--out",
      outDir,
      "--provider",
      "openai-compatible"
    ]);

    expect(exitCode).toBe(1);
  });

  it("auto-discovers rawstep.config.ts from the current working directory and runs with config defaults", { timeout: 15_000 }, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-discovery-"));
    const taskDir = join(tempDir, "tasks");
    const taskPath = join(taskDir, "task.json");
    const outDir = join(tempDir, ".rawstep", "out");

    await mkdir(taskDir, { recursive: true });
    await writeConfigModule(
      join(tempDir, "rawstep.config.ts"),
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./.rawstep/out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    await writeTaskFile(taskPath, {
      id: "config-discovery-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    process.chdir(taskDir);
    const exitCode = await runCli(["run", taskPath], {
      createAgent: () => createFixtureAgent()
    });

    expect(exitCode).toBe(0);
    await expect(access(join(outDir, "trace.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "report", "index.html"))).resolves.toBeUndefined();
  });

  it("lets --config override the auto-discovered rawstep.config.ts file", { timeout: 15_000 }, async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-explicit-"));
    const taskDir = join(tempDir, "tasks");
    const taskPath = join(taskDir, "task.json");
    const discoveredOutDir = join(tempDir, "discovered-out");
    const explicitOutDir = join(tempDir, "explicit-out");
    const explicitConfigPath = join(tempDir, "override.ts");

    await mkdir(taskDir, { recursive: true });
    await writeConfigModule(
      join(tempDir, "rawstep.config.ts"),
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-discovered"
  },
  modes: {
    keyboard: {
      outDir: "./discovered-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeConfigModule(
      explicitConfigPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-explicit"
  },
  modes: {
    keyboard: {
      outDir: "./explicit-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "explicit-config-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    process.chdir(taskDir);
    const exitCode = await runCli(["run", taskPath, "--config", explicitConfigPath], {
      createAgent: () => createFixtureAgent()
    });

    expect(exitCode).toBe(0);
    await expect(access(join(explicitOutDir, "trace.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(discoveredOutDir, "trace.jsonl"))).rejects.toThrow();
  });

  it("merges env, config, task override, and CLI using the documented precedence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-precedence-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "precedence-task.json");

    process.env.A11Y_TASK_AGENT_PROVIDER = "openai-compatible";
    process.env.A11Y_TASK_AGENT_MODEL = "env-model";
    process.env.A11Y_TASK_AGENT_BASE_URL = "https://env.example/v1";

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "config-model",
    baseURL: "https://config.example/v1"
  },
  modes: {
    keyboard: {
      outDir: "./config-out",
      maxSteps: 30,
      timeoutMs: 2000,
      screenshots: "important",
      verifierAutoComplete: false,
      memory: 5
    },
    "screenreader-hybrid": {
      outDir: "./hybrid-out",
      maxSteps: 40,
      timeoutMs: 2500,
      screenshots: "all",
      verifierAutoComplete: false,
      includeExperienceSummary: false,
      includeRationale: false,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        { semantic: "heading.next" },
        { semantic: "click" }
      ]
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "precedence-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      maxSteps: 50,
      timeoutMs: 3000,
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        mode: "screenreader-hybrid",
        outDir: "./task-out",
        maxSteps: 60,
        timeoutMs: 4000,
        screenshots: "none",
        verifierAutoComplete: true,
        includeExperienceSummary: true,
        includeRationale: true,
        memory: "all"
      }
    });

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

  it("accepts apiKey in rawstep.config.ts and still rejects it in task.json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-secrets-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config",
    apiKey: "secret"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "invalid-secret-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).resolves.toMatchObject({
      provider: "anthropic",
      apiKey: "secret",
      model: "claude-config"
    });

    await writeTaskFile(taskPath, {
      id: "invalid-secret-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        apiKey: "secret"
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath
    ]))).rejects.toThrow("apiKey is not allowed");
  });

  it("prefers apiKey from rawstep.config.ts defaults over the shared environment variable", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-api-key-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    process.env.A11Y_TASK_AGENT_API_KEY = "env-key";

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    apiKey: "config-key",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]));

    expect(options.apiKey).toBe("config-key");
  });

  it("loads .env next to rawstep.config.ts before evaluating config values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-dotenv-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    delete process.env.OPENROUTER_API_KEY;

    await writeFile(join(tempDir, ".env"), "OPENROUTER_API_KEY=dotenv-key\n", "utf8");
    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "openai-compatible",
    apiKey: process.env.OPENROUTER_API_KEY,
    model: "openrouter/auto",
    baseURL: "https://openrouter.ai/api/v1"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]));

    expect(options.apiKey).toBe("dotenv-key");
  });

  it("rejects removed defaults.run/defaults.agent format with a migration hint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-old-defaults-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    run: {
      outDir: "./out"
    },
    agent: {
      provider: "anthropic"
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]))).rejects.toThrow("removed defaults.run/defaults.agent format");
  });

  it("rejects removed config.run/config.agent format with a migration hint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-old-task-config-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "old-task-config",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        run: {
          timeoutMs: 600000
        }
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).rejects.toThrow("removed config.run/config.agent format");
  });

  it("rejects provider overrides inside mode presets and task config", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-provider-reject-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      provider: "openai-compatible"
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]))).rejects.toThrow("config.provider is not allowed");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "task-provider-reject",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        provider: "openai-compatible"
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).rejects.toThrow("config.provider is not allowed");
  });

  it("loads verify rules from task json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-verify-task-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "verify-task",
      url: "../fixtures/simple-cta.html",
      goal: "Verify success.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { textVisible: "Started!" },
          { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
        ]
      }
    });

    const task = await loadTask(taskPath);
    expect(task.verify.all).toEqual([
      { textVisible: "Started!" },
      { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
    ]);
  });

  it("loads named inputs from task json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-input-task-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "input-task",
      url: "../fixtures/search.html",
      goal: "Search for passport.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { titleIncludes: "Search" }
        ]
      },
      input: {
        email: "traveler@example.com",
        password: "super-secret"
      }
    });

    const task = await loadTask(taskPath);
    expect(task.input).toEqual({
      email: "traveler@example.com",
      password: "super-secret"
    });
  });

  it("rejects invalid verify rules", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-invalid-verify-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "invalid-verify-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Verify success.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          {
            titleIncludes: "Completed",
            textVisible: "Started!"
          }
        ]
      }
    });

    await expect(loadTask(taskPath)).rejects.toThrow("exactly one rule type");
  });

  it("rejects invalid task input rules", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-invalid-input-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "invalid-input-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Try invalid input.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { titleIncludes: "Simple CTA Fixture" }
        ]
      },
      input: {
        email: ""
      }
    });

    await expect(loadTask(taskPath)).rejects.toThrow('Task input.email must be a non-empty string.');
  });

  it("rejects the removed legacy input.text field", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-legacy-input-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "legacy-input-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Try legacy input.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { titleIncludes: "Simple CTA Fixture" }
        ]
      },
      input: {
        text: "passport"
      }
    });

    await expect(loadTask(taskPath)).rejects.toThrow("Task input.text is removed.");
  });

  it("rejects reserved task input keys", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-reserved-input-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "reserved-input-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Try reserved input key.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { titleIncludes: "Simple CTA Fixture" }
        ]
      },
      input: {
        task: "passport"
      }
    });

    await expect(loadTask(taskPath)).rejects.toThrow('Task input key "task" is reserved.');
  });

  it("rejects empty named input maps", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-empty-input-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "empty-input-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Try empty input.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000,
      verify: {
        all: [
          { titleIncludes: "Simple CTA Fixture" }
        ]
      },
      input: {}
    });

    await expect(loadTask(taskPath)).rejects.toThrow("Task input must include at least one named value");
  });

  it("rejects task files without verify", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-missing-verify-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "missing-verify-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Missing verify.",
      mode: "keyboard",
      maxSteps: 20,
      timeoutMs: 180000
    });

    await expect(loadTask(taskPath)).rejects.toThrow('Task file must include verify with a non-empty "all" array.');
  });

  it("rejects task files without mode when there is no override", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-missing-mode-"));
    const taskPath = join(tempDir, "task.json");

    await writeTaskFile(taskPath, {
      id: "missing-mode-task",
      url: "../../fixtures/simple-cta.html",
      goal: "Missing mode.",
      verify: {
        all: [
          { titleIncludes: "Completed" }
        ]
      },
      maxSteps: 20,
      timeoutMs: 180000
    });

    await expect(loadTask(taskPath)).rejects.toThrow("missing mode");
  });

  it("uses discovered rawstep.config.ts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-config-discovery-"));
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      join(tempDir, "rawstep.config.ts"),
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "config-discovery-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    process.chdir(tempDir);
    await expect(resolveRunOptions(parseRunArgs([taskPath]))).resolves.toMatchObject({
      task: {
        id: "config-discovery-task"
      }
    });
  });

  it("resolves screen reader backend and allowed command subsets from config and task overrides", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-screenreader-config-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    "screenreader-hybrid": {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-virtual",
      allowedKeys: [kb.tab(), kb.enter()],
      allowedScreenReaderActions: [
        { semantic: "heading.next" },
        { semantic: "click" }
      ]
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "sr-config-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "screenreader-hybrid",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        headless: true,
        allowedKeys: ["Tab"],
        allowedScreenReaderActions: [{ semantic: "heading.next" }],
        screenReaderBackend: "guidepup-virtual"
      }
    });

    const options = await resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]));

    expect(options.screenReaderBackendId).toBe("guidepup-virtual");
    expect(options.headless).toBe(true);
    expect(options.allowedKeys).toEqual(["Tab"]);
    expect(options.allowedScreenReaderActions).toEqual([
      { kind: "invoke", method: "perform", source: "catalog", id: "commands.moveToNextHeading" }
    ]);
  });

  it("lets CLI override screen reader backend, allowed command subsets, and task timing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-screenreader-cli-override-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    "screenreader-hybrid": {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-voiceover",
      allowedKeys: [kb.tab(), kb.enter()],
      allowedScreenReaderActions: [
        { semantic: "heading.next" },
        { semantic: "click" }
      ]
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "sr-cli-override-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "screenreader-hybrid",
      maxSteps: 40,
      timeoutMs: 200000,
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        headless: false,
        allowedKeys: ["Tab"],
        allowedScreenReaderActions: [{ semantic: "heading.next" }],
        screenReaderBackend: "guidepup-voiceover"
      }
    });

    const options = await resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath,
      "--max-steps",
      "55",
      "--timeout-ms",
      "210000",
      "--headless",
      "--screen-reader-backend",
      "guidepup-virtual",
      "--allowed-keys",
      "Tab",
      "--allowed-screen-reader-actions",
      "heading.next,click"
    ]));

    expect(options.task.maxSteps).toBe(55);
    expect(options.task.timeoutMs).toBe(210000);
    expect(options.headless).toBe(true);
    expect(options.screenReaderBackendId).toBe("guidepup-virtual");
    expect(options.allowedKeys).toEqual(["Tab"]);
    expect(options.allowedScreenReaderActions).toEqual([
      { kind: "invoke", method: "perform", source: "catalog", id: "commands.moveToNextHeading" },
      { kind: "invoke", method: "click" }
    ]);
  });

  it("resolves prompt dir from project defaults", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-prompt-merge-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config",
    prompt: {
      dir: "./custom-prompt"
    }
  },
  modes: {
    "screenreader-hybrid": {
      outDir: "./sr-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedKeys: [
        kb.tab({ hint: "mode-tab" }),
        kb.enter({ hint: "mode-enter" })
      ],
      allowedScreenReaderActions: [
        { semantic: "heading.next", hint: "mode-next-heading" },
        { semantic: "click", hint: "mode-click" }
      ]
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "screenreader-hybrid"
    ]));

    expect(options.prompt.promptDir).toBe(join(tempDir, "custom-prompt"));
    expect(options.prompt.keyboardActions).toEqual([
      {
        key: "Tab",
        hint: "mode-tab"
      },
      {
        key: "Enter",
        hint: "mode-enter"
      }
    ]);
    expect(options.prompt.screenReaderActions).toEqual([
      {
        semantic: "heading.next",
        hint: "mode-next-heading",
        runtimeAction: {
          kind: "invoke",
          method: "perform",
          source: "catalog",
          id: "keyboard.findNextHeading"
        }
      },
      {
        semantic: "click",
        hint: "mode-click",
        runtimeAction: {
          kind: "invoke",
          method: "click"
        }
      }
    ]);
  });

  it("ignores config.prompt in task config", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-task-prompt-dir-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "prompt-dir-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      },
      config: {
        prompt: {
          dir: "./another-prompt"
        }
      }
    });

    const options = await resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]));

    expect(options.prompt.promptDir).toBe(resolve(tempDir, "prompt"));
  });

  it("ignores modes.<mode>.prompt", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-mode-prompt-removed-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      prompt: {
        dir: "./another-prompt"
      }
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]));

    expect(options.prompt.promptDir).toBe(resolve(tempDir, "prompt"));
  });

  it("drops config keyboard hints when CLI overrides allowed keys", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-keyboard-hint-override-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      allowedKeys: [
        kb.tab({ hint: "mode-tab" }),
        kb.enter({ hint: "mode-enter" })
      ]
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--allowed-keys",
      "Tab"
    ]));

    expect(options.allowedKeys).toEqual(["Tab"]);
    expect(options.prompt.keyboardActions).toEqual([
      { key: "Tab" }
    ]);
  });

  it("ignores unsupported defaults.prompt keys and still honors dir", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-prompt-hints-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config",
    prompt: {
      dir: "./custom-prompt",
      keyHints: {
        BadKey: "bad"
      }
    }
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    }
  }
}`
    );

    const options = await resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]));

    expect(options.prompt.promptDir).toBe(resolve(tempDir, "custom-prompt"));
  });

  it("rejects screen reader action config in keyboard mode", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-keyboard-sr-command-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5,
      allowedScreenReaderActions: [{ semantic: "click" }]
      
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath
    ]))).rejects.toThrow("allowedScreenReaderActions is not allowed in keyboard mode");
  });

  it("rejects auto as a screen reader backend id", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-screenreader-auto-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    "screenreader-hybrid": {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "auto"
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "screenreader-hybrid"
    ]))).rejects.toThrow("must be one of guidepup-voiceover, guidepup-nvda, guidepup-virtual");
  });

  it("rejects virtual screen reader actions that the backend does not support", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-virtual-command-subset-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    "screenreader-hybrid": {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-virtual",
      allowedScreenReaderActions: [
        sr.heading.next(),
        srUnstable.catalog("commands.notReal", {
          hint: "Attempt an unsupported command.",
          argsSchema: z.object({ index: z.number().int() }),
          argsExample: { index: 1 }
        })
      ]
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "screenreader-hybrid"
    ]))).rejects.toThrow('does not support action srUnstable.catalog("commands.notReal")');
  });

  it("rejects invalid screen reader CLI overrides for the selected mode and backend", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-screenreader-cli-invalid-"));
    const configPath = join(tempDir, "rawstep.config.ts");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./keyboard-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: 5
    },
    "screenreader-strict": {
      outDir: "./strict-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedScreenReaderActions: [
        { semantic: "heading.next" },
        { semantic: "click" }
      ]
    },
    "screenreader-hybrid": {
      outDir: "./hybrid-out",
      maxSteps: 20,
      timeoutMs: 180000,
      memory: "all",
      screenReaderBackend: "guidepup-voiceover",
      allowedKeys: [kb.tab()],
      allowedScreenReaderActions: [
        { semantic: "heading.next" },
        { semantic: "click" }
      ]
    }
  }
}`
    );

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "keyboard",
      "--screen-reader-backend",
      "guidepup-virtual"
    ]))).rejects.toThrow("screenReaderBackend is not allowed in keyboard mode");

    await expect(resolveRunOptions(parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "screenreader-strict",
      "--allowed-keys",
      "Tab,Enter"
    ]))).rejects.toThrow("allowedKeys is not allowed in screenreader-strict mode");

    expect(() => parseRunArgs([
      resolve("examples/tasks/simple-cta.json"),
      "--config",
      configPath,
      "--mode",
      "screenreader-hybrid",
      "--screen-reader-backend",
      "guidepup-virtual",
      "--allowed-screen-reader-actions",
      "heading.next,catalog:commands.notReal"
    ])).toThrow("--allowed-screen-reader-actions[1] must be one of");
  });

  it("rejects missing memory when neither config nor CLI provides it", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "a11y-cli-missing-memory-"));
    const configPath = join(tempDir, "rawstep.config.ts");
    const taskPath = join(tempDir, "task.json");

    await writeConfigModule(
      configPath,
      `{
  version: 1,
  defaults: {
    provider: "anthropic",
    model: "claude-config"
  },
  modes: {
    keyboard: {
      outDir: "./out",
      maxSteps: 20,
      timeoutMs: 180000
    }
  }
}`
    );
    await writeTaskFile(taskPath, {
      id: "missing-memory-task",
      url: resolve("fixtures/simple-cta.html"),
      goal: "Complete the CTA task.",
      mode: "keyboard",
      verify: {
        all: [
          { textVisible: "Started!" },
          { titleIncludes: "Completed" }
        ]
      }
    });

    await expect(resolveRunOptions(parseRunArgs([
      taskPath,
      "--config",
      configPath
    ]))).rejects.toThrow("Missing memory setting");
  });
});
