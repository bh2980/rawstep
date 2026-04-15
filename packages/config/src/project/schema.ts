import type { AgentProvider } from "@rawstep/agent";
import type {
  AllowedKey,
  KeyboardActionRef,
  ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import {
  isAllowedKey,
  SUPPORTED_KEY_LABELS,
} from "@rawstep/action-catalog";
import {
  allowsRawKeyActions,
  isUserModel,
  parseScreenReaderBackendId,
  supportsVisualObservation,
  USER_MODEL_VALUES,
  type MemorySetting,
  type ScreenReaderBackendId,
  type ScreenshotPolicy,
  type UserModel,
} from "@rawstep/definition";
import { z } from "zod";
import { parseConfiguredKeyboardActions } from "../keyboard-actions";
import { parseConfiguredScreenReaderActions } from "../screenreader-actions";
import type {
  ProjectConfigSource,
  ProjectDefaultsSource,
  ProjectPromptSource,
} from "./source";

export type ProjectModePreset = {
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

export type ValidatedProjectConfig = {
  version: 1;
  defaults?: ProjectDefaultsSource;
  modes?: Partial<Record<UserModel, ProjectModePreset>>;
};

const AGENT_PROVIDER_VALUES = ["anthropic", "openai-compatible"] as const;
const SCREENSHOT_POLICY_VALUES = ["all", "important", "failure-only", "none"] as const;
const userModelSchema = z.enum(USER_MODEL_VALUES);
const screenshotPolicySchema = z.enum(SCREENSHOT_POLICY_VALUES);
const nonNegativeIntegerSchema = z.number().int().min(0);
const booleanSchema = z.boolean();
const nonEmptyStringSchema = z.string().trim().min(1);
const memorySettingSchema = z.union([nonNegativeIntegerSchema, z.literal("all")]);
const modePresetObjectSchema = z.object({
  mode: userModelSchema.optional(),
  outDir: nonEmptyStringSchema.optional(),
  headless: booleanSchema.optional(),
  maxSteps: nonNegativeIntegerSchema.optional(),
  timeoutMs: nonNegativeIntegerSchema.optional(),
  maxVerificationRetries: nonNegativeIntegerSchema.optional(),
  screenshots: screenshotPolicySchema.optional(),
  verifierAutoComplete: booleanSchema.optional(),
  includeExperienceSummary: booleanSchema.optional(),
  includeRationale: booleanSchema.optional(),
  memory: memorySettingSchema.optional(),
  allowedKeys: z.array(z.unknown()).optional(),
  allowedScreenReaderActions: z.array(z.unknown()).optional(),
  screenReaderBackend: z.unknown().optional(),
  prompt: z.unknown().optional(),
}).passthrough();
const projectDefaultsObjectSchema = z.object({
  provider: z.enum(AGENT_PROVIDER_VALUES).optional(),
  apiKey: nonEmptyStringSchema.optional(),
  model: nonEmptyStringSchema.optional(),
  baseURL: nonEmptyStringSchema.optional(),
  prompt: z.unknown().optional(),
}).passthrough();
const configRootSchema = z.object({
  version: z.literal(1),
  defaults: z.unknown().optional(),
  modes: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export function parseAgentProvider(value: unknown): AgentProvider {
  const result = z.enum(AGENT_PROVIDER_VALUES).safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Unsupported agent provider: ${String(value)}. Expected one of ${AGENT_PROVIDER_VALUES.join(", ")}.`
  );
}

export function parseScreenshotPolicy(value: unknown): ScreenshotPolicy {
  const result = screenshotPolicySchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new Error(
    `Unsupported screenshot policy: ${String(value)}. Expected one of ${SCREENSHOT_POLICY_VALUES.join(", ")}.`
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

export function parseOptionalString(value: unknown, label: string): string {
  const result = nonEmptyStringSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a non-empty string.`);
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

export function parseMemorySetting(value: unknown, label: string): MemorySetting {
  const result = memorySettingSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a non-negative integer or "all".`);
  }

  return result.data;
}

export function parseConfiguredAllowedKeys(value: unknown, label: string): KeyboardActionRef[] {
  return parseConfiguredKeyboardActions(value, label);
}

export function parseAllowedKeyNames(value: unknown, label: string): AllowedKey[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of allowed key names.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || !isAllowedKey(entry)) {
      throw new Error(`${label}[${index}] must be one of ${SUPPORTED_KEY_LABELS}.`);
    }

    return entry as AllowedKey;
  });
}

export function parseConfiguredAllowedScreenReaderActions(value: unknown, label: string): ScreenReaderActionRef[] {
  return parseConfiguredScreenReaderActions(value, label);
}

export function parseProjectPromptSource(
  rawPrompt: unknown,
  label: string
): ProjectPromptSource {
  if (typeof rawPrompt !== "object" || rawPrompt === null || Array.isArray(rawPrompt)) {
    throw new Error(`${label} must be an object.`);
  }

  const candidate = rawPrompt as Record<string, unknown>;
  return {
    dir: candidate.dir === undefined
      ? undefined
      : parseOptionalString(candidate.dir, `${label}.dir`)
  };
}

export function parseProjectDefaultsSource(
  rawDefaults: unknown,
  configPath: string
): ProjectDefaultsSource | undefined {
  if (rawDefaults === undefined || rawDefaults === null) {
    return undefined;
  }

  if (typeof rawDefaults !== "object" || Array.isArray(rawDefaults)) {
    throw new Error(`Config file ${configPath} defaults must be an object.`);
  }

  const candidate = rawDefaults as Record<string, unknown>;
  if (candidate.provider !== undefined) {
    parseAgentProvider(candidate.provider);
  }
  const allowedKeys = new Set(["provider", "apiKey", "model", "baseURL", "prompt"]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Config file ${configPath} defaults.${key} is not allowed.`);
    }
  }

  const result = projectDefaultsObjectSchema.safeParse(rawDefaults);
  if (!result.success) {
    throw new Error(`Config file ${configPath} defaults is invalid.`);
  }

  return {
    provider: result.data.provider,
    apiKey: result.data.apiKey,
    model: result.data.model,
    baseURL: result.data.baseURL,
    prompt: result.data.prompt === undefined
      ? undefined
      : parseProjectPromptSource(result.data.prompt, `Config file ${configPath} defaults.prompt`)
  };
}

export function parseModePresetSource(
  rawPreset: unknown,
  label: string,
  mode: UserModel
): ProjectModePreset {
  if (rawPreset === undefined || rawPreset === null) {
    return {};
  }

  if (typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
    throw new Error(`${label} config must be an object.`);
  }

  const result = modePresetObjectSchema.safeParse(rawPreset);
  if (!result.success) {
    throw new Error(`${label} config is invalid.`);
  }

  const candidate = rawPreset as Record<string, unknown>;
  for (const key of ["provider", "model", "baseURL", "apiKey"]) {
    if (candidate[key] !== undefined) {
      throw new Error(
        `${label} config.${key} is not allowed. Keep AI settings in rawstep.config.ts defaults or environment variables.`
      );
    }
  }

  const allowedKeys = new Set([
    "mode",
    "outDir",
    "headless",
    "maxSteps",
    "timeoutMs",
    "maxVerificationRetries",
    "screenshots",
    "verifierAutoComplete",
    "includeExperienceSummary",
    "includeRationale",
    "memory",
    "allowedKeys",
    "allowedScreenReaderActions",
    "screenReaderBackend",
    "prompt",
  ]);

  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key) && !["provider", "model", "baseURL", "apiKey"].includes(key)) {
      throw new Error(`${label} config.${key} is not allowed.`);
    }
  }

  const parsed: ProjectModePreset = {
    outDir: result.data.outDir,
    headless: result.data.headless,
    maxSteps: result.data.maxSteps,
    timeoutMs: result.data.timeoutMs,
    maxVerificationRetries: result.data.maxVerificationRetries,
    screenshots: result.data.screenshots,
    verifierAutoComplete: result.data.verifierAutoComplete,
    includeExperienceSummary: result.data.includeExperienceSummary,
    includeRationale: result.data.includeRationale,
    memory: result.data.memory,
    allowedKeys: result.data.allowedKeys === undefined
      ? undefined
      : parseConfiguredAllowedKeys(result.data.allowedKeys, `${label}.allowedKeys`),
    allowedScreenReaderActions: result.data.allowedScreenReaderActions === undefined
      ? undefined
      : parseConfiguredAllowedScreenReaderActions(
        result.data.allowedScreenReaderActions,
        `${label}.allowedScreenReaderActions`
      ),
    screenReaderBackend: result.data.screenReaderBackend === undefined
      ? undefined
      : parseScreenReaderBackendId(result.data.screenReaderBackend, `${label}.screenReaderBackend`),
  };

  if (supportsVisualObservation(mode) && parsed.allowedScreenReaderActions) {
    throw new Error(`${label}.allowedScreenReaderActions is not allowed in ${mode} mode.`);
  }
  if (supportsVisualObservation(mode) && parsed.screenReaderBackend) {
    throw new Error(`${label}.screenReaderBackend is not allowed in ${mode} mode.`);
  }
  if (!allowsRawKeyActions(mode) && parsed.allowedKeys) {
    throw new Error(`${label}.allowedKeys is not allowed in ${mode} mode.`);
  }

  return parsed;
}

export function parseModePresetMap(
  rawModes: unknown,
  configPath: string
): Partial<Record<UserModel, ProjectModePreset>> | undefined {
  if (rawModes === undefined || rawModes === null) {
    return undefined;
  }

  if (typeof rawModes !== "object" || Array.isArray(rawModes)) {
    throw new Error(`Config file ${configPath} modes must be an object.`);
  }

  const result: Partial<Record<UserModel, ProjectModePreset>> = {};
  for (const [modeKey, rawPreset] of Object.entries(rawModes as Record<string, unknown>)) {
    if (!isUserModel(modeKey)) {
      throw new Error(
        `Config file ${configPath} has unsupported mode preset: ${modeKey}. Expected one of ${USER_MODEL_VALUES.join(", ")}.`
      );
    }

    result[modeKey] = parseModePresetSource(
      rawPreset,
      `Config file ${configPath} modes.${modeKey}`,
      modeKey
    );
  }

  return result;
}

export function parseProjectConfigSource(raw: unknown, configPath: string): ValidatedProjectConfig {
  const result = configRootSchema.safeParse(raw);
  if (!result.success || result.data.version !== 1) {
    throw new Error(`Config file ${configPath} must include version: 1.`);
  }

  const allowedRootKeys = new Set(["version", "defaults", "modes"]);
  for (const key of Object.keys(result.data)) {
    if (!allowedRootKeys.has(key)) {
      throw new Error(`Config file ${configPath} ${key} is not allowed.`);
    }
  }

  return {
    version: 1,
    defaults: parseProjectDefaultsSource(result.data.defaults, configPath),
    modes: parseModePresetMap(result.data.modes, configPath),
  };
}

export type { ProjectConfigSource };
