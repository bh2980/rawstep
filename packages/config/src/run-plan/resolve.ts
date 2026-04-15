import { basename } from "node:path";
import {
  buildKeyboardActionPlan,
  type KeyboardActionDescriptor,
  type KeyboardActionPlan,
  type ScreenReaderActionDescriptor,
  type ScreenReaderActionPlan,
} from "@rawstep/action-catalog";
import {
  allowsRawKeyActions,
  requiresScreenReaderBackend,
  resolveTaskSource,
  supportsVisualObservation,
  type ResolvedTask,
  type ScreenReaderBackendId,
  type TaskOverrideSource,
  type TaskSource,
} from "@rawstep/definition";
import { buildKeyboardActionPlanFromAllowedKeys } from "../keyboard-actions";
import type { AgentProvider } from "../project/provider";
import { loadProjectConfig } from "../project/resolve";
import { resolveConfiguredScreenReaderActions } from "../screenreader-actions";
import { resolveRunPlanPrecedence, type RunPlanCliOverrides } from "./precedence";
import { readTaskFile, resolveTaskUrl } from "./task-file";
import { validateTaskSource } from "@rawstep/definition";

export type ResolvedRunPlan = {
  task: ResolvedTask;
  paths: {
    taskFile: string;
    configFile: string;
    promptDir: string;
    outDir: string;
  };
  agent: {
    provider?: AgentProvider;
    apiKey?: string;
    model?: string;
    baseURL?: string;
    includeExperienceSummary: boolean;
    includeRationale: boolean;
    memory: {
      mode: "window" | "all";
      window?: number;
    };
  };
  execution: {
    headless?: boolean;
    maxVerificationRetries: number;
    verifierAutoComplete: boolean;
    screenshotPolicy?: import("@rawstep/definition").ScreenshotPolicy;
  };
  interaction: {
    keyboardActionPlan: KeyboardActionPlan;
    screenReaderActionPlan?: ScreenReaderActionPlan;
    screenReaderBackendId?: ScreenReaderBackendId;
  };
  prompt: {
    keyboardActions: readonly KeyboardActionDescriptor[];
    screenReaderActions: readonly ScreenReaderActionDescriptor[];
  };
};

type LoadedTaskSource = {
  absoluteTaskFile: string;
  taskId: string;
  taskConfig?: TaskOverrideSource;
  parsed: TaskSource;
};

export async function resolveRunPlan(cliOverrides: RunPlanCliOverrides): Promise<ResolvedRunPlan> {
  const taskSource = await loadTaskSource(cliOverrides.taskFile);
  const projectConfig = await loadProjectConfig(cliOverrides.configFile);
  const merged = resolveRunPlanPrecedence({
    cliOverrides,
    taskFile: taskSource.absoluteTaskFile,
    taskSource: taskSource.parsed,
    taskConfig: taskSource.taskConfig,
    projectConfig,
  });

  if (supportsVisualObservation(merged.selectedMode) && merged.configuredAllowedScreenReaderActions) {
    throw new Error(`allowedScreenReaderActions is not allowed in ${merged.selectedMode} mode.`);
  }

  if (supportsVisualObservation(merged.selectedMode) && merged.configuredScreenReaderBackend) {
    throw new Error(`screenReaderBackend is not allowed in ${merged.selectedMode} mode.`);
  }

  if (!allowsRawKeyActions(merged.selectedMode)
    && (merged.overrideAllowedKeys !== undefined || merged.configuredAllowedKeys !== undefined)
  ) {
    throw new Error(`allowedKeys is not allowed in ${merged.selectedMode} mode.`);
  }

  const task = resolveTaskSource(taskSource.parsed, {
    taskId: taskSource.taskId,
    resolvedUrl: resolveTaskUrl(taskSource.parsed.url, taskSource.absoluteTaskFile),
    mode: merged.selectedMode,
    maxSteps: merged.maxSteps,
    timeoutMs: merged.timeoutMs,
  });
  const screenReaderBackendId = resolveScreenReaderBackendId(
    merged.selectedMode,
    merged.configuredScreenReaderBackend,
  );
  const { plan: screenReaderActionPlan, promptActions } = resolveAllowedScreenReaderActions(
    merged.selectedMode,
    merged.configuredAllowedScreenReaderActions,
    screenReaderBackendId,
  );
  const keyboardActionPlan = resolveKeyboardActionPlan(
    merged.selectedMode,
    merged.overrideAllowedKeys,
    merged.configuredAllowedKeys,
  );

  return {
    task,
    paths: {
      taskFile: taskSource.absoluteTaskFile,
      configFile: projectConfig.path,
      promptDir: merged.promptDir,
      outDir: merged.outDir,
    },
    agent: {
      provider: merged.provider,
      apiKey: merged.apiKey,
      model: merged.model,
      baseURL: merged.baseURL,
      includeExperienceSummary: merged.includeExperienceSummary,
      includeRationale: merged.includeRationale,
      memory: merged.memory,
    },
    execution: {
      headless: merged.headless,
      maxVerificationRetries: merged.maxVerificationRetries,
      verifierAutoComplete: merged.verifierAutoComplete,
      screenshotPolicy: merged.screenshotPolicy,
    },
    interaction: {
      keyboardActionPlan,
      screenReaderActionPlan,
      screenReaderBackendId,
    },
    prompt: {
      keyboardActions: keyboardActionPlan.descriptors,
      screenReaderActions: promptActions,
    },
  };
}

async function loadTaskSource(taskFile: string): Promise<LoadedTaskSource> {
  const loaded = await readTaskFile(taskFile);
  const parsed = validateTaskSource(loaded.raw, `Task file ${loaded.absoluteTaskFile}`);
  const taskId = parsed.id ?? stripFileExtension(basename(loaded.absoluteTaskFile));

  return {
    absoluteTaskFile: loaded.absoluteTaskFile,
    taskId,
    taskConfig: parsed.config,
    parsed,
  };
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function resolveKeyboardActionPlan(
  selectedMode: ResolvedTask["mode"],
  overrideAllowedKeys: readonly import("@rawstep/action-catalog").AllowedKey[] | undefined,
  configuredAllowedKeys: readonly import("@rawstep/action-catalog").KeyboardActionRef[] | undefined,
): KeyboardActionPlan {
  if (!allowsRawKeyActions(selectedMode)) {
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
  selectedMode: ResolvedTask["mode"],
  configuredAllowedScreenReaderActions: readonly import("@rawstep/action-catalog").ScreenReaderActionRef[] | undefined,
  screenReaderBackendId: ScreenReaderBackendId | undefined,
): {
  plan: ScreenReaderActionPlan | undefined;
  promptActions: readonly ScreenReaderActionDescriptor[];
} {
  if (supportsVisualObservation(selectedMode)) {
    return {
      plan: undefined,
      promptActions: [],
    };
  }

  if (!screenReaderBackendId) {
    throw new Error("Screen reader backend must be resolved before choosing allowed screen reader actions.");
  }

  return resolveConfiguredScreenReaderActions(
    configuredAllowedScreenReaderActions,
    screenReaderBackendId,
  );
}

function resolveScreenReaderBackendId(
  selectedMode: ResolvedTask["mode"],
  configuredScreenReaderBackend: ScreenReaderBackendId | undefined,
): ScreenReaderBackendId | undefined {
  if (!requiresScreenReaderBackend(selectedMode)) {
    return undefined;
  }

  if (!configuredScreenReaderBackend) {
    throw new Error(
      `Missing screenReaderBackend. Set modes.${selectedMode}.screenReaderBackend in rawstep.config.ts or task config.screenReaderBackend in the task file.`
    );
  }

  return configuredScreenReaderBackend;
}
