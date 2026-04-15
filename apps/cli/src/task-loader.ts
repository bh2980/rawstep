import {
  resolveTaskSource,
  type ResolvedTask,
  type TaskOverrideSource,
  type TaskSource,
  type UserModel,
  validateTaskSource,
} from "@rawstep/definition";
import { basename } from "node:path";
import { readTaskFile, resolveTaskUrl } from "./task-file";
import {
  type TaskExecutionDefaults,
  parseUserModel,
} from "./shared";

export type LoadedTaskFile = {
  absoluteTaskFile: string;
  taskId: string;
  taskConfig?: TaskOverrideSource;
  parsed: TaskSource;
};

type ResolvedTaskExecution = {
  mode: UserModel;
  maxSteps: number;
  timeoutMs: number;
};

export async function loadTask(
  taskFile: string,
  overrideMode?: UserModel,
  defaults: TaskExecutionDefaults = {}
): Promise<ResolvedTask> {
  const source = await loadTaskSource(taskFile);
  return resolveTask(source, resolveTaskExecution(source, overrideMode, defaults));
}

export async function loadTaskSource(taskFile: string): Promise<LoadedTaskFile> {
  const loaded = await readTaskFile(taskFile);
  const parsed = validateTaskSource(loaded.raw, `Task file ${loaded.absoluteTaskFile}`);
  const taskId = parsed.id ?? stripFileExtension(basename(loaded.absoluteTaskFile));

  return {
    absoluteTaskFile: loaded.absoluteTaskFile,
    taskId,
    taskConfig: parsed.config,
    parsed
  };
}

export function resolveTask(
  source: LoadedTaskFile,
  execution: ResolvedTaskExecution
): ResolvedTask {
  return resolveTaskSource(source.parsed, {
    taskId: source.taskId,
    resolvedUrl: resolveTaskUrl(source.parsed.url, source.absoluteTaskFile),
    mode: execution.mode,
    maxSteps: execution.maxSteps,
    timeoutMs: execution.timeoutMs
  });
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function resolveTaskExecution(
  source: LoadedTaskFile,
  overrideMode?: UserModel,
  defaults: TaskExecutionDefaults = {}
): ResolvedTaskExecution {
  const rawMode =
    overrideMode
    ?? source.taskConfig?.mode
    ?? source.parsed.mode
    ?? defaults.mode;
  if (!rawMode) {
    throw new Error(
      `Task file ${source.absoluteTaskFile} is missing mode. Set mode in the task file, task config.mode, or pass --mode.`
    );
  }

  const maxSteps =
    defaults.maxSteps
    ?? source.taskConfig?.maxSteps
    ?? source.parsed.maxSteps;
  if (maxSteps === undefined) {
    throw new Error(
      `Task file ${source.absoluteTaskFile} is missing maxSteps. Set maxSteps in the task file, task config.maxSteps, or modes.${rawMode}.maxSteps in rawstep.config.ts.`
    );
  }

  const timeoutMs =
    defaults.timeoutMs
    ?? source.taskConfig?.timeoutMs
    ?? source.parsed.timeoutMs;
  if (timeoutMs === undefined) {
    throw new Error(
      `Task file ${source.absoluteTaskFile} is missing timeoutMs. Set timeoutMs in the task file, task config.timeoutMs, or modes.${rawMode}.timeoutMs in rawstep.config.ts.`
    );
  }

  return {
    mode: parseUserModel(rawMode),
    maxSteps,
    timeoutMs
  };
}
