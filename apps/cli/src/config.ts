import { readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";
import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type AllowedKey,
  type ScreenReaderCommand
} from "@a11y-task/core";
import {
  findScreenReaderBackendById,
  resolveScreenReaderBackendPreference,
  type ScreenReaderBackendPreference
} from "@a11y-task/observer-screenreader";
import {
  type CliRunOptions,
  type LoadedProjectConfig,
  type ModeConfigShape,
  type ProjectDefaultsShape,
  type ProjectConfig,
  type ResolvedRunOptions
} from "./shared";
import { configRootSchema, parseProjectDefaultsObject } from "./schema";
import { loadTaskSource, resolveTask, validateTaskConfigOverride } from "./task-file";

export async function loadConfig(configFile?: string): Promise<LoadedProjectConfig> {
  const resolvedPath = configFile
    ? validateExplicitConfigPath(configFile)
    : await findConfigFile();
  if (!resolvedPath) {
    throw new Error(
      "Missing rawstep.config.ts. Put rawstep.config.ts at the project root or pass --config <path>."
    );
  }

  const parsedResult = configRootSchema.safeParse(await loadTsConfigModule(resolvedPath));
  if (!parsedResult.success || parsedResult.data.version !== 1) {
    throw new Error(`Config file ${resolvedPath} must include version: 1.`);
  }
  const parsed = parsedResult.data;

  if (parsed?.tasks !== undefined) {
    throw new Error(
      `Config file ${resolvedPath} uses removed tasks overrides. Use task.yml config with flat keys instead.`
    );
  }

  const config: ProjectConfig = {
    version: 1,
    defaults: validateProjectDefaults(parsed.defaults, resolvedPath),
    modes: validateModePresets(parsed.modes, resolvedPath)
  };

  return {
    path: resolvedPath,
    config
  };
}

export async function resolveRunOptions(cliOptions: CliRunOptions): Promise<ResolvedRunOptions> {
  const taskSource = await loadTaskSource(cliOptions.taskFile);
  const loadedConfig = await loadConfig(cliOptions.configFile);
  const configPath = loadedConfig.path;
  const configDir = dirname(configPath);
  const projectDefaults = loadedConfig.config.defaults;
  const selectedMode = cliOptions.mode
    ?? taskSource.taskConfig?.mode
    ?? taskSource.parsed.mode;
  if (!selectedMode) {
    throw new Error(
      `Task file ${taskSource.absoluteTaskFile} is missing mode. Set mode in task.yml, task.yml config.mode, or pass --mode.`
    );
  }

  const modePreset = loadedConfig.config.modes?.[selectedMode];
  if (!modePreset) {
    throw new Error(`Missing modes.${selectedMode} in ${configPath}. Add a preset for this mode to rawstep.config.ts.`);
  }

  const task = resolveTask(taskSource, selectedMode, {
    mode: selectedMode,
    maxSteps: modePreset?.maxSteps,
    timeoutMs: modePreset?.timeoutMs
  });

  const outDir = cliOptions.outDir
    ?? resolveOutputDir(taskSource.taskConfig?.outDir, dirname(taskSource.absoluteTaskFile))
    ?? resolveOutputDir(modePreset?.outDir, configDir);

  if (!outDir) {
    throw new Error(`Missing output directory. Pass --out <dir> or set modes.${selectedMode}.outDir in rawstep.config.ts.`);
  }

  const agentMemoryWindow = cliOptions.agentMemoryWindow
    ?? normalizeMemoryWindow(taskSource.taskConfig?.memory)
    ?? normalizeMemoryWindow(modePreset?.memory);
  const agentMemoryAll = cliOptions.agentMemoryAll
    ?? normalizeMemoryAll(taskSource.taskConfig?.memory)
    ?? normalizeMemoryAll(modePreset?.memory);

  if (agentMemoryWindow === undefined && agentMemoryAll !== true) {
    throw new Error(
      `Missing memory setting. Pass --agent-memory-window/--agent-memory-all or set task.yml config.memory or modes.${selectedMode}.memory in rawstep.config.ts.`
    );
  }

  const configuredAllowedKeys = taskSource.taskConfig?.allowedKeys ?? modePreset?.allowedKeys;
  const configuredAllowedScreenReaderCommands =
    taskSource.taskConfig?.allowedScreenReaderCommands
    ?? modePreset?.allowedScreenReaderCommands;
  const configuredModeScreenReaderBackend =
    taskSource.taskConfig?.screenReaderBackend
    ?? modePreset?.screenReaderBackend;
  const configuredScreenReaderBackend =
    configuredModeScreenReaderBackend
    ?? projectDefaults?.screenReaderBackend;

  if (selectedMode === "keyboard" && configuredAllowedScreenReaderCommands) {
    throw new Error("allowedScreenReaderCommands is not allowed in keyboard mode.");
  }

  if (selectedMode === "keyboard" && configuredModeScreenReaderBackend) {
    throw new Error("screenReaderBackend is not allowed in keyboard mode.");
  }

  if (selectedMode === "screenreader-strict" && configuredAllowedKeys) {
    throw new Error("allowedKeys is not allowed in screenreader-strict mode.");
  }

  const screenReaderBackendId = resolveScreenReaderBackendId(selectedMode, configuredScreenReaderBackend);
  const allowedScreenReaderCommands = resolveAllowedScreenReaderCommands(
    selectedMode,
    configuredAllowedScreenReaderCommands,
    screenReaderBackendId
  );
  const allowedKeys = resolveAllowedKeys(selectedMode, configuredAllowedKeys);

  return {
    task,
    taskFile: taskSource.absoluteTaskFile,
    configFile: configPath,
    outDir,
    mode: task.mode,
    maxSteps: task.maxSteps,
    timeoutMs: task.timeoutMs,
    screenshotPolicy: cliOptions.screenshotPolicy
      ?? taskSource.taskConfig?.screenshots
      ?? modePreset?.screenshots,
    verifierAutoComplete: cliOptions.verifierAutoComplete
      ?? taskSource.taskConfig?.verifierAutoComplete
      ?? modePreset?.verifierAutoComplete
      ?? false,
    agentMemoryWindow,
    agentMemoryAll: agentMemoryAll ?? false,
    includeExperienceSummary: cliOptions.includeExperienceSummary
      ?? taskSource.taskConfig?.includeExperienceSummary
      ?? modePreset?.includeExperienceSummary
      ?? false,
    includeRationale: cliOptions.includeRationale
      ?? taskSource.taskConfig?.includeRationale
      ?? modePreset?.includeRationale
      ?? false,
    provider: cliOptions.provider
      ?? projectDefaults?.provider,
    model: cliOptions.model
      ?? projectDefaults?.model,
    baseURL: cliOptions.baseURL
      ?? projectDefaults?.baseURL,
    allowedKeys,
    allowedScreenReaderCommands,
    screenReaderBackendId
  };
}

async function findConfigFile(startDir = process.cwd()): Promise<string | undefined> {
  let currentDir = resolve(startDir);

  while (true) {
    const tsCandidate = join(currentDir, "rawstep.config.ts");
    const ymlCandidate = join(currentDir, "rawstep.config.yml");
    if (await exists(ymlCandidate)) {
      throw new Error(`rawstep.config.yml is removed. Use rawstep.config.ts instead: ${ymlCandidate}`);
    }

    const candidate = tsCandidate;
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

function resolveOutputDir(rawOutDir: string | undefined, baseDir: string | undefined): string | undefined {
  if (!rawOutDir || !baseDir) {
    return undefined;
  }

  return resolve(baseDir, rawOutDir);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateExplicitConfigPath(configFile: string): string {
  const resolvedPath = resolve(configFile);
  if (resolvedPath.endsWith(".yml") || resolvedPath.endsWith(".yaml")) {
    throw new Error(`rawstep.config.yml is removed. Use rawstep.config.ts instead: ${resolvedPath}`);
  }

  if (!resolvedPath.endsWith(".ts")) {
    throw new Error(`Config file must be a rawstep.config.ts file. Received: ${resolvedPath}`);
  }

  return resolvedPath;
}

async function loadTsConfigModule(configPath: string): Promise<unknown> {
  const raw = await readFile(configPath, "utf8");
  const transpiled = ts.transpileModule(raw, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: configPath
  });

  const module = { exports: {} as Record<string, unknown> };
  const projectRequire = createRequire(pathToFileURL(configPath));
  const localRequire: NodeJS.Require = ((specifier: string) => {
    if (specifier === "@a11y-task/cli/config") {
      return {
        defineConfig<T>(config: T): T {
          return config;
        }
      };
    }

    return projectRequire(specifier);
  }) as NodeJS.Require;
  localRequire.resolve = projectRequire.resolve.bind(projectRequire);
  localRequire.cache = projectRequire.cache;
  localRequire.extensions = projectRequire.extensions;
  localRequire.main = projectRequire.main;
  const wrapped = new Script(
    `(function (exports, require, module, __filename, __dirname) {${transpiled.outputText}\n})`,
    { filename: configPath }
  ).runInThisContext() as (
    exports: Record<string, unknown>,
    require: NodeJS.Require,
    module: { exports: Record<string, unknown> },
    __filename: string,
    __dirname: string
  ) => void;

  wrapped(module.exports, localRequire, module, configPath, dirname(configPath));
  return module.exports.default ?? module.exports;
}

function validateProjectDefaults(
  rawDefaults: unknown,
  configPath: string
): ProjectDefaultsShape | undefined {
  if (rawDefaults === undefined || rawDefaults === null) {
    return undefined;
  }

  if (typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    throw new Error(`Config file ${configPath} defaults must be an object.`);
  }

  const candidate = parseProjectDefaultsObject(rawDefaults, configPath);

  return {
    provider: candidate.provider,
    model: candidate.model,
    baseURL: candidate.baseURL,
    screenReaderBackend: candidate.screenReaderBackend
  };
}

function validateModePresets(
  rawModes: unknown,
  configPath: string
): Partial<Record<ResolvedRunOptions["task"]["mode"], ModeConfigShape>> | undefined {
  if (rawModes === undefined || rawModes === null) {
    return undefined;
  }

  if (typeof rawModes !== "object" || Array.isArray(rawModes)) {
    throw new Error(`Config file ${configPath} modes must be an object.`);
  }

  const result: Partial<Record<ResolvedRunOptions["task"]["mode"], ModeConfigShape>> = {};

  for (const [modeKey, rawPreset] of Object.entries(rawModes as Record<string, unknown>)) {
    const mode = validateProjectMode(modeKey, configPath);
    result[mode] = validateModePreset(rawPreset, configPath, mode);
  }

  return result;
}

function validateModePreset(
  rawPreset: unknown,
  configPath: string,
  mode: ResolvedRunOptions["task"]["mode"]
): ModeConfigShape {
  const preset = validateTaskConfigOverride(rawPreset, `Config file ${configPath} modes.${mode}`);
  if (mode === "keyboard" && preset?.allowedScreenReaderCommands) {
    throw new Error(`Config file ${configPath} modes.${mode}.allowedScreenReaderCommands is not allowed in keyboard mode.`);
  }
  if (mode === "keyboard" && preset?.screenReaderBackend) {
    throw new Error(`Config file ${configPath} modes.${mode}.screenReaderBackend is not allowed in keyboard mode.`);
  }
  if (mode === "screenreader-strict" && preset?.allowedKeys) {
    throw new Error(`Config file ${configPath} modes.${mode}.allowedKeys is not allowed in screenreader-strict mode.`);
  }
  return {
    outDir: preset?.outDir,
    maxSteps: preset?.maxSteps,
    timeoutMs: preset?.timeoutMs,
    screenshots: preset?.screenshots,
    verifierAutoComplete: preset?.verifierAutoComplete,
    includeExperienceSummary: preset?.includeExperienceSummary,
    includeRationale: preset?.includeRationale,
    memory: preset?.memory,
    allowedKeys: preset?.allowedKeys,
    allowedScreenReaderCommands: preset?.allowedScreenReaderCommands,
    screenReaderBackend: preset?.screenReaderBackend
  };
}

function normalizeMemoryWindow(memory: number | "all" | undefined): number | undefined {
  return typeof memory === "number" ? memory : undefined;
}

function normalizeMemoryAll(memory: number | "all" | undefined): boolean | undefined {
  return memory === "all" ? true : undefined;
}

function resolveAllowedKeys(
  selectedMode: ResolvedRunOptions["task"]["mode"],
  configuredAllowedKeys: readonly AllowedKey[] | undefined
): ResolvedRunOptions["allowedKeys"] {
  if (selectedMode === "screenreader-strict") {
    return [];
  }

  return configuredAllowedKeys ?? ALLOWED_KEYS;
}

function resolveAllowedScreenReaderCommands(
  selectedMode: ResolvedRunOptions["task"]["mode"],
  configuredAllowedScreenReaderCommands: readonly ScreenReaderCommand[] | undefined,
  screenReaderBackendId: ResolvedRunOptions["screenReaderBackendId"]
): ResolvedRunOptions["allowedScreenReaderCommands"] {
  if (selectedMode === "keyboard") {
    return undefined;
  }

  if (configuredAllowedScreenReaderCommands) {
    return configuredAllowedScreenReaderCommands;
  }

  if (!screenReaderBackendId) {
    throw new Error("Screen reader backend must be resolved before choosing allowed screen reader commands.");
  }

  return findScreenReaderBackendById(screenReaderBackendId).supportedCommands;
}

function resolveScreenReaderBackendId(
  selectedMode: ResolvedRunOptions["task"]["mode"],
  configuredScreenReaderBackend: ScreenReaderBackendPreference | undefined
): ResolvedRunOptions["screenReaderBackendId"] {
  if (selectedMode === "keyboard") {
    return undefined;
  }

  if (!configuredScreenReaderBackend) {
    throw new Error(
      `Missing screenReaderBackend. Set defaults.screenReaderBackend, modes.${selectedMode}.screenReaderBackend, or task.yml config.screenReaderBackend in rawstep.config.ts.`
    );
  }

  return resolveScreenReaderBackendPreference(configuredScreenReaderBackend).id;
}

function validateProjectMode(
  value: string,
  configPath: string
): ResolvedRunOptions["task"]["mode"] {
  if (
    value === "keyboard"
    || value === "screenreader-strict"
    || value === "screenreader-hybrid"
  ) {
    return value;
  }

  throw new Error(
    `Config file ${configPath} has unsupported mode preset: ${value}. Expected one of keyboard, screenreader-strict, screenreader-hybrid.`
  );
}
