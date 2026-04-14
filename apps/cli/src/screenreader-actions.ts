import {
  supportsScreenReaderAction,
  type AllowedScreenReaderAction,
  type ConfiguredScreenReaderAction,
  type ConfiguredStableScreenReaderAction,
  type ConfiguredUnstableScreenReaderAction,
  type PromptObjectSchema,
  type ResolvedPromptScreenReaderAction,
  type ScreenReaderCapabilities,
  type ScreenReaderSemanticAction
} from "@rawstep/core";
import type { ScreenReaderBackendId } from "@rawstep/runtime";
import { z } from "zod";

type ScreenReaderActionOptions = {
  hint?: string;
};

type ConfiguredStableScreenReaderActionShape = Omit<ConfiguredStableScreenReaderAction, never>;

type ScreenReaderUnstableCatalogOptions<TSchema extends z.ZodObject<any>> = {
  hint: string;
  argsSchema: TSchema;
  argsExample: z.input<TSchema>;
};

type ScreenReaderUnstableRawPerformOptions<TSchema extends z.ZodObject<any>> = {
  hint: string;
  payloadSchema: TSchema;
  payloadExample: z.input<TSchema>;
};

const SIMPLE_INVOKE_SEMANTICS = new Set([
  "next",
  "previous",
  "act",
  "interact",
  "stopInteracting",
  "press",
  "type",
  "click"
] as const satisfies readonly ScreenReaderSemanticAction[]);

const READ_SEMANTICS = new Set([
  "read.itemText",
  "read.itemTextLog",
  "read.lastSpokenPhrase",
  "read.spokenPhraseLog"
] as const satisfies readonly ScreenReaderSemanticAction[]);

const CLEAR_SEMANTICS = new Set([
  "clear.itemTextLog",
  "clear.spokenPhraseLog"
] as const satisfies readonly ScreenReaderSemanticAction[]);

const BUILTIN_CATALOG_SEMANTICS = {
  "heading.next": {
    "guidepup-voiceover": "keyboard.findNextHeading",
    "guidepup-nvda": "keyboard.moveToNextHeading",
    "guidepup-virtual": "commands.moveToNextHeading"
  },
  "heading.previous": {
    "guidepup-voiceover": "keyboard.findPreviousHeading",
    "guidepup-nvda": "keyboard.moveToPreviousHeading",
    "guidepup-virtual": "commands.moveToPreviousHeading"
  },
  "form.next": {
    "guidepup-voiceover": "keyboard.findNextControl",
    "guidepup-nvda": "keyboard.moveToNextFormField",
    "guidepup-virtual": "commands.moveToNextForm"
  },
  "form.previous": {
    "guidepup-voiceover": "keyboard.findPreviousControl",
    "guidepup-nvda": "keyboard.moveToPreviousFormField",
    "guidepup-virtual": "commands.moveToPreviousForm"
  }
} as const satisfies Record<
  Extract<ScreenReaderSemanticAction, "heading.next" | "heading.previous" | "form.next" | "form.previous">,
  Record<ScreenReaderBackendId, string>
>;

const SCREEN_READER_SEMANTIC_TOKENS = [
  "next",
  "previous",
  "act",
  "interact",
  "stopInteracting",
  "press",
  "type",
  "click",
  "heading.next",
  "heading.previous",
  "form.next",
  "form.previous",
  "read.itemText",
  "read.itemTextLog",
  "read.lastSpokenPhrase",
  "read.spokenPhraseLog",
  "clear.itemTextLog",
  "clear.spokenPhraseLog"
] as const;

const SCREEN_READER_SEMANTIC_TOKEN_LABELS = SCREEN_READER_SEMANTIC_TOKENS.join(", ");
const SCREEN_READER_SEMANTIC_CLI_TOKENS = SCREEN_READER_SEMANTIC_TOKENS.map((token) => `sr.${token}`) as readonly string[];
const SCREEN_READER_SEMANTIC_CLI_TOKEN_LABELS = SCREEN_READER_SEMANTIC_CLI_TOKENS.join(", ");

export const sr = {
  next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("next", options),
  previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("previous", options),
  act: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("act", options),
  interact: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("interact", options),
  stopInteracting: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("stopInteracting", options),
  press: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("press", options),
  type: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("type", options),
  click: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("click", options),
  heading: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.previous", options)
  },
  form: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("form.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("form.previous", options)
  },
  read: {
    itemText: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("read.itemText", options),
    itemTextLog: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("read.itemTextLog", options),
    lastSpokenPhrase: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("read.lastSpokenPhrase", options),
    spokenPhraseLog: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("read.spokenPhraseLog", options)
  },
  clear: {
    itemTextLog: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("clear.itemTextLog", options),
    spokenPhraseLog: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("clear.spokenPhraseLog", options)
  }
} as const;

export const srUnstable = {
  catalog: <TSchema extends z.ZodObject<any>>(
    id: string,
    options: ScreenReaderUnstableCatalogOptions<TSchema>
  ): ConfiguredUnstableScreenReaderAction =>
    buildConfiguredUnstableCatalogAction(
      id,
      options.hint,
      options.argsSchema,
      options.argsExample as Record<string, unknown>
    ),
  rawPerform: <TSchema extends z.ZodObject<any>>(
    options: ScreenReaderUnstableRawPerformOptions<TSchema>
  ): ConfiguredUnstableScreenReaderAction =>
    buildConfiguredUnstableRawPerformAction(
      options.hint,
      options.payloadSchema,
      options.payloadExample as Record<string, unknown>
    )
} as const;

export type ScreenReaderHelperApi = typeof sr;
export type ScreenReaderUnstableHelperApi = typeof srUnstable;

export function parseConfiguredScreenReaderActions(
  value: unknown,
  label: string
): ConfiguredScreenReaderAction[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of screen reader actions.`);
  }

  return value.map((entry, index) => parseConfiguredScreenReaderAction(entry, `${label}[${index}]`));
}

export function parseCommaSeparatedConfiguredScreenReaderActions(
  value: unknown,
  label: string
): ConfiguredScreenReaderAction[] {
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

  return entries.map((entry, index) => parseConfiguredScreenReaderActionToken(entry, `${label}[${index}]`));
}

export function resolveConfiguredScreenReaderActions(
  configuredActions: readonly ConfiguredScreenReaderAction[] | undefined,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): {
  runtimeActions: readonly AllowedScreenReaderAction[] | undefined;
  promptActions: readonly ResolvedPromptScreenReaderAction[];
} {
  const effectiveConfiguredActions = configuredActions ?? buildDefaultConfiguredScreenReaderActions(backendId, capabilities);
  const promptActions = effectiveConfiguredActions.map((action) => resolvePromptAction(action, backendId, capabilities));
  const runtimeActions = configuredActions
    ? dedupeRuntimeActions(promptActions.map((action) => action.runtimeAction))
    : undefined;

  return {
    runtimeActions,
    promptActions
  };
}

export function formatConfiguredScreenReaderAction(action: ConfiguredScreenReaderAction): string {
  if ("unstable" in action) {
    return action.unstable === "catalog"
      ? `srUnstable.catalog(${JSON.stringify(action.id)})`
      : "srUnstable.rawPerform(...)";
  }

  return action.semantic;
}

function buildConfiguredScreenReaderAction(
  semantic: ConfiguredStableScreenReaderActionShape["semantic"],
  options?: ScreenReaderActionOptions
): ConfiguredStableScreenReaderAction {
  return {
    semantic,
    ...(options?.hint ? { hint: options.hint } : {})
  } as ConfiguredStableScreenReaderAction;
}

function buildConfiguredUnstableCatalogAction(
  id: string,
  hint: string,
  argsSchema: PromptObjectSchema<Record<string, unknown>>,
  argsExample: Record<string, unknown>
): ConfiguredUnstableScreenReaderAction {
  return {
    unstable: "catalog",
    id,
    hint,
    argsSchema,
    argsExample
  } as ConfiguredUnstableScreenReaderAction;
}

function buildConfiguredUnstableRawPerformAction(
  hint: string,
  payloadSchema: PromptObjectSchema<Record<string, unknown>>,
  payloadExample: Record<string, unknown>
): ConfiguredUnstableScreenReaderAction {
  return {
    unstable: "rawPerform",
    hint,
    payloadSchema,
    payloadExample
  } as ConfiguredUnstableScreenReaderAction;
}

function parseConfiguredScreenReaderAction(
  value: unknown,
  label: string
): ConfiguredScreenReaderAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object like sr.next() or srUnstable.catalog(...).`);
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.unstable === "catalog") {
    ensureOnlyKeys(candidate, label, ["unstable", "id", "hint", "argsSchema", "argsExample"]);
    const id = parseNonEmptyString(candidate.id, `${label}.id`);
    const hint = parseNonEmptyString(candidate.hint, `${label}.hint`);
    const argsSchema = parsePromptObjectSchema(candidate.argsSchema, `${label}.argsSchema`);
    const argsExample = parseSchemaBoundObjectExample(argsSchema, candidate.argsExample, `${label}.argsExample`);
    return buildConfiguredUnstableCatalogAction(id, hint, argsSchema, argsExample);
  }

  if (candidate.unstable === "rawPerform") {
    ensureOnlyKeys(candidate, label, ["unstable", "hint", "payloadSchema", "payloadExample"]);
    const hint = parseNonEmptyString(candidate.hint, `${label}.hint`);
    const payloadSchema = parsePromptObjectSchema(candidate.payloadSchema, `${label}.payloadSchema`);
    const payloadExample = parseSchemaBoundObjectExample(payloadSchema, candidate.payloadExample, `${label}.payloadExample`);
    return buildConfiguredUnstableRawPerformAction(hint, payloadSchema, payloadExample);
  }

  const semantic = candidate.semantic;
  if (!isScreenReaderSemanticAction(semantic)) {
    throw new Error(`${label}.semantic must be one of ${SCREEN_READER_SEMANTIC_TOKEN_LABELS}.`);
  }

  const hint = candidate.hint === undefined
    ? undefined
    : parseOptionalHint(candidate.hint, `${label}.hint`);

  ensureOnlyKeys(candidate, label, ["semantic", "hint"]);
  return buildConfiguredScreenReaderAction(semantic, hint ? { hint } : undefined);
}

function parseConfiguredScreenReaderActionToken(
  token: string,
  label: string
): ConfiguredScreenReaderAction {
  if (!token.startsWith("sr.")) {
    throw new Error(`${label} must be one of ${SCREEN_READER_SEMANTIC_CLI_TOKEN_LABELS}.`);
  }

  const semantic = token.slice(3);
  if (!isScreenReaderSemanticAction(semantic)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_SEMANTIC_CLI_TOKEN_LABELS}.`);
  }

  return buildConfiguredScreenReaderAction(semantic);
}

function resolvePromptAction(
  action: ConfiguredScreenReaderAction,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ResolvedPromptScreenReaderAction {
  const runtimeAction = resolveRuntimeAction(action, backendId, capabilities);
  if ("unstable" in action && action.unstable === "catalog") {
    return {
      unstable: "catalog",
      id: action.id,
      hint: action.hint,
      argsSchema: action.argsSchema,
      argsExample: action.argsExample,
      runtimeAction: runtimeAction as Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "catalog" }>
    };
  }

  if ("unstable" in action && action.unstable === "rawPerform") {
    return {
      unstable: "rawPerform",
      hint: action.hint,
      payloadSchema: action.payloadSchema,
      payloadExample: action.payloadExample,
      runtimeAction: runtimeAction as Extract<AllowedScreenReaderAction, { kind: "invoke"; method: "perform"; source: "raw" }>
    };
  }

  return {
    semantic: action.semantic,
    ...(action.hint ? { hint: action.hint } : {}),
    runtimeAction
  };
}

function resolveRuntimeAction(
  action: ConfiguredScreenReaderAction,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): AllowedScreenReaderAction {
  const runtimeAction = toRuntimeAction(action, backendId);

  if ("unstable" in action && action.unstable === "catalog") {
    if (!hasCatalogId(capabilities, action.id)) {
      throw new Error(`Screen reader backend "${backendId}" does not support action ${formatConfiguredScreenReaderAction(action)}.`);
    }
  }

  if ("unstable" in action && action.unstable === "rawPerform" && !capabilities.invoke.supportsRawPerform) {
    throw new Error(`Screen reader backend "${backendId}" does not support action ${formatConfiguredScreenReaderAction(action)}.`);
  }

  if (!supportsScreenReaderAction(capabilities, runtimeAction)) {
    throw new Error(`Screen reader backend "${backendId}" does not support action ${formatConfiguredScreenReaderAction(action)}.`);
  }

  return runtimeAction;
}

function toRuntimeAction(
  action: ConfiguredScreenReaderAction,
  backendId: ScreenReaderBackendId
): AllowedScreenReaderAction {
  if ("unstable" in action) {
    if (action.unstable === "catalog") {
      return {
        kind: "invoke",
        method: "perform",
        source: "catalog",
        id: action.id
      };
    }

    return {
      kind: "invoke",
      method: "perform",
      source: "raw"
    };
  }

  if (SIMPLE_INVOKE_SEMANTICS.has(action.semantic as Extract<ScreenReaderSemanticAction, "next" | "previous" | "act" | "interact" | "stopInteracting" | "press" | "type" | "click">)) {
    return {
      kind: "invoke",
      method: action.semantic
    } as AllowedScreenReaderAction;
  }

  if (READ_SEMANTICS.has(action.semantic as Extract<ScreenReaderSemanticAction, "read.itemText" | "read.itemTextLog" | "read.lastSpokenPhrase" | "read.spokenPhraseLog">)) {
    return {
      kind: "read",
      method: action.semantic.slice("read.".length) as Extract<AllowedScreenReaderAction, { kind: "read" }>["method"]
    };
  }

  if (CLEAR_SEMANTICS.has(action.semantic as Extract<ScreenReaderSemanticAction, "clear.itemTextLog" | "clear.spokenPhraseLog">)) {
    return {
      kind: "maintenance",
      method: action.semantic === "clear.itemTextLog" ? "clearItemTextLog" : "clearSpokenPhraseLog"
    };
  }

  if (
    action.semantic !== "heading.next"
    && action.semantic !== "heading.previous"
    && action.semantic !== "form.next"
    && action.semantic !== "form.previous"
  ) {
    throw new Error(`Unknown screen reader semantic action: ${formatConfiguredScreenReaderAction(action)}.`);
  }

  const catalogId = BUILTIN_CATALOG_SEMANTICS[action.semantic][backendId];
  if (!catalogId) {
    throw new Error(`Screen reader backend "${backendId}" does not support action ${formatConfiguredScreenReaderAction(action)}.`);
  }

  return {
    kind: "invoke",
    method: "perform",
    source: "catalog",
    id: catalogId
  };
}

function buildDefaultConfiguredScreenReaderActions(
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ConfiguredScreenReaderAction[] {
  const actions: ConfiguredScreenReaderAction[] = [];

  for (const semantic of ["next", "previous", "act", "interact", "stopInteracting", "press", "type", "click"] as const) {
    if (capabilities.invoke[semantic]) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
    }
  }

  for (const semantic of ["heading.next", "heading.previous", "form.next", "form.previous"] as const) {
    const catalogId = BUILTIN_CATALOG_SEMANTICS[semantic][backendId];
    if (catalogId && hasCatalogId(capabilities, catalogId)) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
    }
  }

  for (const semantic of ["read.itemText", "read.itemTextLog", "read.lastSpokenPhrase", "read.spokenPhraseLog"] as const) {
    const method = semantic.slice("read.".length) as keyof ScreenReaderCapabilities["read"];
    if (capabilities.read[method]) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
    }
  }

  if (capabilities.maintenance.clearItemTextLog) {
    actions.push(buildConfiguredScreenReaderAction("clear.itemTextLog"));
  }
  if (capabilities.maintenance.clearSpokenPhraseLog) {
    actions.push(buildConfiguredScreenReaderAction("clear.spokenPhraseLog"));
  }

  return actions;
}

function hasCatalogId(
  capabilities: ScreenReaderCapabilities,
  id: string
): boolean {
  return capabilities.performCatalog.some((command) => command.id === id);
}

function dedupeRuntimeActions(
  actions: readonly AllowedScreenReaderAction[]
): readonly AllowedScreenReaderAction[] {
  const seen = new Set<string>();
  const deduped: AllowedScreenReaderAction[] = [];

  for (const action of actions) {
    const key = formatRuntimeAction(action);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(action);
  }

  return deduped;
}

function formatRuntimeAction(action: AllowedScreenReaderAction): string {
  if (action.kind !== "invoke") {
    return `${action.kind}:${action.method}`;
  }

  if (action.method !== "perform") {
    return `invoke:${action.method}`;
  }

  return action.source === "catalog"
    ? `invoke:perform:catalog:${action.id}`
    : "invoke:perform:raw";
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseOptionalHint(value: unknown, label: string): string {
  return parseNonEmptyString(value, label);
}

function ensureOnlyKeys(
  candidate: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[]
): void {
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }
}

function isScreenReaderSemanticAction(value: unknown): value is ScreenReaderSemanticAction {
  return typeof value === "string"
    && [
      ...SIMPLE_INVOKE_SEMANTICS,
      "heading.next",
      "heading.previous",
      "form.next",
      "form.previous",
      ...READ_SEMANTICS,
      ...CLEAR_SEMANTICS
    ].includes(value as ScreenReaderSemanticAction);
}

function parsePromptObjectSchema(
  value: unknown,
  label: string
): PromptObjectSchema<Record<string, unknown>> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || typeof (value as { safeParse?: unknown }).safeParse !== "function"
  ) {
    throw new Error(`${label} must be a Zod object schema.`);
  }

  return value as PromptObjectSchema<Record<string, unknown>>;
}

function parseSchemaBoundObjectExample(
  schema: PromptObjectSchema<Record<string, unknown>>,
  value: unknown,
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} must satisfy the provided schema.`);
  }

  return parsed.data;
}
