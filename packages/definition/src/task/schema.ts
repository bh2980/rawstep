import {
  SCREEN_READER_CLI_TOKEN_LABELS,
  SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC,
  SUPPORTED_KEY_LABELS,
  createStableScreenReaderActionRef,
  isAllowedKey,
  type KeyboardSupportedKey,
  type ScreenReaderActionRef,
} from "@rawstep/action-catalog";
import { z } from "zod";
import { parseScreenReaderBackendId } from "../backends";
import { parseUserModel, USER_MODEL_VALUES } from "../modes";
import { validateVerifySpec } from "../verify";
import { NAVIGATION_STRATEGY_VALUES, REASONING_EFFORT_VALUES } from "./source";
import type {
  MemorySetting,
  NavigationPolicy,
  ScreenReaderObserveConfig,
  TaskPrompt,
  TaskInput,
  TaskOverrideSource,
  TaskSource,
  VoiceOverConfig,
} from "./source";

const SCREENSHOT_POLICY_VALUES = ["all", "important", "failure-only", "none"] as const;

const userModelSchema = z.enum(USER_MODEL_VALUES);
const screenshotPolicySchema = z.enum(SCREENSHOT_POLICY_VALUES);
const nonNegativeIntegerSchema = z.number().int().min(0);
const nonEmptyStringSchema = z.string().trim().min(1);
const reasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);
const navigationStrategySchema = z.enum(NAVIGATION_STRATEGY_VALUES);
const taskPromptSchema = z.object({
  system: nonEmptyStringSchema.optional(),
  user: nonEmptyStringSchema.optional()
}).strict().refine(
  (value) => value.system !== undefined || value.user !== undefined,
  "Task prompt must include at least one of system or user."
);
const memorySettingSchema = z.union([nonNegativeIntegerSchema, z.literal("all")]);
const screenReaderObserveConfigSchema = z.object({
  pollIntervalMs: nonNegativeIntegerSchema.optional(),
  silenceWindowMs: nonNegativeIntegerSchema.optional(),
  maxObserveMs: nonNegativeIntegerSchema.optional(),
  allowFallback: z.boolean().optional()
}).strict();
const voiceOverConfigSchema = z.object({
  cursorScreenshot: z.boolean().optional()
}).strict();
const planningConfigSchema = z.object({
  enabled: z.boolean().optional(),
  reflectionCadence: nonNegativeIntegerSchema.optional(),
  initialDelaySteps: nonNegativeIntegerSchema.optional(),
  firstReflectionDelaySteps: nonNegativeIntegerSchema.optional()
}).strict();
const navigationPolicySchema = z.object({
  strategy: navigationStrategySchema.optional(),
  allowUrlList: z.array(nonEmptyStringSchema).optional()
}).strict();

const taskConfigObjectSchema = z.object({
  mode: userModelSchema.optional(),
  outDir: nonEmptyStringSchema.optional(),
  headless: z.boolean().optional(),
  maxSteps: nonNegativeIntegerSchema.optional(),
  timeoutMs: nonNegativeIntegerSchema.optional(),
  maxVerificationRetries: nonNegativeIntegerSchema.optional(),
  screenshots: screenshotPolicySchema.optional(),
  verifierAutoComplete: z.boolean().optional(),
  includeExperienceSummary: z.boolean().optional(),
  includeRationale: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  memory: memorySettingSchema.optional(),
  allowedKeys: z.array(z.unknown()).optional(),
  allowedScreenReaderActions: z.array(z.unknown()).optional(),
  screenReaderBackend: z.unknown().optional(),
  observe: z.unknown().optional(),
  voiceOver: z.unknown().optional(),
  planning: planningConfigSchema.optional(),
  navigation: z.unknown().optional(),
  prompt: z.unknown().optional()
}).passthrough();

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

export function validateTaskOverrideSource(raw: unknown, label: string): TaskOverrideSource | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} config must be an object.`);
  }

  const candidate = parseTaskConfigObject(raw, label);

  return {
    mode: candidate.mode === undefined ? undefined : parseUserModel(candidate.mode),
    outDir: candidate.outDir,
    headless: candidate.headless,
    maxSteps: candidate.maxSteps,
    timeoutMs: candidate.timeoutMs,
    maxVerificationRetries: candidate.maxVerificationRetries,
    screenshots: candidate.screenshots,
    verifierAutoComplete: candidate.verifierAutoComplete,
    includeExperienceSummary: candidate.includeExperienceSummary,
    includeRationale: candidate.includeRationale,
    reasoningEffort: candidate.reasoningEffort,
    memory: candidate.memory,
    allowedKeys: candidate.allowedKeys === undefined
      ? undefined
      : parseAllowedKeys(candidate.allowedKeys, `${label} config.allowedKeys`),
    allowedScreenReaderActions: candidate.allowedScreenReaderActions === undefined
      ? undefined
      : parseTaskScreenReaderActions(
        candidate.allowedScreenReaderActions,
        `${label} config.allowedScreenReaderActions`
      ),
    screenReaderBackend: candidate.screenReaderBackend === undefined
      ? undefined
      : parseScreenReaderBackendId(candidate.screenReaderBackend, `${label} config.screenReaderBackend`),
    observe: candidate.observe === undefined
      ? undefined
      : parseScreenReaderObserveConfig(candidate.observe, `${label} config.observe`),
    voiceOver: candidate.voiceOver === undefined
      ? undefined
      : parseVoiceOverConfig(candidate.voiceOver, `${label} config.voiceOver`),
    planning: candidate.planning === undefined
      ? undefined
      : parsePlanningConfig(candidate.planning, `${label} config.planning`),
    navigation: candidate.navigation === undefined
      ? undefined
      : parseNavigationPolicy(candidate.navigation, `${label} config.navigation`)
  };
}

export function validateTaskSource(raw: unknown, label: string): TaskSource {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  const candidate = raw as Record<string, unknown>;
  if (!candidate.url || !candidate.goal) {
    throw new Error("Task file must include url and goal.");
  }

  return {
    id: candidate.id === undefined ? undefined : parseOptionalString(candidate.id, `${label} id`),
    url: parseOptionalString(candidate.url, `${label} url`),
    goal: parseOptionalString(candidate.goal, `${label} goal`),
    prompt: candidate.prompt === undefined ? undefined : parseTaskPrompt(candidate.prompt, `${label} prompt`),
    mode: candidate.mode === undefined ? undefined : parseUserModel(candidate.mode),
    maxSteps: candidate.maxSteps === undefined
      ? undefined
      : parseOptionalNonNegativeInteger(candidate.maxSteps, `${label} maxSteps`),
    timeoutMs: candidate.timeoutMs === undefined
      ? undefined
      : parseOptionalNonNegativeInteger(candidate.timeoutMs, `${label} timeoutMs`),
    verify: validateVerifySpec(candidate.verify),
    input: validateTaskInput(candidate.input),
    config: validateTaskOverrideSource(candidate.config, label)
  };
}

function parseTaskPrompt(value: unknown, label: string): TaskPrompt {
  const result = taskPromptSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be an object with non-empty system and/or user strings.`);
  }

  return result.data;
}

function parseTaskConfigObject(raw: unknown, label: string) {
  const result = taskConfigObjectSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${label} config is invalid.`);
  }

  const candidate = raw as Record<string, unknown>;
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
    "reasoningEffort",
    "memory",
    "allowedKeys",
    "allowedScreenReaderActions",
    "screenReaderBackend",
    "observe",
    "voiceOver",
    "planning",
    "navigation",
    "prompt"
  ]);

  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key) && !["provider", "model", "baseURL", "apiKey"].includes(key)) {
      throw new Error(`${label} config.${key} is not allowed.`);
    }
  }

  return result.data;
}

function parseOptionalString(value: unknown, label: string): string {
  const result = nonEmptyStringSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return result.data;
}

function parseOptionalNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  const result = nonNegativeIntegerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return result.data;
}

function parseAllowedKeys(value: unknown, label: string): KeyboardSupportedKey[] {
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

function parseTaskScreenReaderActions(value: unknown, label: string): ScreenReaderActionRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of stable sr.* action tokens.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    const semantic = SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC[
      entry as keyof typeof SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC
    ];
    if (!semantic) {
      throw new Error(`${label}[${index}] must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    return createStableScreenReaderActionRef(semantic);
  });
}

function parseScreenReaderObserveConfig(value: unknown, label: string): ScreenReaderObserveConfig {
  const result = screenReaderObserveConfigSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is invalid.`);
  }

  return result.data;
}

function parseVoiceOverConfig(value: unknown, label: string): VoiceOverConfig {
  const result = voiceOverConfigSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is invalid.`);
  }

  return result.data;
}

function parsePlanningConfig(value: unknown, label: string) {
  const result = planningConfigSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is invalid.`);
  }

  return result.data;
}

function parseNavigationPolicy(value: unknown, label: string): NavigationPolicy {
  const result = navigationPolicySchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is invalid.`);
  }

  const strategy = result.data.strategy ?? "same-origin";
  const allowUrlList = result.data.allowUrlList?.map((entry, index) =>
    parseAbsoluteUrlPrefix(entry, `${label}.allowUrlList[${index}]`)
  );

  if (strategy === "allow-url-list") {
    if (!allowUrlList || allowUrlList.length === 0) {
      throw new Error(`${label}.allowUrlList must contain at least one absolute URL when strategy is "allow-url-list".`);
    }

    return {
      strategy,
      allowUrlList
    };
  }

  if (allowUrlList) {
    throw new Error(`${label}.allowUrlList is only allowed when strategy is "allow-url-list".`);
  }

  return {
    strategy
  };
}

function parseAbsoluteUrlPrefix(value: string, label: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
}


export type { MemorySetting };
