import type { AgentProvider } from "@a11y-task/agent";
import { z } from "zod";
import {
  isAllowedKey,
  isScreenReaderCommand,
  type AllowedKey,
  type ScreenReaderCommand,
  type ScreenshotPolicy,
  type Task,
  type UserModel
} from "@a11y-task/core";
import {
  isScreenReaderBackendId,
  type ScreenReaderBackendId
} from "@a11y-task/observer-screenreader";

export type CliRunOptions = {
  taskFile: string;
  configFile?: string;
  mode?: UserModel;
  outDir?: string;
  maxSteps?: number;
  timeoutMs?: number;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderCommands?: ScreenReaderCommand[];
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
  maxSteps?: number;
  timeoutMs?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: MemorySetting;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderCommands?: ScreenReaderCommand[];
  screenReaderBackend?: ScreenReaderBackendId;
};

export type ProjectDefaultsShape = {
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
  apiKey?: string;
};

export type TaskConfigOverride = {
  mode?: UserModel;
  outDir?: string;
  maxSteps?: number;
  timeoutMs?: number;
  screenshots?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  memory?: MemorySetting;
  allowedKeys?: AllowedKey[];
  allowedScreenReaderCommands?: ScreenReaderCommand[];
  screenReaderBackend?: ScreenReaderBackendId;
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
  allowedScreenReaderCommands?: readonly ScreenReaderCommand[];
  screenReaderBackendId?: ScreenReaderBackendId;
};

export type TaskExecutionDefaults = {
  mode?: UserModel;
  maxSteps?: number;
  timeoutMs?: number;
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
export const screenReaderCommandSchema = z.custom<ScreenReaderCommand>(
  (value) => typeof value === "string" && isScreenReaderCommand(value)
);
export const allowedScreenReaderCommandsSchema = z.array(screenReaderCommandSchema);
export const screenReaderBackendIdSchema = z.custom<ScreenReaderBackendId>(
  (value) => typeof value === "string" && isScreenReaderBackendId(value)
);

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

export function parseAllowedScreenReaderCommands(value: unknown, label: string): ScreenReaderCommand[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of screen reader commands.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_COMMAND_LABELS}.`);
    }

    if (!isScreenReaderCommand(entry)) {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_COMMAND_LABELS}.`);
    }

    return entry;
  });
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

export function parseCommaSeparatedScreenReaderCommands(value: unknown, label: string): ScreenReaderCommand[] {
  return parseAllowedScreenReaderCommands(parseCommaSeparatedValues(value, label), label);
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

const ALLOWED_KEY_LABELS = "Tab, Shift+Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Space, Escape";
const SCREEN_READER_COMMAND_LABELS = "nextItem, previousItem, nextHeading, previousHeading, nextFormControl, previousFormControl, act";
