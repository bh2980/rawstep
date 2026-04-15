#!/usr/bin/env node

import { LLMAgent } from "@rawstep/agent";
import type { Agent, ResolvedTask, TaskInput, UserModel } from "@rawstep/definition";
import { renderReport } from "@rawstep/reporter";
import { findScreenReaderBackendById, runTask } from "@rawstep/runtime";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRunArgs, printUsage } from "./args";
import { persistSessionArtifacts } from "./artifacts";
import { loadConfig, resolveRunOptions } from "./config";
import { type ResolvedRunOptions } from "./shared";

type RunCliDependencies = {
  createAgent?: (
    mode: UserModel,
    taskInput: TaskInput | undefined,
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

    await mkdir(options.execution.outDir, { recursive: true });
    const session = await runTask(task, {
      outDir: options.execution.outDir,
      headless: options.execution.headless,
      agent,
      screenshotPolicy: options.execution.screenshotPolicy,
      verifierAutoComplete: options.execution.verifierAutoComplete,
      maxVerificationRetries: options.execution.maxVerificationRetries,
      agentMemoryWindow: options.execution.memory.mode === "window"
        ? options.execution.memory.window
        : undefined,
      agentMemoryAll: options.execution.memory.mode === "all",
      includeExperienceSummary: options.execution.includeExperienceSummary,
      keyboardActionPlan: options.keyboardActionPlan,
      screenReaderActionPlan: options.screenReaderActionPlan,
      screenReaderBackendId: options.screenReaderBackendId
    });
    const reportStartedAt = Date.now();
    let reportPath = await renderReport(session, options.execution.outDir);
    session.aggregate.timings.reportMs = Date.now() - reportStartedAt;
    await persistSessionArtifacts(session, options.execution.outDir, agent.getPromptLog?.());
    reportPath = await renderReport(session, options.execution.outDir);

    process.stdout.write(
      [
        `Task ${session.task.id} finished with ${session.aggregate.endedBy}.`,
        `Result: ${session.aggregate.result}.`,
        `Outputs:`,
        `- ${resolve(options.execution.outDir, "trace.jsonl")}`,
        `- ${resolve(options.execution.outDir, "metrics.json")}`,
        `- ${resolve(options.execution.outDir, "prompts.json")}`,
        `- ${reportPath}`
      ].join("\n") + "\n"
    );

    return 0;
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n`);
    return 1;
  }
}

export { loadTask } from "./task-loader";
export { parseRunArgs } from "./args";
export { loadConfig, resolveRunOptions } from "./config";
export { defineConfig, kb, sr, srx, type RawstepConfig } from "./config-define";

function createAgent(
  mode: UserModel,
  taskInput: TaskInput | undefined,
  options: ResolvedRunOptions
): LLMAgent {
  return new LLMAgent(mode, {
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    baseURL: options.baseURL,
    agentMemoryWindow: options.execution.memory.mode === "window"
      ? options.execution.memory.window
      : undefined,
    agentMemoryAll: options.execution.memory.mode === "all",
    includeExperienceSummary: options.execution.includeExperienceSummary,
    includeRationale: options.execution.includeRationale,
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
