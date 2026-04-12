import type { AgentProvider } from "@a11y-task/agent";
import { HISTORY_WINDOW } from "@a11y-task/core";
import { resolve } from "node:path";
import { type CliRunOptions, parseScreenshotPolicy, parseUserModel } from "./shared";

export function parseRunArgs(argv: string[]): CliRunOptions {
  if (argv.length === 0) {
    throw new Error("Missing task file. Usage: a11y-task run <task.yml> --mode keyboard|screenreader-strict|screenreader-hybrid --out <dir>");
  }

  const taskFile = argv[0];
  let mode = undefined;
  let outDir = undefined;
  let screenshotPolicy = undefined;
  let verifierAutoComplete = false;
  let agentMemoryWindow = HISTORY_WINDOW;
  let agentMemoryAll = false;
  let includeExperienceSummary = false;
  let includeRationale = false;
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

    if (token === "--agent-memory-window") {
      if (!next) {
        throw new Error("Missing value for --agent-memory-window.");
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--agent-memory-window must be a non-negative integer.");
      }
      agentMemoryWindow = parsed;
      index += 1;
      continue;
    }

    if (token === "--agent-memory-all") {
      agentMemoryAll = true;
      continue;
    }

    if (token === "--include-experience-summary") {
      includeExperienceSummary = true;
      continue;
    }

    if (token === "--include-rationale") {
      includeRationale = true;
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
    agentMemoryWindow,
    agentMemoryAll,
    includeExperienceSummary,
    includeRationale,
    provider,
    model,
    baseURL
  };
}

export function printUsage(): void {
  process.stderr.write(
    "Usage: a11y-task run <task.yml> --mode keyboard|screenreader-strict|screenreader-hybrid --out <dir> [--screenshots all|important|failure-only|none] [--verifier-auto-complete] [--agent-memory-window <n>] [--agent-memory-all] [--include-experience-summary] [--include-rationale] [--provider anthropic|openai-compatible|stub] [--model <id>] [--base-url <url>]\n"
  );
}
