import type { AgentProvider } from "@rawstep/agent";
import { z } from "zod";
import {
  isAllowedKey,
  type ConfiguredScreenReaderAction,
  type ResolvedPromptScreenReaderAction,
  type AllowedKey,
  type ScreenshotPolicy,
  type Task,
  type UserModel
} from "@rawstep/core";
import {
  isScreenReaderBackendId,
  type ScreenReaderBackendId
} from "@rawstep/observer-screenreader";
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
  allowedScreenReaderActions?: ConfiguredScreenReaderAction[];
  screenReaderBackendId?: ScreenReaderBackendId;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type MemorySetting = number | "all";

export type TaskFileShape = Partial<Task> & {
  url?: string;
  goal?: string;
  id?: string;
  config?: TaskConfigOverride;
};

export type ModeConfigShape = {
  outDir?: string;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: MemorySetting;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderActions?: ConfiguredScreenReaderAction[];
  screenReaderBackend?: ScreenReaderBackendId;
  prompt?: PromptOverrideShape;
};

export type ProjectDefaultsShape = {
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  prompt?: ProjectPromptShape;
};

export type TaskConfigOverride = {
  mode?: UserModel;
  outDir?: string;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: MemorySetting;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderActions?: ConfiguredScreenReaderAction[];
  screenReaderBackend?: ScreenReaderBackendId;
  prompt?: PromptOverrideShape;
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

export type ResolvedRunOptions = {
  task: Task;
  taskFile: string;
  configFile?: string;
  outDir: string;
  mode?: UserModel;
  headless?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll: boolean;
  includeExperienceSummary: boolean;
  includeRationale: boolean;
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  allowedKeys: readonly AllowedKey[];
  allowedScreenReaderActions?: readonly import("@rawstep/core").AllowedScreenReaderAction[];
  screenReaderBackendId?: ScreenReaderBackendId;
  prompt: ResolvedPromptOptions;
};

export type TaskExecutionDefaults = {
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
};

export type PromptOverrideShape = {
  extraInstructions?: string;
  keyHints?: Partial<Record<AllowedKey, string>>;
};

export type ProjectPromptShape = PromptOverrideShape & {
  dir?: string;
};

export type ResolvedPromptOptions = {
  promptDir: string;
  extraInstructions?: string;
  keyHints: Partial<Record<AllowedKey, string>>;
  screenReaderActions: readonly ResolvedPromptScreenReaderAction[];
};

export const userModelSchema = z.enum(["keyboard", "screenreader-strict", "screenreader-hybrid"]);
export const agentProviderSchema = z.enum(["anthropic", "openai-compatible"]);
export const screenshotPolicySchema = z.enum(["all", "important", "failure-only", "none"]);
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const booleanSchema = z.boolean();
export const nonEmptyStringSchema = z.string().trim().min(1);
export const memorySettingSchema = z.union([nonNegativeIntegerSchema, z.literal("all")]);
export const allowedKeySchema = z.custom<AllowedKey>((value) => typeof value === "string" && isAllowedKey(value));
export const allowedKeysSchema = z.array(allowedKeySchema);
export const allowedScreenReaderActionsSchema = z.array(z.unknown());
export const screenReaderBackendIdSchema = z.custom<ScreenReaderBackendId>(
  (value) => typeof value === "string" && isScreenReaderBackendId(value)
);

export function validateTaskInput(raw: unknown): Task["input"] {
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
  for (const [key, value] of entries) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("Task input keys must be non-empty strings.");
    }
    if (normalizedKey === "task") {
      throw new Error('Task input key "task" is reserved. Use a descriptive key like "email" or "password".');
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Task input.${normalizedKey} must be a non-empty string.`);
    }
    normalized[normalizedKey] = value;
  }

  if ("text" in normalized) {
    throw new Error(
      'Task input.text is removed. Use named inputs like { email: "user@example.com" }.'
    );
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
      throw new Error(`${label}[${index}] must be one of ${ALLOWED_KEY_LABELS}.`);
    }

    if (!isAllowedKey(entry)) {
      throw new Error(`${label}[${index}] must be one of ${ALLOWED_KEY_LABELS}.`);
    }

    return entry;
  });
}

export function parseAllowedScreenReaderActions(value: unknown, label: string): ConfiguredScreenReaderAction[] {
  return parseConfiguredScreenReaderActions(value, label);
}

export function parsePromptOverride(
  value: unknown,
  label: string,
  options: { allowDir: boolean }
): ProjectPromptShape | PromptOverrideShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.screenReaderCommandHints !== undefined) {
    throw new Error(
      `${label}.screenReaderCommandHints is removed. Put hints on allowedScreenReaderActions entries instead.`
    );
  }
  if (candidate.screenReaderActionHints !== undefined) {
    throw new Error(
      `${label}.screenReaderActionHints is removed. Put hints on allowedScreenReaderActions entries instead.`
    );
  }
  const allowedKeys = new Set([
    "extraInstructions",
    "keyHints",
    ...(options.allowDir ? ["dir"] : [])
  ]);

  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }

  const extraInstructions = candidate.extraInstructions === undefined
    ? undefined
    : parseOptionalString(candidate.extraInstructions, `${label}.extraInstructions`);
  const keyHints = candidate.keyHints === undefined
    ? undefined
    : parsePromptKeyHints(candidate.keyHints, `${label}.keyHints`);

  if (!options.allowDir) {
    if (candidate.dir !== undefined) {
      throw new Error(`${label}.dir is not allowed.`);
    }

    return {
      extraInstructions,
      keyHints
    };
  }

  return {
    dir: candidate.dir === undefined
      ? undefined
      : parseOptionalString(candidate.dir, `${label}.dir`),
    extraInstructions,
    keyHints
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

export function parseCommaSeparatedScreenReaderActions(value: unknown, label: string): ConfiguredScreenReaderAction[] {
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

function parsePromptKeyHints(
  value: unknown,
  label: string
): Partial<Record<AllowedKey, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by allowed key names.`);
  }

  const result: Partial<Record<AllowedKey, string>> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isAllowedKey(key)) {
      throw new Error(`${label}.${key} must be one of ${ALLOWED_KEY_LABELS}.`);
    }

    result[key] = parseOptionalString(entry, `${label}.${key}`);
  }

  return result;
}

const ALLOWED_KEY_LABELS = "Tab, Shift+Tab, Home, End, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Space, Escape";
