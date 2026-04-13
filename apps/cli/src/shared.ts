import type { AgentProvider } from "@a11y-task/agent";
import type { ScreenshotPolicy, Task, UserModel } from "@a11y-task/core";

export type CliRunOptions = {
  taskFile: string;
  configFile?: string;
  mode?: UserModel;
  outDir?: string;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type TaskFileShape = Partial<Task> & {
  url?: string;
  goal?: string;
  id?: string;
  config?: TaskConfigOverride;
};

export type RunConfigShape = {
  mode?: UserModel;
  outDir?: string;
  maxSteps?: number;
  timeoutMs?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
};

export type AgentMemoryConfigShape = {
  window?: number;
  all?: boolean;
};

export type AgentConfigShape = {
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: AgentMemoryConfigShape;
  apiKey?: string;
};

export type TaskConfigOverride = {
  run?: RunConfigShape;
  agent?: AgentConfigShape;
};

export type ProjectConfig = {
  version: 1;
  defaults?: TaskConfigOverride;
  tasks?: Record<string, TaskConfigOverride>;
};

export type LoadedProjectConfig = {
  path: string;
  config: ProjectConfig;
};

export type ResolvedRunOptions = {
  task: Task;
  taskFile: string;
  configFile?: string;
  outDir: string;
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll: boolean;
  includeExperienceSummary: boolean;
  includeRationale: boolean;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type TaskExecutionDefaults = {
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
};

export function validateTaskInput(raw: unknown): Task["input"] {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('Task input must be an object with a non-empty "text" field.');
  }

  const text = (raw as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error('Task input.text must be a non-empty string.');
  }

  return { text };
}

export function parseUserModel(value: unknown): UserModel {
  if (
    value === "keyboard"
    || value === "screenreader-strict"
    || value === "screenreader-hybrid"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported mode: ${String(value)}. Expected one of keyboard, screenreader-strict, screenreader-hybrid.`
  );
}

export function parseAgentProvider(value: unknown): AgentProvider {
  if (
    value === "anthropic"
    || value === "openai-compatible"
    || value === "stub"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported agent provider: ${String(value)}. Expected one of anthropic, openai-compatible, stub.`
  );
}

export function parseScreenshotPolicy(value: unknown): ScreenshotPolicy {
  if (
    value === "all"
    || value === "important"
    || value === "failure-only"
    || value === "none"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported screenshot policy: ${String(value)}. Expected one of all, important, failure-only, none.`
  );
}

export function parseOptionalNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

export function parseOptionalBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

export function parseOptionalString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}
