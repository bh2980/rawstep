import { type Task, type UserModel } from "@rawstep/core";
import { validateVerifySpec } from "@rawstep/runtime";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseTaskScreenReaderActions } from "./screenreader-actions";
import {
  parseAllowedKeys,
  parseScreenReaderBackendId,
  type TaskExecutionDefaults,
  type TaskFileShape,
  type TaskConfigOverride,
  parseUserModel,
  validateTaskInput,
} from "./shared";
import { parseTaskConfigObject } from "./schema";

export type LoadedTaskFile = {
  absoluteTaskFile: string;
  taskId: string;
  taskConfig?: TaskConfigOverride;
  parsed: TaskFileShape;
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
): Promise<Task> {
  const source = await loadTaskSource(taskFile);
  return resolveTask(source, resolveTaskExecution(source, overrideMode, defaults));
}

export async function loadTaskSource(taskFile: string): Promise<LoadedTaskFile> {
  const absoluteTaskFile = resolve(taskFile);
  const raw = await readFile(absoluteTaskFile, "utf8");
  let parsed: TaskFileShape;
  try {
    parsed = JSON.parse(raw) as TaskFileShape;
  } catch (error) {
    throw new Error(
      `Task file ${absoluteTaskFile} must be valid JSON. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed.url || !parsed.goal) {
    throw new Error("Task file must include url and goal.");
  }

  const taskConfig = validateTaskConfigOverride(parsed.config, `Task file ${absoluteTaskFile}`);
  const taskId = parsed.id ?? stripFileExtension(basename(absoluteTaskFile));

  return {
    absoluteTaskFile,
    taskId,
    taskConfig,
    parsed
  };
}

export function resolveTask(
  source: LoadedTaskFile,
  execution: ResolvedTaskExecution
): Task {
  return {
    id: source.taskId,
    url: resolveTaskUrl(source.parsed.url!, source.absoluteTaskFile),
    goal: source.parsed.goal!,
    mode: execution.mode,
    maxSteps: execution.maxSteps,
    timeoutMs: execution.timeoutMs,
    verify: validateVerifySpec(source.parsed.verify),
    input: validateTaskInput(source.parsed.input)
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

export function validateTaskConfigOverride(raw: unknown, label: string): TaskConfigOverride | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} config must be an object.`);
  }

  const candidate = parseTaskConfigObject(raw, label);

  return {
    mode: candidate.mode === undefined ? undefined : parseUserModel(candidate.mode),
    outDir: candidate.outDir,
    headless: candidate.headless,
    maxSteps: candidate.maxSteps,
    timeoutMs: candidate.timeoutMs,
    maxVerificationRetries: candidate.maxVerificationRetries,
    screenshots: candidate.screenshots,
    verifierAutoComplete: candidate.verifierAutoComplete,
    includeExperienceSummary: candidate.includeExperienceSummary,
    includeRationale: candidate.includeRationale,
    memory: candidate.memory,
    allowedKeys: candidate.allowedKeys === undefined
      ? undefined
      : parseAllowedKeys(candidate.allowedKeys, `${label} config.allowedKeys`),
    allowedScreenReaderActions: candidate.allowedScreenReaderActions === undefined
      ? undefined
      : parseTaskScreenReaderActions(
        candidate.allowedScreenReaderActions,
        `${label} config.allowedScreenReaderActions`
      ),
    screenReaderBackend: candidate.screenReaderBackend === undefined
      ? undefined
      : parseScreenReaderBackendId(candidate.screenReaderBackend, `${label} config.screenReaderBackend`)
  };
}
