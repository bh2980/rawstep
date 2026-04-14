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

type StableConfiguredScreenReaderActionFor<TSemantic extends ConfiguredStableScreenReaderActionShape["semantic"]> =
  ConfiguredStableScreenReaderAction & { semantic: TSemantic };

type CatalogConfiguredScreenReaderAction =
  ConfiguredUnstableScreenReaderAction & { unstable: "catalog" };

type RawPerformConfiguredScreenReaderAction =
  ConfiguredUnstableScreenReaderAction & { unstable: "rawPerform" };

type BuiltInCatalogSemantic =
  | "heading.next"
  | "heading.previous"
  | "heading.level.1.next"
  | "heading.level.1.previous"
  | "heading.level.2.next"
  | "heading.level.2.previous"
  | "heading.level.3.next"
  | "heading.level.3.previous"
  | "heading.level.4.next"
  | "heading.level.4.previous"
  | "heading.level.5.next"
  | "heading.level.5.previous"
  | "heading.level.6.next"
  | "heading.level.6.previous"
  | "form.next"
  | "form.previous"
  | "link.next"
  | "link.previous"
  | "button.next"
  | "button.previous"
  | "landmark.next"
  | "landmark.previous"
  | "list.next"
  | "list.previous"
  | "table.next"
  | "table.previous";

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
  },
  "heading.level.1.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel1",
    "guidepup-virtual": "commands.moveToNextHeadingLevel1"
  },
  "heading.level.1.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel1",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel1"
  },
  "heading.level.2.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel2",
    "guidepup-virtual": "commands.moveToNextHeadingLevel2"
  },
  "heading.level.2.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel2",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel2"
  },
  "heading.level.3.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel3",
    "guidepup-virtual": "commands.moveToNextHeadingLevel3"
  },
  "heading.level.3.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel3",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel3"
  },
  "heading.level.4.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel4",
    "guidepup-virtual": "commands.moveToNextHeadingLevel4"
  },
  "heading.level.4.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel4",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel4"
  },
  "heading.level.5.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel5",
    "guidepup-virtual": "commands.moveToNextHeadingLevel5"
  },
  "heading.level.5.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel5",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel5"
  },
  "heading.level.6.next": {
    "guidepup-nvda": "keyboard.moveToNextHeadingLevel6",
    "guidepup-virtual": "commands.moveToNextHeadingLevel6"
  },
  "heading.level.6.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousHeadingLevel6",
    "guidepup-virtual": "commands.moveToPreviousHeadingLevel6"
  },
  "link.next": {
    "guidepup-nvda": "keyboard.moveToNextLink",
    "guidepup-virtual": "commands.moveToNextLink"
  },
  "link.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousLink",
    "guidepup-virtual": "commands.moveToPreviousLink"
  },
  "button.next": {
    "guidepup-voiceover": "commander.FIND_NEXT_BUTTON",
    "guidepup-nvda": "keyboard.moveToNextButton"
  },
  "button.previous": {
    "guidepup-voiceover": "commander.FIND_PREVIOUS_BUTTON",
    "guidepup-nvda": "keyboard.moveToPreviousButton"
  },
  "landmark.next": {
    "guidepup-voiceover": "commander.FIND_NEXT_LANDMARK",
    "guidepup-nvda": "keyboard.moveToNextLandmark",
    "guidepup-virtual": "commands.moveToNextLandmark"
  },
  "landmark.previous": {
    "guidepup-voiceover": "commander.FIND_PREVIOUS_LANDMARK",
    "guidepup-nvda": "keyboard.moveToPreviousLandmark",
    "guidepup-virtual": "commands.moveToPreviousLandmark"
  },
  "list.next": {
    "guidepup-nvda": "keyboard.moveToNextList"
  },
  "list.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousList"
  },
  "table.next": {
    "guidepup-nvda": "keyboard.moveToNextTable"
  },
  "table.previous": {
    "guidepup-nvda": "keyboard.moveToPreviousTable"
  }
} as const satisfies Record<
  BuiltInCatalogSemantic,
  Partial<Record<ScreenReaderBackendId, string>>
>;

const BUILTIN_CATALOG_SEMANTIC_TOKENS = [
  "heading.next",
  "heading.previous",
  "heading.level.1.next",
  "heading.level.1.previous",
  "heading.level.2.next",
  "heading.level.2.previous",
  "heading.level.3.next",
  "heading.level.3.previous",
  "heading.level.4.next",
  "heading.level.4.previous",
  "heading.level.5.next",
  "heading.level.5.previous",
  "heading.level.6.next",
  "heading.level.6.previous",
  "form.next",
  "form.previous",
  "link.next",
  "link.previous",
  "button.next",
  "button.previous",
  "landmark.next",
  "landmark.previous",
  "list.next",
  "list.previous",
  "table.next",
  "table.previous"
] as const satisfies readonly BuiltInCatalogSemantic[];

const SCREEN_READER_SEMANTIC_TOKENS = [
  "next",
  "previous",
  "act",
  "interact",
  "stopInteracting",
  "press",
  "type",
  "click",
  ...BUILTIN_CATALOG_SEMANTIC_TOKENS,
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

export type ScreenReaderHelperApi = {
  next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"next">;
  previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"previous">;
  act: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"act">;
  interact: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"interact">;
  stopInteracting: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"stopInteracting">;
  press: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"press">;
  type: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"type">;
  click: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"click">;
  heading: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.previous">;
    level1: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.1.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.1.previous">;
    };
    level2: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.2.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.2.previous">;
    };
    level3: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.3.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.3.previous">;
    };
    level4: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.4.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.4.previous">;
    };
    level5: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.5.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.5.previous">;
    };
    level6: {
      next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.6.next">;
      previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"heading.level.6.previous">;
    };
  };
  form: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"form.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"form.previous">;
  };
  link: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"link.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"link.previous">;
  };
  button: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"button.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"button.previous">;
  };
  landmark: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"landmark.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"landmark.previous">;
  };
  list: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"list.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"list.previous">;
  };
  table: {
    next: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"table.next">;
    previous: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"table.previous">;
  };
  read: {
    itemText: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"read.itemText">;
    itemTextLog: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"read.itemTextLog">;
    lastSpokenPhrase: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"read.lastSpokenPhrase">;
    spokenPhraseLog: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"read.spokenPhraseLog">;
  };
  clear: {
    itemTextLog: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"clear.itemTextLog">;
    spokenPhraseLog: (options?: ScreenReaderActionOptions) => StableConfiguredScreenReaderActionFor<"clear.spokenPhraseLog">;
  };
};

export const sr: ScreenReaderHelperApi = {
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
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.previous", options),
    level1: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.1.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.1.previous", options)
    },
    level2: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.2.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.2.previous", options)
    },
    level3: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.3.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.3.previous", options)
    },
    level4: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.4.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.4.previous", options)
    },
    level5: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.5.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.5.previous", options)
    },
    level6: {
      next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.6.next", options),
      previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("heading.level.6.previous", options)
    }
  },
  form: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("form.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("form.previous", options)
  },
  link: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("link.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("link.previous", options)
  },
  button: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("button.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("button.previous", options)
  },
  landmark: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("landmark.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("landmark.previous", options)
  },
  list: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("list.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("list.previous", options)
  },
  table: {
    next: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("table.next", options),
    previous: (options?: ScreenReaderActionOptions) => buildConfiguredScreenReaderAction("table.previous", options)
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
};

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

  for (const semantic of ["next", "previous", "act", "interact", "stopInteracting", "press", "type", "click"] as const) {
    if (capabilities.invoke[semantic]) {
      actions.push(buildConfiguredScreenReaderAction(semantic));
    }
  }

  for (const semantic of BUILTIN_CATALOG_SEMANTIC_TOKENS) {
    const catalogId = getBuiltInCatalogId(semantic, backendId);
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
      ...BUILTIN_CATALOG_SEMANTIC_TOKENS,
      ...READ_SEMANTICS,
      ...CLEAR_SEMANTICS
    ].includes(value as ScreenReaderSemanticAction);
}

function isBuiltInCatalogSemantic(value: ScreenReaderSemanticAction): value is BuiltInCatalogSemantic {
  return BUILTIN_CATALOG_SEMANTIC_TOKENS.includes(value as BuiltInCatalogSemantic);
}

function getBuiltInCatalogId(
  semantic: BuiltInCatalogSemantic,
  backendId: ScreenReaderBackendId
): string | undefined {
  const mapping = BUILTIN_CATALOG_SEMANTICS[semantic] as Partial<Record<ScreenReaderBackendId, string>>;
  return mapping[backendId];
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
