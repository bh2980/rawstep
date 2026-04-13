import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  type Task,
  type UserModel
} from "@a11y-task/core";
import { validateVerifySpec } from "@a11y-task/runner";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import {
  type TaskExecutionDefaults,
  type TaskFileShape,
  type TaskConfigOverride,
  parseOptionalNonNegativeInteger,
  parseOptionalString,
  parseOptionalBoolean,
  parseScreenshotPolicy,
  parseUserModel,
  validateTaskInput,
  parseAgentProvider
} from "./shared";

export type LoadedTaskFile = {
  absoluteTaskFile: string;
  taskId: string;
  taskConfig?: TaskConfigOverride;
  parsed: TaskFileShape;
};

export async function loadTask(
  taskFile: string,
  overrideMode?: UserModel,
  defaults: TaskExecutionDefaults = {}
): Promise<Task> {
  const source = await loadTaskSource(taskFile);
  return resolveTask(source, overrideMode, defaults);
}

export async function loadTaskSource(taskFile: string): Promise<LoadedTaskFile> {
  const absoluteTaskFile = resolve(taskFile);
  const raw = await readFile(absoluteTaskFile, "utf8");
  const parsed = YAML.parse(raw) as TaskFileShape;

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
  overrideMode?: UserModel,
  defaults: TaskExecutionDefaults = {}
): Task {
  const mode = parseUserModel(
    overrideMode
      ?? source.taskConfig?.run?.mode
      ?? source.parsed.mode
      ?? defaults.mode
      ?? "keyboard"
  );

  return {
    id: source.taskId,
    url: resolveTaskUrl(source.parsed.url!, source.absoluteTaskFile),
    goal: source.parsed.goal!,
    mode,
    maxSteps: source.taskConfig?.run?.maxSteps
      ?? source.parsed.maxSteps
      ?? defaults.maxSteps
      ?? DEFAULT_MAX_STEPS,
    timeoutMs: source.taskConfig?.run?.timeoutMs
      ?? source.parsed.timeoutMs
      ?? defaults.timeoutMs
      ?? DEFAULT_TIMEOUT_MS,
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

export function validateTaskConfigOverride(raw: unknown, label: string): TaskConfigOverride | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} config must be an object.`);
  }

  const candidate = raw as {
    run?: Record<string, unknown>;
    agent?: Record<string, unknown>;
  };
  const result: TaskConfigOverride = {};

  if (candidate.run !== undefined) {
    if (typeof candidate.run !== "object" || candidate.run === null || Array.isArray(candidate.run)) {
      throw new Error(`${label} config.run must be an object.`);
    }

    const run = candidate.run;
    result.run = {
      mode: run.mode === undefined ? undefined : parseUserModel(run.mode),
      outDir: run.outDir === undefined ? undefined : parseOptionalString(run.outDir, `${label} config.run.outDir`),
      maxSteps: run.maxSteps === undefined ? undefined : parseOptionalNonNegativeInteger(run.maxSteps, `${label} config.run.maxSteps`),
      timeoutMs: run.timeoutMs === undefined ? undefined : parseOptionalNonNegativeInteger(run.timeoutMs, `${label} config.run.timeoutMs`),
      screenshots: run.screenshots === undefined ? undefined : parseScreenshotPolicy(run.screenshots),
      verifierAutoComplete: run.verifierAutoComplete === undefined
        ? undefined
        : parseOptionalBoolean(run.verifierAutoComplete, `${label} config.run.verifierAutoComplete`)
    };
  }

  if (candidate.agent !== undefined) {
    if (typeof candidate.agent !== "object" || candidate.agent === null || Array.isArray(candidate.agent)) {
      throw new Error(`${label} config.agent must be an object.`);
    }

    const agent = candidate.agent;
    if (agent.apiKey !== undefined) {
      throw new Error(`${label} config.agent.apiKey is not allowed. Use environment variables for secrets.`);
    }

    const memory = agent.memory as { window?: unknown; all?: unknown } | undefined;
    if (memory !== undefined && (typeof memory !== "object" || memory === null || Array.isArray(memory))) {
      throw new Error(`${label} config.agent.memory must be an object.`);
    }

    result.agent = {
      provider: agent.provider === undefined ? undefined : parseAgentProvider(agent.provider),
      model: agent.model === undefined ? undefined : parseOptionalString(agent.model, `${label} config.agent.model`),
      baseURL: agent.baseURL === undefined ? undefined : parseOptionalString(agent.baseURL, `${label} config.agent.baseURL`),
      includeExperienceSummary: agent.includeExperienceSummary === undefined
        ? undefined
        : parseOptionalBoolean(agent.includeExperienceSummary, `${label} config.agent.includeExperienceSummary`),
      includeRationale: agent.includeRationale === undefined
        ? undefined
        : parseOptionalBoolean(agent.includeRationale, `${label} config.agent.includeRationale`),
      memory: memory === undefined
        ? undefined
        : {
            window: memory.window === undefined
              ? undefined
              : parseOptionalNonNegativeInteger(memory.window, `${label} config.agent.memory.window`),
            all: memory.all === undefined
              ? undefined
              : parseOptionalBoolean(memory.all, `${label} config.agent.memory.all`)
          }
    };
  }

  return result;
}
