#!/usr/bin/env node

import { LLMAgent } from "@rawstep/agent";
import type { Agent, Task, UserModel } from "@rawstep/core";
import { findScreenReaderBackendById } from "@rawstep/observer-screenreader";
import { renderReport } from "@rawstep/reporter";
import { runTask } from "@rawstep/runner";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRunArgs, printUsage } from "./args";
import { persistSessionArtifacts } from "./artifacts";
import { loadConfig, resolveRunOptions } from "./config";
import { type ResolvedRunOptions } from "./shared";

type RunCliDependencies = {
  createAgent?: (
    mode: UserModel,
    taskInput: Task["input"],
    options: ResolvedRunOptions
  ) => Agent & { getPromptLog?(): unknown[] };
};

export async function runCli(
  argv = process.argv.slice(2),
  dependencies: RunCliDependencies = {}
): Promise<number> {
  try {
    const command = argv[0];
    if (command !== "run") {
      printUsage();
      return 1;
    }

    const cliOptions = parseRunArgs(argv.slice(1));
    const options = await resolveRunOptions(cliOptions);
    const task = options.task;
    const agentFactory = dependencies.createAgent ?? createAgent;
    const agent = agentFactory(task.mode, task.input, options);

    await mkdir(options.outDir, { recursive: true });
    const session = await runTask(task, {
      outDir: options.outDir,
      headless: options.headless,
      agent,
      screenshotPolicy: options.screenshotPolicy,
      verifierAutoComplete: options.verifierAutoComplete,
      agentMemoryWindow: options.agentMemoryWindow,
      agentMemoryAll: options.agentMemoryAll,
      includeExperienceSummary: options.includeExperienceSummary,
      allowedKeys: options.allowedKeys,
      allowedScreenReaderActions: options.allowedScreenReaderActions,
      screenReaderBackendId: options.screenReaderBackendId
    });
    const reportStartedAt = Date.now();
    let reportPath = await renderReport(session, options.outDir);
    session.aggregate.timings.reportMs = Date.now() - reportStartedAt;
    await persistSessionArtifacts(session, options.outDir, agent.getPromptLog?.());
    reportPath = await renderReport(session, options.outDir);

    process.stdout.write(
      [
        `Task ${session.task.id} finished with ${session.aggregate.endedBy}.`,
        `Result: ${session.aggregate.result}.`,
        `Outputs:`,
        `- ${resolve(options.outDir, "trace.jsonl")}`,
        `- ${resolve(options.outDir, "metrics.json")}`,
        `- ${resolve(options.outDir, "prompts.json")}`,
        `- ${reportPath}`
      ].join("\n") + "\n"
    );

    return 0;
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n`);
    return 1;
  }
}

export { loadTask } from "./task-file";
export { parseRunArgs } from "./args";
export { loadConfig, resolveRunOptions } from "./config";
export { defineConfig, kb, sr, type RawstepConfig } from "./config-define";

function createAgent(
  mode: UserModel,
  taskInput: Task["input"],
  options: ResolvedRunOptions
): LLMAgent {
  return new LLMAgent(mode, {
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    baseURL: options.baseURL,
    agentMemoryWindow: options.agentMemoryWindow,
    agentMemoryAll: options.agentMemoryAll,
    includeExperienceSummary: options.includeExperienceSummary,
    includeRationale: options.includeRationale,
    taskInput,
    promptDir: options.prompt.promptDir,
    keyboardActions: options.prompt.keyboardActions,
    screenReaderActions: options.prompt.screenReaderActions,
    screenReaderCapabilities: options.screenReaderBackendId
      ? findScreenReaderBackendById(options.screenReaderBackendId).capabilities
      : undefined
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

if (require.main === module) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
