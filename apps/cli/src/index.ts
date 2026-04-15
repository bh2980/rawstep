#!/usr/bin/env node

import { LLMAgent } from "@rawstep/agent";
import { resolveRunPlan, type ResolvedRunPlan } from "@rawstep/config";
import type { Agent, ResolvedTask, TaskInput, UserModel } from "@rawstep/definition";
import { renderReport } from "@rawstep/reporter";
import { findScreenReaderBackendById, runTask } from "@rawstep/runtime";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRunArgs, printUsage } from "./args";
import { persistSessionArtifacts } from "./artifacts";

type RunCliDependencies = {
  createAgent?: (
    mode: UserModel,
    taskInput: TaskInput | undefined,
    plan: ResolvedRunPlan
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
    const plan = await resolveRunPlan(cliOptions);
    const task = plan.task;
    const agentFactory = dependencies.createAgent ?? createAgent;
    const agent = agentFactory(task.mode, task.input, plan);

    await mkdir(plan.paths.outDir, { recursive: true });
    const session = await runTask(task, {
      outDir: plan.paths.outDir,
      headless: plan.execution.headless,
      agent,
      screenshotPolicy: plan.execution.screenshotPolicy,
      verifierAutoComplete: plan.execution.verifierAutoComplete,
      maxVerificationRetries: plan.execution.maxVerificationRetries,
      agentMemoryWindow: plan.agent.memory.mode === "window"
        ? plan.agent.memory.window
        : undefined,
      agentMemoryAll: plan.agent.memory.mode === "all",
      includeExperienceSummary: plan.agent.includeExperienceSummary,
      keyboardActionPlan: plan.interaction.keyboardActionPlan,
      screenReaderActionPlan: plan.interaction.screenReaderActionPlan,
      screenReaderBackendId: plan.interaction.screenReaderBackendId
    });
    const reportStartedAt = Date.now();
    let reportPath = await renderReport(session, plan.paths.outDir);
    session.aggregate.timings.reportMs = Date.now() - reportStartedAt;
    await persistSessionArtifacts(session, plan.paths.outDir, agent.getPromptLog?.());
    reportPath = await renderReport(session, plan.paths.outDir);

    process.stdout.write(
      [
        `Task ${session.task.id} finished with ${session.aggregate.endedBy}.`,
        `Result: ${session.aggregate.result}.`,
        `Outputs:`,
        `- ${resolve(plan.paths.outDir, "trace.jsonl")}`,
        `- ${resolve(plan.paths.outDir, "metrics.json")}`,
        `- ${resolve(plan.paths.outDir, "prompts.json")}`,
        `- ${reportPath}`
      ].join("\n") + "\n"
    );

    return 0;
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n`);
    return 1;
  }
}

export { parseRunArgs } from "./args";

function createAgent(
  mode: UserModel,
  taskInput: TaskInput | undefined,
  plan: ResolvedRunPlan
): LLMAgent {
  return new LLMAgent(mode, {
    provider: plan.agent.provider,
    apiKey: plan.agent.apiKey,
    model: plan.agent.model,
    baseURL: plan.agent.baseURL,
    agentMemoryWindow: plan.agent.memory.mode === "window"
      ? plan.agent.memory.window
      : undefined,
    agentMemoryAll: plan.agent.memory.mode === "all",
    includeExperienceSummary: plan.agent.includeExperienceSummary,
    includeRationale: plan.agent.includeRationale,
    taskInput,
    promptDir: plan.paths.promptDir,
    keyboardActions: plan.prompt.keyboardActions,
    screenReaderActions: plan.prompt.screenReaderActions,
    screenReaderCapabilities: plan.interaction.screenReaderBackendId
      ? findScreenReaderBackendById(plan.interaction.screenReaderBackendId).capabilities
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
