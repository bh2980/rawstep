import { dirname, resolve } from "node:path";
import type {
  AllowedKey,
  KeyboardActionRef,
  ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import type {
  MemorySetting,
  NavigationPolicy,
  PlanningConfig,
  ReasoningEffort,
  ResolvedNavigationPolicy,
  ScreenReaderBackendId,
  ScreenReaderObserveConfig,
  ScreenshotPolicy,
  TaskOverrideSource,
  TaskSource,
  UserModel,
  VoiceOverConfig,
} from "@rawstep/definition";
import type { LoadedProjectConfig } from "../project/resolve";
import type { ProjectModePreset } from "../project/schema";
import type { AgentProvider } from "../project/provider";

const DEFAULT_MAX_VERIFICATION_RETRIES = 2;
const DEFAULT_MODE_OUT_DIRS = {
  keyboard: ".rawstep/out/keyboard",
  screenreader: ".rawstep/out/screenreader",
} as const satisfies Record<UserModel, string>;

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
  reasoningEffort?: ReasoningEffort;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderActions?: ScreenReaderActionRef[];
  screenReaderBackendId?: ScreenReaderBackendId;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type ResolvedRunPlanPrecedence = {
  selectedMode: UserModel;
  outDirRoot: string;
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
  reasoningEffort?: ReasoningEffort;
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  promptDir: string;
  overrideAllowedKeys?: AllowedKey[];
  configuredAllowedKeys?: KeyboardActionRef[];
  configuredAllowedScreenReaderActions?: ScreenReaderActionRef[];
  configuredScreenReaderBackend?: ScreenReaderBackendId;
  configuredScreenReaderObserve?: ScreenReaderObserveConfig;
  configuredVoiceOver?: VoiceOverConfig;
  configuredNavigation: ResolvedNavigationPolicy;
  planning: Required<PlanningConfig>;
};

const DEFAULT_PLANNING_BY_MODE = {
  keyboard: {
    enabled: true,
    reflectionCadence: 10,
    initialDelaySteps: 0,
    firstReflectionDelaySteps: 10
  },
  screenreader: {
    enabled: true,
    reflectionCadence: 10,
    initialDelaySteps: 3,
    firstReflectionDelaySteps: 3
  }
} as const satisfies Record<UserModel, Required<PlanningConfig>>;

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

  const outDirRoot = cliOverrides.outDir
    ?? resolveOutputRootDir(taskConfig?.outDir, dirname(taskFile))
    ?? resolveOutputRootDir(modePreset.outDir, configDir);
  const resolvedOutDirRoot = outDirRoot
    ?? resolve(configDir, DEFAULT_MODE_OUT_DIRS[selectedMode]);

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
    outDirRoot: resolvedOutDirRoot,
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
    reasoningEffort: cliOverrides.reasoningEffort
      ?? taskConfig?.reasoningEffort
      ?? projectConfig.config.defaults?.reasoningEffort,
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
    configuredScreenReaderObserve: taskConfig?.observe || modePreset.observe
      ? {
          ...(modePreset.observe ?? {}),
          ...(taskConfig?.observe ?? {})
        }
      : undefined,
    configuredVoiceOver: taskConfig?.voiceOver || modePreset.voiceOver
      ? {
          ...(modePreset.voiceOver ?? {}),
          ...(taskConfig?.voiceOver ?? {})
        }
      : undefined,
    configuredNavigation: resolveNavigationPolicy(taskConfig?.navigation, modePreset.navigation),
    planning: resolvePlanningConfig(selectedMode, taskConfig?.planning, modePreset.planning),
  };
}

function resolveOutputRootDir(rawOutDir: string | undefined, baseDir: string | undefined): string | undefined {
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

function resolvePlanningConfig(
  selectedMode: UserModel,
  taskPlanning: PlanningConfig | undefined,
  modePlanning: PlanningConfig | undefined,
): Required<PlanningConfig> {
  const defaults = DEFAULT_PLANNING_BY_MODE[selectedMode];
  const enabled = taskPlanning?.enabled
    ?? modePlanning?.enabled
    ?? defaults.enabled;
  const reflectionCadence = taskPlanning?.reflectionCadence
    ?? modePlanning?.reflectionCadence
    ?? defaults.reflectionCadence;
  const initialDelaySteps = taskPlanning?.initialDelaySteps
    ?? modePlanning?.initialDelaySteps
    ?? defaults.initialDelaySteps;
  const firstReflectionDelaySteps = taskPlanning?.firstReflectionDelaySteps
    ?? modePlanning?.firstReflectionDelaySteps
    ?? defaults.firstReflectionDelaySteps;

  if (!Number.isInteger(reflectionCadence) || reflectionCadence < 1) {
    throw new Error("planning.reflectionCadence must be an integer greater than or equal to 1.");
  }
  if (!Number.isInteger(initialDelaySteps) || initialDelaySteps < 0) {
    throw new Error("planning.initialDelaySteps must be an integer greater than or equal to 0.");
  }
  if (!Number.isInteger(firstReflectionDelaySteps) || firstReflectionDelaySteps < 0) {
    throw new Error("planning.firstReflectionDelaySteps must be an integer greater than or equal to 0.");
  }

  return {
    enabled,
    reflectionCadence,
    initialDelaySteps,
    firstReflectionDelaySteps
  };
}

function resolveNavigationPolicy(
  taskNavigation: NavigationPolicy | undefined,
  modeNavigation: NavigationPolicy | undefined,
): ResolvedNavigationPolicy {
  const selectedNavigation = taskNavigation ?? modeNavigation;
  const strategy = selectedNavigation?.strategy ?? "same-origin";

  if (strategy === "allow-url-list") {
    return {
      strategy,
      allowUrlList: selectedNavigation.allowUrlList
    };
  }

  return {
    strategy
  };
}
