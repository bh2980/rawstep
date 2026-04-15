import { dirname, resolve } from "node:path";
import type { AgentProvider } from "@rawstep/agent";
import type {
  AllowedKey,
  KeyboardActionRef,
  ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import type {
  MemorySetting,
  ScreenReaderBackendId,
  ScreenshotPolicy,
  TaskOverrideSource,
  TaskSource,
  UserModel,
} from "@rawstep/definition";
import type { LoadedProjectConfig } from "../project/resolve";
import type { ProjectModePreset } from "../project/schema";

const DEFAULT_MAX_VERIFICATION_RETRIES = 2;

export type RunPlanCliOverrides = {
  taskFile: string;
  configFile?: string;
  mode?: UserModel;
  outDir?: string;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderActions?: ScreenReaderActionRef[];
  screenReaderBackendId?: ScreenReaderBackendId;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type ResolvedRunPlanPrecedence = {
  selectedMode: UserModel;
  outDir: string;
  maxSteps: number;
  timeoutMs: number;
  headless?: boolean;
  maxVerificationRetries: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete: boolean;
  memory: {
    mode: "window" | "all";
    window?: number;
  };
  includeExperienceSummary: boolean;
  includeRationale: boolean;
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  promptDir: string;
  overrideAllowedKeys?: AllowedKey[];
  configuredAllowedKeys?: KeyboardActionRef[];
  configuredAllowedScreenReaderActions?: ScreenReaderActionRef[];
  configuredScreenReaderBackend?: ScreenReaderBackendId;
};

type ResolveRunPlanPrecedenceInput = {
  cliOverrides: RunPlanCliOverrides;
  taskFile: string;
  taskSource: TaskSource;
  taskConfig?: TaskOverrideSource;
  projectConfig: LoadedProjectConfig;
};

export function resolveRunPlanPrecedence({
  cliOverrides,
  taskFile,
  taskSource,
  taskConfig,
  projectConfig,
}: ResolveRunPlanPrecedenceInput): ResolvedRunPlanPrecedence {
  const configPath = projectConfig.path;
  const configDir = dirname(configPath);
  const selectedMode = cliOverrides.mode
    ?? taskConfig?.mode
    ?? taskSource.mode;
  if (!selectedMode) {
    throw new Error(
      `Task file ${taskFile} is missing mode. Set mode in the task file, task config.mode, or pass --mode.`
    );
  }

  const modePreset = projectConfig.config.modes?.[selectedMode];
  if (!modePreset) {
    throw new Error(`Missing modes.${selectedMode} in ${configPath}. Add a preset for this mode to rawstep.config.ts.`);
  }

  const outDir = cliOverrides.outDir
    ?? resolveOutputDir(taskConfig?.outDir, dirname(taskFile))
    ?? resolveOutputDir(modePreset.outDir, configDir);
  if (!outDir) {
    throw new Error(`Missing output directory. Pass --out <dir> or set modes.${selectedMode}.outDir in rawstep.config.ts.`);
  }

  const maxSteps = cliOverrides.maxSteps
    ?? taskConfig?.maxSteps
    ?? taskSource.maxSteps
    ?? modePreset.maxSteps;
  if (maxSteps === undefined) {
    throw new Error(
      `Task file ${taskFile} is missing maxSteps. Set maxSteps in the task file, task config.maxSteps, or modes.${selectedMode}.maxSteps in rawstep.config.ts.`
    );
  }

  const timeoutMs = cliOverrides.timeoutMs
    ?? taskConfig?.timeoutMs
    ?? taskSource.timeoutMs
    ?? modePreset.timeoutMs;
  if (timeoutMs === undefined) {
    throw new Error(
      `Task file ${taskFile} is missing timeoutMs. Set timeoutMs in the task file, task config.timeoutMs, or modes.${selectedMode}.timeoutMs in rawstep.config.ts.`
    );
  }

  const memorySetting = resolveMemorySetting(cliOverrides, taskConfig, modePreset, selectedMode);

  return {
    selectedMode,
    outDir,
    maxSteps,
    timeoutMs,
    headless: cliOverrides.headless
      ?? taskConfig?.headless
      ?? modePreset.headless,
    maxVerificationRetries: taskConfig?.maxVerificationRetries
      ?? modePreset.maxVerificationRetries
      ?? DEFAULT_MAX_VERIFICATION_RETRIES,
    screenshotPolicy: cliOverrides.screenshotPolicy
      ?? taskConfig?.screenshots
      ?? modePreset.screenshots,
    verifierAutoComplete: cliOverrides.verifierAutoComplete
      ?? taskConfig?.verifierAutoComplete
      ?? modePreset.verifierAutoComplete
      ?? false,
    memory: memorySetting === "all"
      ? { mode: "all" }
      : { mode: "window", window: memorySetting },
    includeExperienceSummary: cliOverrides.includeExperienceSummary
      ?? taskConfig?.includeExperienceSummary
      ?? modePreset.includeExperienceSummary
      ?? false,
    includeRationale: cliOverrides.includeRationale
      ?? taskConfig?.includeRationale
      ?? modePreset.includeRationale
      ?? false,
    provider: cliOverrides.provider
      ?? projectConfig.config.defaults?.provider,
    apiKey: projectConfig.config.defaults?.apiKey,
    model: cliOverrides.model
      ?? projectConfig.config.defaults?.model,
    baseURL: cliOverrides.baseURL
      ?? projectConfig.config.defaults?.baseURL,
    promptDir: resolve(configDir, projectConfig.config.defaults?.prompt?.dir ?? "prompt"),
    overrideAllowedKeys: cliOverrides.allowedKeys ?? taskConfig?.allowedKeys,
    configuredAllowedKeys: modePreset.allowedKeys,
    configuredAllowedScreenReaderActions: cliOverrides.allowedScreenReaderActions
      ?? taskConfig?.allowedScreenReaderActions
      ?? modePreset.allowedScreenReaderActions,
    configuredScreenReaderBackend: cliOverrides.screenReaderBackendId
      ?? taskConfig?.screenReaderBackend
      ?? modePreset.screenReaderBackend,
  };
}

function resolveOutputDir(rawOutDir: string | undefined, baseDir: string | undefined): string | undefined {
  if (!rawOutDir || !baseDir) {
    return undefined;
  }

  return resolve(baseDir, rawOutDir);
}

function resolveMemorySetting(
  cliOverrides: RunPlanCliOverrides,
  taskConfig: TaskOverrideSource | undefined,
  modePreset: ProjectModePreset,
  selectedMode: UserModel,
): MemorySetting {
  const memorySetting = cliOverrides.agentMemoryAll === true
    ? "all"
    : cliOverrides.agentMemoryAll === false
      ? cliOverrides.agentMemoryWindow
      : cliOverrides.agentMemoryWindow
        ?? taskConfig?.memory
        ?? modePreset.memory;
  if (memorySetting === undefined) {
    throw new Error(
      `Missing memory setting. Pass --agent-memory-window/--agent-memory-all or set task config.memory or modes.${selectedMode}.memory in rawstep.config.ts.`
    );
  }

  return memorySetting;
}
