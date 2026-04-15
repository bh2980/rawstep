import type { AgentProvider } from "@rawstep/agent";
import {
  isAllowedKey,
  SUPPORTED_KEY_LABELS,
  type AllowedKey,
  KeyboardActionDescriptor,
  KeyboardActionPlan,
  KeyboardActionRef,
  ScreenReaderActionDescriptor,
  ScreenReaderActionPlan,
  ScreenReaderActionRef
} from "@rawstep/action-catalog";
import { z } from "zod";
import {
  type MemorySetting,
  type ResolvedTask,
  type ScreenshotPolicy,
  type TaskInput,
  type UserModel
} from "@rawstep/definition";
import {
  isScreenReaderBackendId,
  type ScreenReaderBackendId
} from "@rawstep/runtime";
import {
  parseCommaSeparatedConfiguredScreenReaderActions,
  parseConfiguredScreenReaderActions
} from "./screenreader-actions";

export type CliRunOptions = {
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

export type ModeConfigShape = {
  outDir?: string;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  maxVerificationRetries?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: MemorySetting;
  allowedKeys?: KeyboardActionRef[];
  allowedScreenReaderActions?: ScreenReaderActionRef[];
  screenReaderBackend?: ScreenReaderBackendId;
};

export type ProjectDefaultsShape = {
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  prompt?: ProjectPromptShape;
};

export type ProjectConfig = {
  version: 1;
  defaults?: ProjectDefaultsShape;
  modes?: Partial<Record<UserModel, ModeConfigShape>>;
};

export type LoadedProjectConfig = {
  path: string;
  config: ProjectConfig;
};

export type ResolvedExecutionPolicy = {
  outDir: string;
  headless?: boolean;
  maxSteps: number;
  timeoutMs: number;
  maxVerificationRetries: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete: boolean;
  memory: {
    mode: "window" | "all";
    window?: number;
  };
  includeExperienceSummary: boolean;
  includeRationale: boolean;
};

export type ResolvedRunOptions = {
  task: ResolvedTask;
  taskFile: string;
  configFile?: string;
  mode?: UserModel;
  execution: ResolvedExecutionPolicy;
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  keyboardActionPlan: KeyboardActionPlan;
  screenReaderActionPlan?: ScreenReaderActionPlan;
  screenReaderBackendId?: ScreenReaderBackendId;
  prompt: ResolvedPromptOptions;
};

export type TaskExecutionDefaults = {
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
};

export type ProjectPromptShape = {
  dir?: string;
};

export type ResolvedPromptOptions = {
  promptDir: string;
  keyboardActions: readonly KeyboardActionDescriptor[];
  screenReaderActions: readonly ScreenReaderActionDescriptor[];
};

export const userModelSchema = z.enum(["keyboard", "screenreader-strict", "screenreader-hybrid"]);
export const agentProviderSchema = z.enum(["anthropic", "openai-compatible"]);
export const screenshotPolicySchema = z.enum(["all", "important", "failure-only", "none"]);
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const booleanSchema = z.boolean();
export const nonEmptyStringSchema = z.string().trim().min(1);
export const memorySettingSchema = z.union([nonNegativeIntegerSchema, z.literal("all")]);
export const allowedKeySchema = z.custom<AllowedKey>((value) => typeof value === "string" && isAllowedKey(value));
export const allowedKeysSchema = z.array(z.unknown());
export const allowedScreenReaderActionsSchema = z.array(z.unknown());
export const screenReaderBackendIdSchema = z.custom<ScreenReaderBackendId>(
  (value) => typeof value === "string" && isScreenReaderBackendId(value)
);

export function validateTaskInput(raw: unknown): TaskInput | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      'Task input must be an object like { email: "user@example.com", password: "secret123" }.'
    );
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error(
      'Task input must include at least one named value, for example { email: "user@example.com" }.'
    );
  }

  const normalized: Record<string, string> = {};
  const reservedKeys = new Set(["task", "text"]);
  for (const [key, value] of entries) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("Task input keys must be non-empty strings.");
    }
    if (reservedKeys.has(normalizedKey)) {
      throw new Error(`Task input key "${normalizedKey}" is reserved. Use a descriptive key like "email" or "password".`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Task input.${normalizedKey} must be a non-empty string.`);
    }
    normalized[normalizedKey] = value;
  }

  return normalized;
}

export function parseUserModel(value: unknown): UserModel {
  const result = userModelSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Unsupported mode: ${String(value)}. Expected one of keyboard, screenreader-strict, screenreader-hybrid.`
  );
}

export function parseAgentProvider(value: unknown): AgentProvider {
  const result = agentProviderSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Unsupported agent provider: ${String(value)}. Expected one of anthropic, openai-compatible.`
  );
}

export function parseScreenshotPolicy(value: unknown): ScreenshotPolicy {
  const result = screenshotPolicySchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Unsupported screenshot policy: ${String(value)}. Expected one of all, important, failure-only, none.`
  );
}

export function parseOptionalNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  const result = nonNegativeIntegerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return result.data;
}

export function parseOptionalBoolean(value: unknown, label: string): boolean {
  const result = booleanSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a boolean.`);
  }

  return result.data;
}

export function parseOptionalString(value: unknown, label: string): string {
  const result = nonEmptyStringSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return result.data;
}

export function parseMemorySetting(value: unknown, label: string): MemorySetting {
  const result = memorySettingSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a non-negative integer or "all".`);
  }

  return result.data;
}

export function parseAllowedKeys(value: unknown, label: string): AllowedKey[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of allowed key names.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${label}[${index}] must be one of ${SUPPORTED_KEY_LABELS}.`);
    }

    if (!isAllowedKey(entry)) {
      throw new Error(`${label}[${index}] must be one of ${SUPPORTED_KEY_LABELS}.`);
    }

    return entry;
  });
}

export function parseAllowedScreenReaderActions(value: unknown, label: string): ScreenReaderActionRef[] {
  return parseConfiguredScreenReaderActions(value, label);
}

export function parsePromptOverride(
  value: unknown,
  label: string,
  options: { allowDir: boolean }
): ProjectPromptShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  if (!options.allowDir) {
    throw new Error(`${label} is not allowed.`);
  }

  const candidate = value as Record<string, unknown>;
  return {
    dir: candidate.dir === undefined
      ? undefined
      : parseOptionalString(candidate.dir, `${label}.dir`)
  };
}

export function parseScreenReaderBackendId(value: unknown, label: string): ScreenReaderBackendId {
  const result = screenReaderBackendIdSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(`${label} must be one of guidepup-voiceover, guidepup-nvda, guidepup-virtual.`);
}

export function parseCommaSeparatedAllowedKeys(value: unknown, label: string): AllowedKey[] {
  return parseAllowedKeys(parseCommaSeparatedValues(value, label), label);
}

export function parseCommaSeparatedScreenReaderActions(value: unknown, label: string): ScreenReaderActionRef[] {
  return parseCommaSeparatedConfiguredScreenReaderActions(value, label);
}

function parseCommaSeparatedValues(value: unknown, label: string): string[] {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a comma-separated string.`);
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`${label} must include at least one value.`);
  }

  return entries;
}
