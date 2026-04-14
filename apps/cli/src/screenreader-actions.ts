import {
  SCREEN_READER_ACTION_DEFINITIONS,
  SCREEN_READER_CATALOG_IDS_BY_SEMANTIC,
  SCREEN_READER_CATALOG_SEMANTICS,
  SCREEN_READER_CLI_TOKEN_LABELS,
  SCREEN_READER_HELPER_PATH_TO_SEMANTIC,
  SCREEN_READER_INVOKE_SEMANTICS,
  SCREEN_READER_MAINTENANCE_SEMANTICS,
  SCREEN_READER_READ_SEMANTICS,
  SCREEN_READER_SEMANTIC_LABELS
} from "@rawstep/action-catalog";
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
import { buildNestedHelperTree, type ExpandDeep, type PathToTree, type UnionToIntersection } from "./helper-tree";

type ScreenReaderActionOptions = {
  hint?: string;
};

type StableConfiguredScreenReaderActionFor<TSemantic extends ConfiguredStableScreenReaderActionShape["semantic"]> =
  ConfiguredStableScreenReaderAction & { semantic: TSemantic };

type CatalogConfiguredScreenReaderAction =
  ConfiguredUnstableScreenReaderAction & { unstable: "catalog" };

type RawPerformConfiguredScreenReaderAction =
  ConfiguredUnstableScreenReaderAction & { unstable: "rawPerform" };

type BuiltInCatalogSemantic = (typeof SCREEN_READER_CATALOG_SEMANTICS)[number];
type ScreenReaderActionDefinition = {
  helperPath: string;
  kind: "invoke" | "read" | "maintenance" | "catalog";
  backendSupport: readonly ScreenReaderBackendId[];
  catalogIdsByBackend: Partial<Record<ScreenReaderBackendId, string>>;
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

const SIMPLE_INVOKE_SEMANTICS = new Set(
  SCREEN_READER_INVOKE_SEMANTICS as readonly ScreenReaderSemanticAction[]
);

const READ_SEMANTICS = new Set(
  SCREEN_READER_READ_SEMANTICS as readonly ScreenReaderSemanticAction[]
);

const CLEAR_SEMANTICS = new Set(
  SCREEN_READER_MAINTENANCE_SEMANTICS as readonly ScreenReaderSemanticAction[]
);

type ScreenReaderHelperPath = keyof typeof SCREEN_READER_HELPER_PATH_TO_SEMANTIC & string;

export type ScreenReaderHelperApi = ExpandDeep<
  UnionToIntersection<{
    [Path in ScreenReaderHelperPath]: PathToTree<
      Path,
      (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<
        (typeof SCREEN_READER_HELPER_PATH_TO_SEMANTIC)[Path]
      >
    >;
  }[ScreenReaderHelperPath]>
>;

export const sr = buildNestedHelperTree(
  SCREEN_READER_HELPER_PATH_TO_SEMANTIC,
  (semantic) => (options?: ScreenReaderActionOptions) =>
    buildConfiguredScreenReaderAction(
      semantic as ConfiguredStableScreenReaderActionShape["semantic"],
      options
    )
) as ScreenReaderHelperApi;

function getScreenReaderActionDefinition(
  semantic: ScreenReaderSemanticAction
): ScreenReaderActionDefinition {
  return SCREEN_READER_ACTION_DEFINITIONS[semantic] as ScreenReaderActionDefinition;
}

export type ScreenReaderUnstableHelperApi = {
  catalog: <TSchema extends z.ZodObject<any>>(
    id: string,
    options: ScreenReaderUnstableCatalogOptions<TSchema>
  ) => CatalogConfiguredScreenReaderAction;
  rawPerform: <TSchema extends z.ZodObject<any>>(
    options: ScreenReaderUnstableRawPerformOptions<TSchema>
  ) => RawPerformConfiguredScreenReaderAction;
};

export const srUnstable: ScreenReaderUnstableHelperApi = {
  catalog: <TSchema extends z.ZodObject<any>>(
    id: string,
    options: ScreenReaderUnstableCatalogOptions<TSchema>
  ): CatalogConfiguredScreenReaderAction =>
    buildConfiguredUnstableCatalogAction(
      id,
      options.hint,
      options.argsSchema,
      options.argsExample as Record<string, unknown>
    ),
  rawPerform: <TSchema extends z.ZodObject<any>>(
    options: ScreenReaderUnstableRawPerformOptions<TSchema>
  ): RawPerformConfiguredScreenReaderAction =>
    buildConfiguredUnstableRawPerformAction(
      options.hint,
      options.payloadSchema,
      options.payloadExample as Record<string, unknown>
    )
};

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
  const runtimeActions = dedupeRuntimeActions(promptActions.map((action) => action.runtimeAction));

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

function buildConfiguredScreenReaderAction<TSemantic extends ConfiguredStableScreenReaderActionShape["semantic"]>(
  semantic: TSemantic,
  options?: ScreenReaderActionOptions
): StableConfiguredScreenReaderActionFor<TSemantic> {
  return {
    semantic,
    ...(options?.hint ? { hint: options.hint } : {})
  } as StableConfiguredScreenReaderActionFor<TSemantic>;
}

function buildConfiguredUnstableCatalogAction(
  id: string,
  hint: string,
  argsSchema: PromptObjectSchema<Record<string, unknown>>,
  argsExample: Record<string, unknown>
): CatalogConfiguredScreenReaderAction {
  return {
    unstable: "catalog",
    id,
    hint,
    argsSchema,
    argsExample
  } as CatalogConfiguredScreenReaderAction;
}

function buildConfiguredUnstableRawPerformAction(
  hint: string,
  payloadSchema: PromptObjectSchema<Record<string, unknown>>,
  payloadExample: Record<string, unknown>
): RawPerformConfiguredScreenReaderAction {
  return {
    unstable: "rawPerform",
    hint,
    payloadSchema,
    payloadExample
  } as RawPerformConfiguredScreenReaderAction;
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
    throw new Error(`${label}.semantic must be one of ${SCREEN_READER_SEMANTIC_LABELS}.`);
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
    throw new Error(`${label} must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
  }

  const semantic = token.slice(3);
  if (!isScreenReaderSemanticAction(semantic)) {
    throw new Error(`${label} must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
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

  if (!isBuiltInCatalogSemantic(action.semantic)) {
    throw new Error(`Unknown screen reader semantic action: ${formatConfiguredScreenReaderAction(action)}.`);
  }

  const catalogId = getBuiltInCatalogId(action.semantic, backendId);
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

  for (const semantic of Object.keys(SCREEN_READER_ACTION_DEFINITIONS) as ScreenReaderSemanticAction[]) {
    const definition = getScreenReaderActionDefinition(semantic);
    if (!definition.backendSupport.includes(backendId)) {
      continue;
    }

    if (definition.kind === "invoke" && capabilities.invoke[semantic as keyof ScreenReaderCapabilities["invoke"]]) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
      continue;
    }

    if (definition.kind === "read") {
      const method = semantic.slice("read.".length) as keyof ScreenReaderCapabilities["read"];
      if (capabilities.read[method]) {
        actions.push(buildConfiguredScreenReaderAction(semantic));
      }
      continue;
    }

    if (definition.kind === "maintenance") {
      const method = semantic === "clear.itemTextLog"
        ? "clearItemTextLog"
        : "clearSpokenPhraseLog";
      if (capabilities.maintenance[method]) {
        actions.push(buildConfiguredScreenReaderAction(semantic));
      }
      continue;
    }

    const catalogId = definition.catalogIdsByBackend[backendId];
    if (catalogId && hasCatalogId(capabilities, catalogId)) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
    }
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
    && Object.prototype.hasOwnProperty.call(SCREEN_READER_ACTION_DEFINITIONS, value);
}

function isBuiltInCatalogSemantic(value: ScreenReaderSemanticAction): value is BuiltInCatalogSemantic {
  return SCREEN_READER_CATALOG_SEMANTICS.includes(value as BuiltInCatalogSemantic);
}

function getBuiltInCatalogId(
  semantic: BuiltInCatalogSemantic,
  backendId: ScreenReaderBackendId
): string | undefined {
  return (SCREEN_READER_CATALOG_IDS_BY_SEMANTIC[semantic] as Partial<Record<ScreenReaderBackendId, string>> | undefined)?.[backendId];
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
