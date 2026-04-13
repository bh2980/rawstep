import { resolve } from "node:path";
import {
  type CliRunOptions,
  parseAgentProvider,
  parseCommaSeparatedAllowedKeys,
  parseCommaSeparatedScreenReaderCommands,
  parseOptionalNonNegativeInteger,
  parseScreenReaderBackendId,
  parseScreenshotPolicy,
  parseUserModel
} from "./shared";

export function parseRunArgs(argv: string[]): CliRunOptions {
  if (argv.length === 0) {
    throw new Error("Missing task file. Usage: a11y-task run <task-file> [--config <rawstep.config.ts>] [--mode keyboard|screenreader-strict|screenreader-hybrid] [--out <dir>]");
  }

  const taskFile = argv[0];
  let mode = undefined;
  let configFile = undefined;
  let outDir = undefined;
  let screenshotPolicy = undefined;
  let maxSteps = undefined;
  let timeoutMs = undefined;
  let verifierAutoComplete = undefined;
  let agentMemoryWindow = undefined;
  let agentMemoryAll = undefined;
  let includeExperienceSummary = undefined;
  let includeRationale = undefined;
  let allowedKeys = undefined;
  let allowedScreenReaderCommands = undefined;
  let screenReaderBackendId = undefined;
  let provider = undefined;
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

    if (token === "--config") {
      if (!next) {
        throw new Error("Missing value for --config.");
      }
      configFile = resolve(next);
      if (!configFile.endsWith(".ts")) {
        throw new Error("--config only accepts rawstep.config.ts files.");
      }
      index += 1;
      continue;
    }

    if (token === "--provider") {
      if (!next) {
        throw new Error("Missing value for --provider.");
      }
      provider = parseAgentProvider(next);
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

    if (token === "--max-steps") {
      if (!next) {
        throw new Error("Missing value for --max-steps.");
      }
      maxSteps = parseOptionalNonNegativeInteger(next, "--max-steps");
      index += 1;
      continue;
    }

    if (token === "--timeout-ms") {
      if (!next) {
        throw new Error("Missing value for --timeout-ms.");
      }
      timeoutMs = parseOptionalNonNegativeInteger(next, "--timeout-ms");
      index += 1;
      continue;
    }

    if (token === "--screen-reader-backend") {
      if (!next) {
        throw new Error("Missing value for --screen-reader-backend.");
      }
      screenReaderBackendId = parseScreenReaderBackendId(next, "--screen-reader-backend");
      index += 1;
      continue;
    }

    if (token === "--allowed-keys") {
      if (!next) {
        throw new Error("Missing value for --allowed-keys.");
      }
      allowedKeys = parseCommaSeparatedAllowedKeys(next, "--allowed-keys");
      index += 1;
      continue;
    }

    if (token === "--allowed-screen-reader-commands") {
      if (!next) {
        throw new Error("Missing value for --allowed-screen-reader-commands.");
      }
      allowedScreenReaderCommands = parseCommaSeparatedScreenReaderCommands(next, "--allowed-screen-reader-commands");
      index += 1;
      continue;
    }

    if (token === "--verifier-auto-complete") {
      verifierAutoComplete = true;
      continue;
    }

    if (token === "--no-verifier-auto-complete") {
      verifierAutoComplete = false;
      continue;
    }

    if (token === "--agent-memory-window") {
      if (!next) {
        throw new Error("Missing value for --agent-memory-window.");
      }
      agentMemoryWindow = parseOptionalNonNegativeInteger(next, "--agent-memory-window");
      index += 1;
      continue;
    }

    if (token === "--agent-memory-all") {
      agentMemoryAll = true;
      continue;
    }

    if (token === "--no-agent-memory-all") {
      agentMemoryAll = false;
      continue;
    }

    if (token === "--include-experience-summary") {
      includeExperienceSummary = true;
      continue;
    }

    if (token === "--no-include-experience-summary") {
      includeExperienceSummary = false;
      continue;
    }

    if (token === "--include-rationale") {
      includeRationale = true;
      continue;
    }

    if (token === "--no-include-rationale") {
      includeRationale = false;
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

  return {
    taskFile,
    configFile,
    mode,
    outDir: outDir ? resolve(outDir) : undefined,
    screenshotPolicy,
    maxSteps,
    timeoutMs,
    verifierAutoComplete,
    agentMemoryWindow,
    agentMemoryAll,
    includeExperienceSummary,
    includeRationale,
    allowedKeys,
    allowedScreenReaderCommands,
    screenReaderBackendId,
    provider,
    model,
    baseURL
  };
}

export function printUsage(): void {
  process.stderr.write(
    "Usage: a11y-task run <task-file> [--config <rawstep.config.ts>] [--mode keyboard|screenreader-strict|screenreader-hybrid] [--out <dir>] [--screenshots all|important|failure-only|none] [--max-steps <n>] [--timeout-ms <n>] [--screen-reader-backend guidepup-voiceover|guidepup-nvda|guidepup-virtual] [--allowed-keys Tab,Shift+Tab,Enter] [--allowed-screen-reader-commands nextItem,act] [--verifier-auto-complete|--no-verifier-auto-complete] [--agent-memory-window <n>] [--agent-memory-all|--no-agent-memory-all] [--include-experience-summary|--no-include-experience-summary] [--include-rationale|--no-include-rationale] [--provider anthropic|openai-compatible] [--model <id>] [--base-url <url>]\n"
  );
}
