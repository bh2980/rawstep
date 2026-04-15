import { readFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { config as loadDotenv } from "dotenv";
import ts from "typescript";
import {
  type AllowedKey,
  buildKeyboardActionPlan,
  type KeyboardActionPlan,
  type KeyboardActionRef
} from "@rawstep/action-catalog";
import {
  type UserModel
} from "@rawstep/definition";
import {
  findScreenReaderBackendById
} from "@rawstep/runtime";
import {
  type CliRunOptions,
  type LoadedProjectConfig,
  type ModeConfigShape,
  type ProjectDefaultsShape,
  type ProjectConfig,
  parseAllowedScreenReaderActions,
  parsePromptOverride,
  parseScreenReaderBackendId,
  type ResolvedRunOptions
} from "./shared";
import { resolveExecutionPolicy } from "./execution-policy";
import {
  kb,
  buildKeyboardActionPlanFromAllowedKeys,
  parseConfiguredKeyboardActions
} from "./keyboard-actions";
import {
  sr,
  srx,
  resolveConfiguredScreenReaderActions
} from "./screenreader-actions";
import { configRootSchema, parseProjectDefaultsObject, parseTaskConfigObject } from "./schema";
import { loadTaskSource, resolveTask } from "./task-loader";

const loadedEnvDirs = new Set<string>();

export async function loadConfig(configFile?: string): Promise<LoadedProjectConfig> {
  const resolvedPath = configFile
    ? validateExplicitConfigPath(configFile)
    : await findConfigFile();
  if (!resolvedPath) {
    throw new Error(
      "Missing rawstep.config.ts. Put rawstep.config.ts at the project root or pass --config <path>."
    );
  }

  loadEnvFileForConfig(resolvedPath);

  const parsedResult = configRootSchema.safeParse(await loadTsConfigModule(resolvedPath));
  if (!parsedResult.success || parsedResult.data.version !== 1) {
    throw new Error(`Config file ${resolvedPath} must include version: 1.`);
  }
  const parsed = parsedResult.data;

  const allowedRootKeys = new Set(["version", "defaults", "modes"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedRootKeys.has(key)) {
      throw new Error(`Config file ${resolvedPath} ${key} is not allowed.`);
    }
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
      `Task file ${taskSource.absoluteTaskFile} is missing mode. Set mode in the task file, task config.mode, or pass --mode.`
    );
  }

  const modePreset = loadedConfig.config.modes?.[selectedMode];
  if (!modePreset) {
    throw new Error(`Missing modes.${selectedMode} in ${configPath}. Add a preset for this mode to rawstep.config.ts.`);
  }

  const execution = resolveExecutionPolicy({
    cliOptions,
    taskSource,
    selectedMode,
    modePreset,
    configDir
  });
  const task = resolveTask(taskSource, {
    mode: selectedMode,
    maxSteps: execution.maxSteps,
    timeoutMs: execution.timeoutMs
  });

  const overrideAllowedKeys =
    cliOptions.allowedKeys
    ?? taskSource.taskConfig?.allowedKeys;
  const configuredAllowedKeys = modePreset?.allowedKeys;
  const configuredAllowedScreenReaderActions =
    cliOptions.allowedScreenReaderActions
    ??
    taskSource.taskConfig?.allowedScreenReaderActions
    ?? modePreset?.allowedScreenReaderActions;
  const configuredModeScreenReaderBackend =
    cliOptions.screenReaderBackendId
    ??
    taskSource.taskConfig?.screenReaderBackend
    ?? modePreset?.screenReaderBackend;

  if (selectedMode === "keyboard" && configuredAllowedScreenReaderActions) {
    throw new Error("allowedScreenReaderActions is not allowed in keyboard mode.");
  }

  if (selectedMode === "keyboard" && configuredModeScreenReaderBackend) {
    throw new Error("screenReaderBackend is not allowed in keyboard mode.");
  }

  if (
    selectedMode === "screenreader-strict"
    && (overrideAllowedKeys !== undefined || configuredAllowedKeys !== undefined)
  ) {
    throw new Error("allowedKeys is not allowed in screenreader-strict mode.");
  }

  const screenReaderBackendId = resolveScreenReaderBackendId(selectedMode, configuredModeScreenReaderBackend);
  const resolvedScreenReaderActions = resolveAllowedScreenReaderActions(
    selectedMode,
    configuredAllowedScreenReaderActions,
    screenReaderBackendId
  );
  const keyboardActionPlan = resolveKeyboardActionPlan(
    selectedMode,
    overrideAllowedKeys,
    configuredAllowedKeys
  );
  const prompt = resolvePromptOptions(
    configDir,
    projectDefaults?.prompt,
    keyboardActionPlan.descriptors,
    resolvedScreenReaderActions.promptActions
  );

  return {
    task,
    taskFile: taskSource.absoluteTaskFile,
    configFile: configPath,
    mode: task.mode,
    execution,
    provider: cliOptions.provider
      ?? projectDefaults?.provider,
    apiKey: projectDefaults?.apiKey,
    model: cliOptions.model
      ?? projectDefaults?.model,
    baseURL: cliOptions.baseURL
      ?? projectDefaults?.baseURL,
    keyboardActionPlan,
    screenReaderActionPlan: resolvedScreenReaderActions.plan,
    screenReaderBackendId,
    prompt
  };
}

async function findConfigFile(startDir = process.cwd()): Promise<string | undefined> {
  let currentDir = resolve(startDir);

  while (true) {
    const tsCandidate = join(currentDir, "rawstep.config.ts");
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

function validateExplicitConfigPath(configFile: string): string {
  const resolvedPath = resolve(configFile);
  if (!resolvedPath.endsWith(".ts")) {
    throw new Error(`Config file must be a rawstep.config.ts file. Received: ${resolvedPath}`);
  }

  return resolvedPath;
}

function loadEnvFileForConfig(configPath: string): void {
  const configDir = dirname(configPath);
  if (loadedEnvDirs.has(configDir)) {
    return;
  }

  loadDotenv({
    path: join(configDir, ".env"),
    override: false
  });
  loadedEnvDirs.add(configDir);
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
    if (specifier === "@rawstep/cli/config") {
      return {
        defineConfig<T>(config: T): T {
          return config;
        },
        kb,
        sr,
        srx
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
    apiKey: candidate.apiKey,
    model: candidate.model,
    baseURL: candidate.baseURL,
    prompt: candidate.prompt === undefined
      ? undefined
      : validateProjectPrompt(candidate.prompt, configPath)
  };
}

function validateModePresets(
  rawModes: unknown,
  configPath: string
): Partial<Record<UserModel, ModeConfigShape>> | undefined {
  if (rawModes === undefined || rawModes === null) {
    return undefined;
  }

  if (typeof rawModes !== "object" || Array.isArray(rawModes)) {
    throw new Error(`Config file ${configPath} modes must be an object.`);
  }

  const result: Partial<Record<UserModel, ModeConfigShape>> = {};

  for (const [modeKey, rawPreset] of Object.entries(rawModes as Record<string, unknown>)) {
    const mode = validateProjectMode(modeKey, configPath);
    result[mode] = validateModePreset(rawPreset, configPath, mode);
  }

  return result;
}

function validateModePreset(
  rawPreset: unknown,
  configPath: string,
  mode: UserModel
): ModeConfigShape {
  const preset = validateModePresetOverride(rawPreset, `Config file ${configPath} modes.${mode}`);
  if (mode === "keyboard" && preset?.allowedScreenReaderActions) {
    throw new Error(`Config file ${configPath} modes.${mode}.allowedScreenReaderActions is not allowed in keyboard mode.`);
  }
  if (mode === "keyboard" && preset?.screenReaderBackend) {
    throw new Error(`Config file ${configPath} modes.${mode}.screenReaderBackend is not allowed in keyboard mode.`);
  }
  if (mode === "screenreader-strict" && preset?.allowedKeys) {
    throw new Error(`Config file ${configPath} modes.${mode}.allowedKeys is not allowed in screenreader-strict mode.`);
  }
  return {
    outDir: preset?.outDir,
    headless: preset?.headless,
    maxSteps: preset?.maxSteps,
    timeoutMs: preset?.timeoutMs,
    maxVerificationRetries: preset?.maxVerificationRetries,
    screenshots: preset?.screenshots,
    verifierAutoComplete: preset?.verifierAutoComplete,
    includeExperienceSummary: preset?.includeExperienceSummary,
    includeRationale: preset?.includeRationale,
    memory: preset?.memory,
    allowedKeys: preset?.allowedKeys,
    allowedScreenReaderActions: preset?.allowedScreenReaderActions,
    screenReaderBackend: preset?.screenReaderBackend
  };
}

function validateModePresetOverride(raw: unknown, label: string): ModeConfigShape | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} config must be an object.`);
  }

  const candidate = parseTaskConfigObject(raw, label);

  return {
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
      : parseConfiguredKeyboardActions(candidate.allowedKeys, `${label}.allowedKeys`),
    allowedScreenReaderActions: candidate.allowedScreenReaderActions === undefined
      ? undefined
      : parseAllowedScreenReaderActions(
        candidate.allowedScreenReaderActions,
        `${label}.allowedScreenReaderActions`
      ),
    screenReaderBackend: candidate.screenReaderBackend === undefined
      ? undefined
      : parseScreenReaderBackendId(candidate.screenReaderBackend, `${label}.screenReaderBackend`)
  };
}

function validateProjectPrompt(
  rawPrompt: unknown,
  configPath: string
): ProjectDefaultsShape["prompt"] {
  return parseProjectPrompt(rawPrompt, `Config file ${configPath} defaults.prompt`);
}

function parseProjectPrompt(
  rawPrompt: unknown,
  label: string
): ProjectDefaultsShape["prompt"] {
  return parsePromptOverride(rawPrompt, label, { allowDir: true });
}

function resolveKeyboardActionPlan(
  selectedMode: UserModel,
  overrideAllowedKeys: readonly AllowedKey[] | undefined,
  configuredAllowedKeys: readonly KeyboardActionRef[] | undefined
): KeyboardActionPlan {
  if (selectedMode === "screenreader-strict") {
    return buildKeyboardActionPlan([]);
  }

  if (overrideAllowedKeys) {
    return buildKeyboardActionPlanFromAllowedKeys(overrideAllowedKeys);
  }

  if (configuredAllowedKeys) {
    return buildKeyboardActionPlan(configuredAllowedKeys);
  }

  return buildKeyboardActionPlan();
}

function resolveAllowedScreenReaderActions(
  selectedMode: UserModel,
  configuredAllowedScreenReaderActions: readonly import("@rawstep/action-catalog").ScreenReaderActionRef[] | undefined,
  screenReaderBackendId: ResolvedRunOptions["screenReaderBackendId"]
): {
  plan: ResolvedRunOptions["screenReaderActionPlan"];
  promptActions: ResolvedRunOptions["prompt"]["screenReaderActions"];
} {
  if (selectedMode === "keyboard") {
    return {
      plan: undefined,
      promptActions: []
    };
  }

  if (!screenReaderBackendId) {
    throw new Error("Screen reader backend must be resolved before choosing allowed screen reader actions.");
  }

  const backend = findScreenReaderBackendById(screenReaderBackendId);
  return resolveConfiguredScreenReaderActions(
    configuredAllowedScreenReaderActions,
    screenReaderBackendId,
    backend.capabilities
  );
}

function resolvePromptOptions(
  configDir: string,
  projectPrompt: ProjectDefaultsShape["prompt"] | undefined,
  keyboardActions: ResolvedRunOptions["prompt"]["keyboardActions"],
  screenReaderActions: ResolvedRunOptions["prompt"]["screenReaderActions"]
): ResolvedRunOptions["prompt"] {
  return {
    promptDir: resolve(configDir, projectPrompt?.dir ?? "prompt"),
    keyboardActions,
    screenReaderActions
  };
}

function resolveScreenReaderBackendId(
  selectedMode: UserModel,
  configuredScreenReaderBackend: ResolvedRunOptions["screenReaderBackendId"]
): ResolvedRunOptions["screenReaderBackendId"] {
  if (selectedMode === "keyboard") {
    return undefined;
  }

  if (!configuredScreenReaderBackend) {
    throw new Error(
      `Missing screenReaderBackend. Set modes.${selectedMode}.screenReaderBackend in rawstep.config.ts or task config.screenReaderBackend in the task file.`
    );
  }

  return findScreenReaderBackendById(configuredScreenReaderBackend).id;
}

function validateProjectMode(
  value: string,
  configPath: string
): UserModel {
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
