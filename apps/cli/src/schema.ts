import { USER_MODEL_VALUES } from "@rawstep/definition";
import { z } from "zod";
import {
  allowedKeysSchema,
  allowedScreenReaderActionsSchema,
  booleanSchema,
  memorySettingSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  screenshotPolicySchema
} from "./shared";

const userModelSchema = z.enum(USER_MODEL_VALUES);

const taskConfigObjectSchema = z.object({
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
  allowedKeys: allowedKeysSchema.optional(),
  allowedScreenReaderActions: allowedScreenReaderActionsSchema.optional(),
  screenReaderBackend: z.unknown().optional(),
  prompt: z.unknown().optional()
}).passthrough();

export function parseTaskConfigObject(raw: unknown, label: string) {
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
    "memory",
    "allowedKeys",
    "allowedScreenReaderActions",
    "screenReaderBackend",
    "prompt"
  ]);

  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key) && !["provider", "model", "baseURL", "apiKey"].includes(key)) {
      throw new Error(`${label} config.${key} is not allowed.`);
    }
  }

  return result.data;
}

const projectDefaultsObjectSchema = z.object({
  provider: z.enum(["anthropic", "openai-compatible"]).optional(),
  apiKey: nonEmptyStringSchema.optional(),
  model: nonEmptyStringSchema.optional(),
  baseURL: nonEmptyStringSchema.optional(),
  prompt: z.unknown().optional()
}).passthrough();

export function parseProjectDefaultsObject(raw: unknown, configPath: string) {
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.provider !== undefined
    && candidate.provider !== "anthropic"
    && candidate.provider !== "openai-compatible"
  ) {
    throw new Error(`Unsupported agent provider: ${String(candidate.provider)}. Expected one of anthropic, openai-compatible.`);
  }

  const allowedKeys = new Set(["provider", "apiKey", "model", "baseURL", "prompt"]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Config file ${configPath} defaults.${key} is not allowed.`);
    }
  }

  const result = projectDefaultsObjectSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Config file ${configPath} defaults is invalid.`);
  }

  return result.data;
}

export const configRootSchema = z.object({
  version: z.literal(1),
  defaults: z.unknown().optional(),
  modes: z.record(z.string(), z.unknown()).optional(),
  tasks: z.unknown().optional()
}).passthrough();
