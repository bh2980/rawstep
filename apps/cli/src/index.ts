#!/usr/bin/env node

import { LLMAgent } from "@rawstep/agent";
import { resolveRunPlan, type ResolvedRunPlan } from "@rawstep/config";
import {
  getScreenReaderBackendCapabilities,
  type Agent,
  type TaskInput,
  type UserModel
} from "@rawstep/definition";
import { publishRunOutputs } from "@rawstep/reporter";
import { runTask, RunTaskFailedError } from "@rawstep/runtime";
import { parseRunArgs, printUsage } from "./args";

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
  let plan: ResolvedRunPlan | undefined;
  let agent: (Agent & { getPromptLog?(): unknown[] }) | undefined;
  try {
    const command = argv[0];
    if (command !== "run") {
      printUsage();
      return 1;
    }

    const cliOptions = parseRunArgs(argv.slice(1));
    plan = await resolveRunPlan(cliOptions);
    const task = plan.task;
    const agentFactory = dependencies.createAgent ?? createAgent;
    agent = agentFactory(task.mode, task.input, plan);

    const session = await runTask(task, {
      outDir: plan.paths.outDir,
      headless: plan.execution.headless,
      agent,
      screenshotPolicy: plan.execution.screenshotPolicy,
      verifierAutoComplete: plan.execution.verifierAutoComplete,
      maxVerificationRetries: plan.execution.maxVerificationRetries,
      keyboardActionPlan: plan.interaction.keyboardActionPlan,
      screenReaderActionPlan: plan.interaction.screenReaderActionPlan,
      screenReaderBackendId: plan.interaction.screenReaderBackendId,
      screenReaderObserve: plan.interaction.screenReaderObserve,
      voiceOver: plan.interaction.voiceOver
    });
    const published = await publishRunOutputs(session, plan.paths.outDir, agent.getPromptLog?.());
    process.stdout.write(`${published.summaryText}\n`);

    return 0;
  } catch (error) {
    if (error instanceof RunTaskFailedError && plan) {
      const published = await publishRunOutputs(error.session, plan.paths.outDir, agent?.getPromptLog?.());
      process.stdout.write(`${published.summaryText}\n`);
    }
    process.stderr.write(`${getErrorMessage(error)}\n`);
    return 1;
  }
}
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
      ? getScreenReaderBackendCapabilities(plan.interaction.screenReaderBackendId)
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
