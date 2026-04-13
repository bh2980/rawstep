import { readFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import {
  type CliRunOptions,
  type LoadedProjectConfig,
  type ProjectConfig,
  type ResolvedRunOptions,
  type TaskConfigOverride
} from "./shared";
import { loadTaskSource, resolveTask, validateTaskConfigOverride } from "./task-file";

export async function loadConfig(configFile?: string): Promise<LoadedProjectConfig | undefined> {
  const resolvedPath = configFile ?? await findConfigFile();
  if (!resolvedPath) {
    return undefined;
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = YAML.parse(raw) as {
    version?: unknown;
    defaults?: unknown;
    tasks?: Record<string, unknown>;
  };

  if (parsed?.version !== 1) {
    throw new Error(`Config file ${resolvedPath} must include version: 1.`);
  }

  const config: ProjectConfig = {
    version: 1,
    defaults: validateTaskConfigOverride(parsed.defaults, `Config file ${resolvedPath} defaults`),
    tasks: parsed.tasks === undefined ? undefined : validateTaskOverrides(parsed.tasks, resolvedPath)
  };

  return {
    path: resolvedPath,
    config
  };
}

export async function resolveRunOptions(cliOptions: CliRunOptions): Promise<ResolvedRunOptions> {
  const taskSource = await loadTaskSource(cliOptions.taskFile);
  const loadedConfig = await loadConfig(cliOptions.configFile);
  const configPath = loadedConfig?.path;
  const configDir = configPath ? dirname(configPath) : undefined;
  const projectDefaults = loadedConfig?.config.defaults;
  const projectTaskOverride = loadedConfig?.config.tasks?.[taskSource.taskId];
  const mergedOverride = mergeTaskConfigOverrides(projectDefaults, projectTaskOverride, taskSource.taskConfig);

  const task = resolveTask(taskSource, cliOptions.mode, {
    mode: mergedOverride.run?.mode,
    maxSteps: mergedOverride.run?.maxSteps,
    timeoutMs: mergedOverride.run?.timeoutMs
  });

  const outDir = cliOptions.outDir
    ?? resolveOutputDir(taskSource.taskConfig?.run?.outDir, dirname(taskSource.absoluteTaskFile))
    ?? resolveOutputDir(projectTaskOverride?.run?.outDir, configDir)
    ?? resolveOutputDir(projectDefaults?.run?.outDir, configDir);

  if (!outDir) {
    throw new Error("Missing output directory. Pass --out <dir> or set defaults.run.outDir in rawstep.config.yml.");
  }

  return {
    task,
    taskFile: taskSource.absoluteTaskFile,
    configFile: configPath,
    outDir,
    mode: task.mode,
    maxSteps: task.maxSteps,
    timeoutMs: task.timeoutMs,
    screenshotPolicy: cliOptions.screenshotPolicy
      ?? taskSource.taskConfig?.run?.screenshots
      ?? projectTaskOverride?.run?.screenshots
      ?? projectDefaults?.run?.screenshots,
    verifierAutoComplete: cliOptions.verifierAutoComplete
      ?? taskSource.taskConfig?.run?.verifierAutoComplete
      ?? projectTaskOverride?.run?.verifierAutoComplete
      ?? projectDefaults?.run?.verifierAutoComplete
      ?? false,
    agentMemoryWindow: cliOptions.agentMemoryWindow
      ?? taskSource.taskConfig?.agent?.memory?.window
      ?? projectTaskOverride?.agent?.memory?.window
      ?? projectDefaults?.agent?.memory?.window,
    agentMemoryAll: cliOptions.agentMemoryAll
      ?? taskSource.taskConfig?.agent?.memory?.all
      ?? projectTaskOverride?.agent?.memory?.all
      ?? projectDefaults?.agent?.memory?.all
      ?? false,
    includeExperienceSummary: cliOptions.includeExperienceSummary
      ?? taskSource.taskConfig?.agent?.includeExperienceSummary
      ?? projectTaskOverride?.agent?.includeExperienceSummary
      ?? projectDefaults?.agent?.includeExperienceSummary
      ?? false,
    includeRationale: cliOptions.includeRationale
      ?? taskSource.taskConfig?.agent?.includeRationale
      ?? projectTaskOverride?.agent?.includeRationale
      ?? projectDefaults?.agent?.includeRationale
      ?? false,
    provider: cliOptions.provider
      ?? taskSource.taskConfig?.agent?.provider
      ?? projectTaskOverride?.agent?.provider
      ?? projectDefaults?.agent?.provider,
    model: cliOptions.model
      ?? taskSource.taskConfig?.agent?.model
      ?? projectTaskOverride?.agent?.model
      ?? projectDefaults?.agent?.model,
    baseURL: cliOptions.baseURL
      ?? taskSource.taskConfig?.agent?.baseURL
      ?? projectTaskOverride?.agent?.baseURL
      ?? projectDefaults?.agent?.baseURL
  };
}

async function findConfigFile(startDir = process.cwd()): Promise<string | undefined> {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = join(currentDir, "rawstep.config.yml");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep walking upward.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function validateTaskOverrides(
  rawTasks: Record<string, unknown>,
  configPath: string
): Record<string, TaskConfigOverride> {
  const result: Record<string, TaskConfigOverride> = {};

  for (const [taskId, rawOverride] of Object.entries(rawTasks)) {
    result[taskId] = validateTaskConfigOverride(rawOverride, `Config file ${configPath} tasks.${taskId}`) ?? {};
  }

  return result;
}

function mergeTaskConfigOverrides(...overrides: Array<TaskConfigOverride | undefined>): TaskConfigOverride {
  const result: TaskConfigOverride = {};

  for (const override of overrides) {
    if (!override) {
      continue;
    }

    if (override.run) {
      result.run = { ...result.run, ...override.run };
    }

    if (override.agent) {
      result.agent = {
        ...result.agent,
        ...override.agent,
        memory: {
          ...result.agent?.memory,
          ...override.agent.memory
        }
      };
    }
  }

  return result;
}

function resolveOutputDir(rawOutDir: string | undefined, baseDir: string | undefined): string | undefined {
  if (!rawOutDir || !baseDir) {
    return undefined;
  }

  return resolve(baseDir, rawOutDir);
}
