import type { AgentProvider } from "@rawstep/agent";
import { z } from "zod";
import {
  isAllowedKey,
  isScreenReaderInvokeMethod,
  isScreenReaderMaintenanceMethod,
  isScreenReaderReadMethod,
  isScreenReaderActionKind,
  type AllowedScreenReaderAction,
  type AllowedKey,
  type ScreenReaderActionKind,
  type ScreenReaderInvokeMethod,
  type ScreenReaderMaintenanceMethod,
  type ScreenReaderReadMethod,
  type ScreenshotPolicy,
  type Task,
  type UserModel
} from "@rawstep/core";
import {
  isScreenReaderBackendId,
  type ScreenReaderBackendId
} from "@rawstep/observer-screenreader";

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
  allowedScreenReaderActions?: AllowedScreenReaderAction[];
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
  allowedScreenReaderActions?: AllowedScreenReaderAction[];
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
  allowedScreenReaderActions?: AllowedScreenReaderAction[];
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
  allowedScreenReaderActions?: readonly AllowedScreenReaderAction[];
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
  screenReaderActionHints?: ScreenReaderActionHintsShape;
};

export type ProjectPromptShape = PromptOverrideShape & {
  dir?: string;
};

export type ResolvedPromptOptions = {
  promptDir: string;
  extraInstructions?: string;
  keyHints: Partial<Record<AllowedKey, string>>;
  screenReaderActionHints: ScreenReaderActionHintsShape;
};

export type ScreenReaderActionHintsShape = {
  invoke?: {
    next?: string;
    previous?: string;
    act?: string;
    interact?: string;
    stopInteracting?: string;
    press?: string;
    type?: string;
    click?: string;
    perform?: {
      generic?: string;
      raw?: string;
      catalog?: Record<string, string>;
    };
  };
  read?: Partial<Record<ScreenReaderReadMethod, string>>;
  maintenance?: Partial<Record<ScreenReaderMaintenanceMethod, string>>;
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
export const screenReaderActionKindSchema = z.custom<ScreenReaderActionKind>(
  (value) => typeof value === "string" && isScreenReaderActionKind(value)
);
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

export function parseAllowedScreenReaderActions(value: unknown, label: string): AllowedScreenReaderAction[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of screen reader actions.`);
  }

  return value.map((entry, index) => parseAllowedScreenReaderAction(entry, `${label}[${index}]`));
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
      `${label}.screenReaderCommandHints is removed. Use ${label}.screenReaderActionHints instead.`
    );
  }
  const allowedKeys = new Set([
    "extraInstructions",
    "keyHints",
    "screenReaderActionHints",
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
  const screenReaderActionHints = candidate.screenReaderActionHints === undefined
    ? undefined
    : parsePromptScreenReaderActionHints(
      candidate.screenReaderActionHints,
      `${label}.screenReaderActionHints`
    );

  if (!options.allowDir) {
    if (candidate.dir !== undefined) {
      throw new Error(`${label}.dir is not allowed.`);
    }

    return {
      extraInstructions,
      keyHints,
      screenReaderActionHints
    };
  }

  return {
    dir: candidate.dir === undefined
      ? undefined
      : parseOptionalString(candidate.dir, `${label}.dir`),
    extraInstructions,
    keyHints,
    screenReaderActionHints
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

export function parseCommaSeparatedScreenReaderActions(value: unknown, label: string): AllowedScreenReaderAction[] {
  return parseCommaSeparatedValues(value, label).map((entry, index) =>
    parseAllowedScreenReaderActionToken(entry, `${label}[${index}]`)
  );
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

function parsePromptScreenReaderActionHints(
  value: unknown,
  label: string
): ScreenReaderActionHintsShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object with invoke/read/maintenance sections.`);
  }

  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(["invoke", "read", "maintenance"]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }

  const result: ScreenReaderActionHintsShape = {};
  if (candidate.invoke !== undefined) {
    result.invoke = parseInvokeHints(candidate.invoke, `${label}.invoke`);
  }
  if (candidate.read !== undefined) {
    result.read = parseReadHints(candidate.read, `${label}.read`);
  }
  if (candidate.maintenance !== undefined) {
    result.maintenance = parseMaintenanceHints(candidate.maintenance, `${label}.maintenance`);
  }

  return result;
}

function parseAllowedScreenReaderAction(
  value: unknown,
  label: string
): AllowedScreenReaderAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object like { kind: "invoke", method: "next" }.`);
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (typeof kind !== "string" || !isScreenReaderActionKind(kind)) {
    throw new Error(`${label}.kind must be one of ${SCREEN_READER_ACTION_LABELS}.`);
  }

  if (kind === "invoke") {
    return parseAllowedInvokeAction(candidate, label);
  }

  if (kind === "read") {
    const method = parseScreenReaderReadMethod(candidate.method, `${label}.method`);
    ensureOnlyKeys(candidate, `${label}`, ["kind", "method"]);
    return { kind, method };
  }

  const method = parseScreenReaderMaintenanceMethod(candidate.method, `${label}.method`);
  ensureOnlyKeys(candidate, `${label}`, ["kind", "method"]);
  return { kind, method };
}

function parseAllowedScreenReaderActionToken(
  value: string,
  label: string
): AllowedScreenReaderAction {
  const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
  }

  const [kind, method, ...rest] = parts;
  if (!isScreenReaderActionKind(kind)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
  }

  if (kind === "invoke") {
    if (!isScreenReaderInvokeMethod(method)) {
      throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
    }

    if (method === "perform") {
      const [source, ...idParts] = rest;
      if (source === "raw" && idParts.length === 0) {
        return { kind, method, source: "raw" };
      }
      if (source === "catalog" && idParts.length > 0) {
        return { kind, method, source: "catalog", id: idParts.join(":") };
      }

      throw new Error(`${label} must use invoke:perform:catalog:<id> or invoke:perform:raw.`);
    }

    if (rest.length > 0) {
      throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
    }

    return { kind, method };
  }

  if (rest.length > 0) {
    throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
  }

  if (kind === "read") {
    if (!isScreenReaderReadMethod(method)) {
      throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
    }

    return { kind, method };
  }

  if (!isScreenReaderMaintenanceMethod(method)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_ACTION_TOKEN_LABELS}.`);
  }

  return { kind, method };
}

function parsePerformCatalogHints(
  value: unknown,
  label: string
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by perform ids.`);
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) {
      throw new Error(`${label} keys must be non-empty perform ids.`);
    }

    result[key] = parseOptionalString(entry, `${label}.${key}`);
  }

  return result;
}

function parseAllowedInvokeAction(
  candidate: Record<string, unknown>,
  label: string
): AllowedScreenReaderAction {
  const method = parseScreenReaderInvokeMethod(candidate.method, `${label}.method`);

  if (method === "perform") {
    const source = candidate.source;
    if (source !== "catalog" && source !== "raw") {
      throw new Error(`${label}.source must be either "catalog" or "raw".`);
    }

    if (source === "catalog") {
      ensureOnlyKeys(candidate, label, ["kind", "method", "source", "id"]);
      return {
        kind: "invoke",
        method,
        source,
        id: parseOptionalString(candidate.id, `${label}.id`)
      };
    }

    ensureOnlyKeys(candidate, label, ["kind", "method", "source"]);
    return {
      kind: "invoke",
      method,
      source
    };
  }

  ensureOnlyKeys(candidate, label, ["kind", "method"]);
  return {
    kind: "invoke",
    method
  };
}

function parseScreenReaderInvokeMethod(value: unknown, label: string): ScreenReaderInvokeMethod {
  if (typeof value !== "string" || !isScreenReaderInvokeMethod(value)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_INVOKE_METHOD_LABELS}.`);
  }

  return value;
}

function parseScreenReaderReadMethod(value: unknown, label: string): ScreenReaderReadMethod {
  if (typeof value !== "string" || !isScreenReaderReadMethod(value)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_READ_METHOD_LABELS}.`);
  }

  return value;
}

function parseScreenReaderMaintenanceMethod(
  value: unknown,
  label: string
): ScreenReaderMaintenanceMethod {
  if (typeof value !== "string" || !isScreenReaderMaintenanceMethod(value)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_MAINTENANCE_METHOD_LABELS}.`);
  }

  return value;
}

function parseInvokeHints(
  value: unknown,
  label: string
): NonNullable<ScreenReaderActionHintsShape["invoke"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by invoke methods.`);
  }

  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "next",
    "previous",
    "act",
    "interact",
    "stopInteracting",
    "press",
    "type",
    "click",
    "perform"
  ]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }

  const result: NonNullable<ScreenReaderActionHintsShape["invoke"]> = {};
  for (const method of [
    "next",
    "previous",
    "act",
    "interact",
    "stopInteracting",
    "press",
    "type",
    "click"
  ] as const) {
    if (candidate[method] !== undefined) {
      result[method] = parseOptionalString(candidate[method], `${label}.${method}`);
    }
  }

  if (candidate.perform !== undefined) {
    result.perform = parsePerformHints(candidate.perform, `${label}.perform`);
  }

  return result;
}

function parsePerformHints(
  value: unknown,
  label: string
): NonNullable<NonNullable<ScreenReaderActionHintsShape["invoke"]>["perform"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object with generic/raw/catalog keys.`);
  }

  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set(["generic", "raw", "catalog"]);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }

  return {
    generic: candidate.generic === undefined
      ? undefined
      : parseOptionalString(candidate.generic, `${label}.generic`),
    raw: candidate.raw === undefined
      ? undefined
      : parseOptionalString(candidate.raw, `${label}.raw`),
    catalog: candidate.catalog === undefined
      ? undefined
      : parsePerformCatalogHints(candidate.catalog, `${label}.catalog`)
  };
}

function parseReadHints(
  value: unknown,
  label: string
): NonNullable<ScreenReaderActionHintsShape["read"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by read methods.`);
  }

  const result: NonNullable<ScreenReaderActionHintsShape["read"]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isScreenReaderReadMethod(key)) {
      throw new Error(`${label}.${key} must be one of ${SCREEN_READER_READ_METHOD_LABELS}.`);
    }

    result[key] = parseOptionalString(entry, `${label}.${key}`);
  }

  return result;
}

function parseMaintenanceHints(
  value: unknown,
  label: string
): NonNullable<ScreenReaderActionHintsShape["maintenance"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object keyed by maintenance methods.`);
  }

  const result: NonNullable<ScreenReaderActionHintsShape["maintenance"]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isScreenReaderMaintenanceMethod(key)) {
      throw new Error(`${label}.${key} must be one of ${SCREEN_READER_MAINTENANCE_METHOD_LABELS}.`);
    }

    result[key] = parseOptionalString(entry, `${label}.${key}`);
  }

  return result;
}

function ensureOnlyKeys(
  candidate: Record<string, unknown>,
  label: string,
  allowedKeys: string[]
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }
}

const ALLOWED_KEY_LABELS = "Tab, Shift+Tab, Home, End, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter, Space, Escape";
const SCREEN_READER_ACTION_LABELS = "invoke, read, maintenance";
const SCREEN_READER_INVOKE_METHOD_LABELS = "next, previous, act, interact, stopInteracting, press, type, click, perform";
const SCREEN_READER_READ_METHOD_LABELS = "itemText, itemTextLog, lastSpokenPhrase, spokenPhraseLog";
const SCREEN_READER_MAINTENANCE_METHOD_LABELS = "clearItemTextLog, clearSpokenPhraseLog";
const SCREEN_READER_ACTION_TOKEN_LABELS = [
  "invoke:next",
  "invoke:previous",
  "invoke:act",
  "invoke:interact",
  "invoke:stopInteracting",
  "invoke:press",
  "invoke:type",
  "invoke:click",
  "invoke:perform:catalog:<id>",
  "invoke:perform:raw",
  "read:itemText",
  "read:itemTextLog",
  "read:lastSpokenPhrase",
  "read:spokenPhraseLog",
  "maintenance:clearItemTextLog",
  "maintenance:clearSpokenPhraseLog"
].join(", ");
