#!/usr/bin/env node

import { LLMAgent, type AgentProvider } from "@a11y-task/agent";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  type ScreenshotPolicy,
  type Task,
  type UserModel
} from "@a11y-task/core";
import { renderReport } from "@a11y-task/reporter";
import { runTask, validateVerifySpec } from "@a11y-task/runner";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

type CliRunOptions = {
  taskFile: string;
  mode?: UserModel;
  outDir: string;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

type TaskFileShape = Partial<Task> & {
  url?: string;
  goal?: string;
  id?: string;
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  try {
    const command = argv[0];
    if (command !== "run") {
      printUsage();
      return 1;
    }

    const options = parseRunArgs(argv.slice(1));
    const task = await loadTask(options.taskFile, options.mode);
    const agent = new LLMAgent(task.mode, {
      provider: options.provider,
      model: options.model,
      baseURL: options.baseURL,
      taskInput: task.input
    });

    await mkdir(options.outDir, { recursive: true });
    const session = await runTask(task, {
      outDir: options.outDir,
      agent,
      screenshotPolicy: options.screenshotPolicy,
      verifierAutoComplete: options.verifierAutoComplete
    });
    const reportStartedAt = Date.now();
    let reportPath = await renderReport(session, options.outDir);
    session.aggregate.timings.reportMs = Date.now() - reportStartedAt;
    await persistSessionArtifacts(session, options.outDir);
    reportPath = await renderReport(session, options.outDir);

    process.stdout.write(
      [
        `Task ${session.task.id} finished with ${session.aggregate.endedBy}.`,
        `Result: ${session.aggregate.result}.`,
        `Outputs:`,
        `- ${resolve(options.outDir, "trace.jsonl")}`,
        `- ${resolve(options.outDir, "metrics.json")}`,
        `- ${reportPath}`
      ].join("\n") + "\n"
    );

    return 0;
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n`);
    return 1;
  }
}

async function persistSessionArtifacts(session: Awaited<ReturnType<typeof runTask>>, outDir: string): Promise<void> {
  await writeFile(resolve(outDir, "trace.json"), JSON.stringify(session, null, 2), "utf8");
  await writeFile(resolve(outDir, "metrics.json"), JSON.stringify(session.aggregate, null, 2), "utf8");
}

export async function loadTask(taskFile: string, overrideMode?: UserModel): Promise<Task> {
  const absoluteTaskFile = resolve(taskFile);
  const raw = await readFile(absoluteTaskFile, "utf8");
  const parsed = YAML.parse(raw) as TaskFileShape;

  if (!parsed.url || !parsed.goal) {
    throw new Error("Task file must include url and goal.");
  }

  const mode = parseUserModel(overrideMode ?? parsed.mode ?? "keyboard");

  return {
    id: parsed.id ?? stripFileExtension(basename(absoluteTaskFile)),
    url: resolveTaskUrl(parsed.url, absoluteTaskFile),
    goal: parsed.goal,
    mode,
    maxSteps: parsed.maxSteps ?? DEFAULT_MAX_STEPS,
    timeoutMs: parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    verify: validateVerifySpec(parsed.verify),
    input: validateTaskInput(parsed.input)
  };
}

export function parseRunArgs(argv: string[]): CliRunOptions {
  if (argv.length === 0) {
    throw new Error("Missing task file. Usage: a11y-task run <task.yml> --mode keyboard|screenreader-strict|screenreader-hybrid --out <dir>");
  }

  const taskFile = argv[0];
  let mode: UserModel | undefined;
  let outDir: string | undefined;
  let screenshotPolicy: ScreenshotPolicy | undefined;
  let verifierAutoComplete = false;
  let provider: AgentProvider | undefined;
  let model: string | undefined;
  let baseURL: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--mode") {
      if (!next) {
        throw new Error("Missing value for --mode.");
      }
      mode = parseUserModel(next);
      index += 1;
      continue;
    }

    if (token === "--out") {
      if (!next) {
        throw new Error("Missing value for --out.");
      }
      outDir = next;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      if (!next) {
        throw new Error("Missing value for --provider.");
      }
      provider = next as AgentProvider;
      index += 1;
      continue;
    }

    if (token === "--screenshots") {
      if (!next) {
        throw new Error("Missing value for --screenshots.");
      }
      screenshotPolicy = parseScreenshotPolicy(next);
      index += 1;
      continue;
    }

    if (token === "--verifier-auto-complete") {
      verifierAutoComplete = true;
      continue;
    }

    if (token === "--model") {
      if (!next) {
        throw new Error("Missing value for --model.");
      }
      model = next;
      index += 1;
      continue;
    }

    if (token === "--base-url") {
      if (!next) {
        throw new Error("Missing value for --base-url.");
      }
      baseURL = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!outDir) {
    throw new Error("Missing --out <dir>.");
  }

  return {
    taskFile,
    mode,
    outDir: resolve(outDir),
    screenshotPolicy,
    verifierAutoComplete,
    provider,
    model,
    baseURL
  };
}

function resolveTaskUrl(rawUrl: string, taskFile: string): string {
  if (/^https?:\/\//.test(rawUrl) || rawUrl.startsWith("file://")) {
    return rawUrl;
  }

  const absolutePath = resolve(dirname(taskFile), rawUrl);
  return pathToFileURL(absolutePath).toString();
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function printUsage(): void {
  process.stderr.write(
    "Usage: a11y-task run <task.yml> --mode keyboard|screenreader-strict|screenreader-hybrid --out <dir> [--screenshots all|important|failure-only|none] [--verifier-auto-complete] [--provider anthropic|openai-compatible|stub] [--model <id>] [--base-url <url>]\n"
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function validateTaskInput(raw: unknown): Task["input"] {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('Task input must be an object with a non-empty "text" field.');
  }

  const text = (raw as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error('Task input.text must be a non-empty string.');
  }

  return { text };
}

function parseUserModel(value: unknown): UserModel {
  if (
    value === "keyboard"
    || value === "screenreader-strict"
    || value === "screenreader-hybrid"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported mode: ${String(value)}. Expected one of keyboard, screenreader-strict, screenreader-hybrid.`
  );
}

function parseScreenshotPolicy(value: unknown): ScreenshotPolicy {
  if (
    value === "all"
    || value === "important"
    || value === "failure-only"
    || value === "none"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported screenshot policy: ${String(value)}. Expected one of all, important, failure-only, none.`
  );
}

if (require.main === module) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
