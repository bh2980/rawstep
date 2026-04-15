import { dirname, resolve } from "node:path";
import type { UserModel } from "@rawstep/definition";
import { MAX_VERIFICATION_RETRIES } from "@rawstep/runtime";
import type { LoadedTaskFile } from "./task-file";
import type {
  CliRunOptions,
  ModeConfigShape,
  ResolvedExecutionPolicy
} from "./shared";

type ResolveExecutionPolicyInput = {
  cliOptions: CliRunOptions;
  taskSource: LoadedTaskFile;
  selectedMode: UserModel;
  modePreset: ModeConfigShape;
  configDir: string;
};

export function resolveExecutionPolicy({
  cliOptions,
  taskSource,
  selectedMode,
  modePreset,
  configDir
}: ResolveExecutionPolicyInput): ResolvedExecutionPolicy {
  const outDir = cliOptions.outDir
    ?? resolveOutputDir(taskSource.taskConfig?.outDir, dirname(taskSource.absoluteTaskFile))
    ?? resolveOutputDir(modePreset.outDir, configDir);
  if (!outDir) {
    throw new Error(`Missing output directory. Pass --out <dir> or set modes.${selectedMode}.outDir in rawstep.config.ts.`);
  }

  const maxSteps = cliOptions.maxSteps
    ?? taskSource.taskConfig?.maxSteps
    ?? taskSource.parsed.maxSteps
    ?? modePreset.maxSteps;
  if (maxSteps === undefined) {
    throw new Error(
      `Task file ${taskSource.absoluteTaskFile} is missing maxSteps. Set maxSteps in the task file, task config.maxSteps, or modes.${selectedMode}.maxSteps in rawstep.config.ts.`
    );
  }

  const timeoutMs = cliOptions.timeoutMs
    ?? taskSource.taskConfig?.timeoutMs
    ?? taskSource.parsed.timeoutMs
    ?? modePreset.timeoutMs;
  if (timeoutMs === undefined) {
    throw new Error(
      `Task file ${taskSource.absoluteTaskFile} is missing timeoutMs. Set timeoutMs in the task file, task config.timeoutMs, or modes.${selectedMode}.timeoutMs in rawstep.config.ts.`
    );
  }

  const memorySetting = cliOptions.agentMemoryAll === true
    ? "all"
    : cliOptions.agentMemoryAll === false
      ? cliOptions.agentMemoryWindow
      : cliOptions.agentMemoryWindow
        ?? taskSource.taskConfig?.memory
        ?? modePreset.memory;
  if (memorySetting === undefined) {
    throw new Error(
      `Missing memory setting. Pass --agent-memory-window/--agent-memory-all or set task config.memory or modes.${selectedMode}.memory in rawstep.config.ts.`
    );
  }

  return {
    outDir,
    headless: cliOptions.headless
      ?? taskSource.taskConfig?.headless
      ?? modePreset.headless,
    maxSteps,
    timeoutMs,
    maxVerificationRetries: taskSource.taskConfig?.maxVerificationRetries
      ?? modePreset.maxVerificationRetries
      ?? MAX_VERIFICATION_RETRIES,
    screenshotPolicy: cliOptions.screenshotPolicy
      ?? taskSource.taskConfig?.screenshots
      ?? modePreset.screenshots,
    verifierAutoComplete: cliOptions.verifierAutoComplete
      ?? taskSource.taskConfig?.verifierAutoComplete
      ?? modePreset.verifierAutoComplete
      ?? false,
    memory: memorySetting === "all"
      ? { mode: "all" }
      : { mode: "window", window: memorySetting },
    includeExperienceSummary: cliOptions.includeExperienceSummary
      ?? taskSource.taskConfig?.includeExperienceSummary
      ?? modePreset.includeExperienceSummary
      ?? false,
    includeRationale: cliOptions.includeRationale
      ?? taskSource.taskConfig?.includeRationale
      ?? modePreset.includeRationale
      ?? false
  };
}

function resolveOutputDir(rawOutDir: string | undefined, baseDir: string | undefined): string | undefined {
  if (!rawOutDir || !baseDir) {
    return undefined;
  }

  return resolve(baseDir, rawOutDir);
}
