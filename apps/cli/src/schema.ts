import { z } from "zod";
import {
  allowedKeysSchema,
  allowedScreenReaderActionsSchema,
  booleanSchema,
  memorySettingSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  screenshotPolicySchema,
  userModelSchema
} from "./shared";

const taskConfigObjectSchema = z.object({
  mode: userModelSchema.optional(),
  outDir: nonEmptyStringSchema.optional(),
  headless: booleanSchema.optional(),
  maxSteps: nonNegativeIntegerSchema.optional(),
  timeoutMs: nonNegativeIntegerSchema.optional(),
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
  if (candidate.allowedScreenReaderCommands !== undefined) {
    throw new Error(
      `${label} config.allowedScreenReaderCommands is removed. Use allowedScreenReaderActions with entries like { kind: "perform", id: "keyboard.readCurrentLine" } or { kind: "press" }.`
    );
  }
  if (candidate.run !== undefined || candidate.agent !== undefined) {
    throw new Error(
      `${label} uses removed config.run/config.agent format. Use flat keys instead, for example:\nconfig:\n  mode: screenreader-strict\n  timeoutMs: 600000\n  memory: all`
    );
  }

  for (const key of ["provider", "model", "baseURL", "apiKey"]) {
    if (candidate[key] !== undefined) {
      throw new Error(
        `${label} config.${key} is not allowed. Keep AI settings in rawstep.config.ts defaults or environment variables.`
      );
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

  if (candidate.run !== undefined || candidate.agent !== undefined) {
    throw new Error(
      `Config file ${configPath} uses removed defaults.run/defaults.agent format. Use:\ndefaults:\n  provider: openai-compatible\n  model: openrouter/auto\nmodes:\n  keyboard:\n    outDir: ./.rawstep/out/keyboard`
    );
  }

  for (const key of [
    "outDir",
    "headless",
    "maxSteps",
    "timeoutMs",
    "screenshots",
    "verifierAutoComplete",
    "includeRationale",
    "includeExperienceSummary",
    "memory",
    "mode",
    "allowedKeys",
    "allowedScreenReaderActions",
    "screenReaderBackend"
  ]) {
    if (candidate[key] !== undefined) {
      throw new Error(
        `Config file ${configPath} defaults.${key} is not allowed. Put execution presets under modes.<mode>.`
      );
    }
  }

  if (candidate.allowedScreenReaderCommands !== undefined) {
    throw new Error(
      `Config file ${configPath} defaults.allowedScreenReaderCommands is removed. Use modes.<mode>.allowedScreenReaderActions instead.`
    );
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
