import {
  SCREEN_READER_ACTION_DEFINITIONS,
  SCREEN_READER_BACKEND_IDS,
  SCREEN_READER_CLI_TOKEN_LABELS,
  SCREEN_READER_CLI_TOKENS,
  SCREEN_READER_PUBLIC_SEMANTICS,
  SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC,
  SCREEN_READER_SEMANTIC_BY_CATALOG_ID,
  SCREEN_READER_SEMANTICS
} from "./generated";

export type ScreenReaderBackendId = (typeof SCREEN_READER_BACKEND_IDS)[number];
export type ScreenReaderSemanticAction = (typeof SCREEN_READER_SEMANTICS)[number];
export type PublicScreenReaderSemanticAction = (typeof SCREEN_READER_PUBLIC_SEMANTICS)[number];
export type ScreenReaderStablePromptToken = (typeof SCREEN_READER_CLI_TOKENS)[number];
export type InternalScreenReaderPromptToken = `sr.${ScreenReaderSemanticAction}`;
export type ScreenReaderReadMethod =
  | "itemText"
  | "itemTextLog"
  | "lastSpokenPhrase"
  | "spokenPhraseLog";
export type ScreenReaderMaintenanceMethod =
  | "clearItemTextLog"
  | "clearSpokenPhraseLog";
export type ScreenReaderStableArgumentKind = "none" | "key" | "text" | "click";
export type ScreenReaderResolutionKind = "invoke" | "read" | "maintenance" | "catalog";

type ScreenReaderActionDefinition = {
  helperPath: string;
  promptToken: InternalScreenReaderPromptToken;
  kind: ScreenReaderResolutionKind;
  argumentKind: ScreenReaderStableArgumentKind;
  backendSupport: readonly ScreenReaderBackendId[];
  catalogIdsByBackend: Partial<Record<ScreenReaderBackendId, string>>;
  fixedKey?: string;
  defaultAllowed: boolean;
  public: boolean;
};

export type PromptObjectSchema<TOutput extends Record<string, unknown> = Record<string, unknown>> = {
  safeParse(value: unknown):
    | { success: true; data: TOutput }
    | { success: false; error?: unknown };
};

export type ScreenReaderPerformCommand = {
  id: string;
  label: string;
  description: string;
  argsHint?: string;
};

export type ScreenReaderCapabilities = {
  invoke: {
    next: boolean;
    previous: boolean;
    act: boolean;
    interact: boolean;
    stopInteracting: boolean;
    press: boolean;
    type: boolean;
    click: boolean;
    perform: boolean;
    supportsRawPerform: boolean;
  };
  read: {
    itemText: boolean;
    itemTextLog: boolean;
    lastSpokenPhrase: boolean;
    spokenPhraseLog: boolean;
  };
  maintenance: {
    clearItemTextLog: boolean;
    clearSpokenPhraseLog: boolean;
  };
  performCatalog: readonly ScreenReaderPerformCommand[];
};

type ScreenReaderStableActionRefShape = {
  semantic: ScreenReaderSemanticAction;
  hint?: string;
};

declare const screenReaderStableActionRefBrand: unique symbol;

export type ScreenReaderStableActionRef = ScreenReaderStableActionRefShape & {
  readonly [screenReaderStableActionRefBrand]: true;
};

type ScreenReaderExtensionCatalogActionRefShape = {
  extension: "catalog";
  id: string;
  hint: string;
  argsSchema: PromptObjectSchema<Record<string, unknown>>;
  argsExample: Record<string, unknown>;
};

declare const screenReaderExtensionCatalogActionRefBrand: unique symbol;

export type ScreenReaderExtensionCatalogActionRef = ScreenReaderExtensionCatalogActionRefShape & {
  readonly [screenReaderExtensionCatalogActionRefBrand]: true;
};

type ScreenReaderExtensionRawPerformActionRefShape = {
  extension: "rawPerform";
  hint: string;
  payloadSchema: PromptObjectSchema<Record<string, unknown>>;
  payloadExample: Record<string, unknown>;
};

declare const screenReaderExtensionRawPerformActionRefBrand: unique symbol;

export type ScreenReaderExtensionRawPerformActionRef = ScreenReaderExtensionRawPerformActionRefShape & {
  readonly [screenReaderExtensionRawPerformActionRefBrand]: true;
};

export type ScreenReaderActionRef =
  | ScreenReaderStableActionRef
  | ScreenReaderExtensionCatalogActionRef
  | ScreenReaderExtensionRawPerformActionRef;

export type ScreenReaderStableActionDescriptor = {
  kind: "stable";
  semantic: ScreenReaderSemanticAction;
  token: InternalScreenReaderPromptToken;
  hint?: string;
  argumentKind: ScreenReaderStableArgumentKind;
};

export type ScreenReaderExtensionCatalogActionDescriptor = {
  kind: "extension";
  extension: "catalog";
  token: `srx.catalog.${string}`;
  hint: string;
  id: string;
  argsSchema: PromptObjectSchema<Record<string, unknown>>;
  argsExample: Record<string, unknown>;
};

export type ScreenReaderExtensionRawPerformActionDescriptor = {
  kind: "extension";
  extension: "rawPerform";
  token: "srx.rawPerform";
  hint: string;
  payloadSchema: PromptObjectSchema<Record<string, unknown>>;
  payloadExample: Record<string, unknown>;
};

export type ScreenReaderActionDescriptor =
  | ScreenReaderStableActionDescriptor
  | ScreenReaderExtensionCatalogActionDescriptor
  | ScreenReaderExtensionRawPerformActionDescriptor;

export type ScreenReaderIntent =
  | {
      semantic: Exclude<ScreenReaderSemanticAction, "press" | "type" | "click">;
    }
  | {
      semantic: "press";
      key: string;
    }
  | {
      semantic: "type";
      text: string;
    }
  | {
      semantic: "click";
      button?: "left" | "right";
      clickCount?: 1 | 2 | 3;
    }
  | {
      extension: "catalog";
      id: string;
      args?: Record<string, unknown>;
    }
  | {
      extension: "rawPerform";
      payload: Record<string, unknown>;
    };

export type ExecutableScreenReaderAction =
  | {
      kind: "invoke";
      method: "next" | "previous" | "act" | "interact" | "stopInteracting";
      options?: ScreenReaderCommandOptions;
    }
  | {
      kind: "invoke";
      method: "press";
      key: string;
      options?: ScreenReaderKeyboardOptions;
    }
  | {
      kind: "invoke";
      method: "type";
      text: string;
      options?: ScreenReaderKeyboardOptions;
    }
  | {
      kind: "invoke";
      method: "click";
      options?: ScreenReaderClickOptions;
    }
  | {
      kind: "invoke";
      method: "perform";
      command:
        | { source: "catalog"; id: string; args?: Record<string, unknown> }
        | { source: "raw"; payload: Record<string, unknown> };
      options?: ScreenReaderCommandOptions;
    }
  | {
      kind: "read";
      method: ScreenReaderReadMethod;
    }
  | {
      kind: "maintenance";
      method: ScreenReaderMaintenanceMethod;
    };

export type ScreenReaderActionPlan = {
  backendId: ScreenReaderBackendId;
  refs: readonly ScreenReaderActionRef[];
  descriptors: readonly ScreenReaderActionDescriptor[];
  descriptorByToken: Readonly<Record<string, ScreenReaderActionDescriptor>>;
  stableSemantics: readonly ScreenReaderSemanticAction[];
  extensionCatalogIds: readonly string[];
  allowsRawPerform: boolean;
};

export type ParseScreenReaderIntentResult =
  | { status: "matched"; intent: ScreenReaderIntent }
  | { status: "not-found" }
  | { status: "malformed" };

export type ScreenReaderCommandOptions = {
  capture?: boolean | "initial";
  retries?: number;
  timeout?: number;
};

export type ScreenReaderKeyboardOptions = ScreenReaderCommandOptions & {
  application?: string;
};

export type ScreenReaderClickOptions = ScreenReaderCommandOptions & {
  button?: "left" | "right";
  clickCount?: 1 | 2 | 3;
};

const READ_METHOD_BY_SEMANTIC = {
  "read.itemText": "itemText",
  "read.itemTextLog": "itemTextLog",
  "read.lastSpokenPhrase": "lastSpokenPhrase",
  "read.spokenPhraseLog": "spokenPhraseLog"
} as const satisfies Partial<Record<ScreenReaderSemanticAction, ScreenReaderReadMethod>>;

const MAINTENANCE_METHOD_BY_SEMANTIC = {
  "clear.itemTextLog": "clearItemTextLog",
  "clear.spokenPhraseLog": "clearSpokenPhraseLog"
} as const satisfies Partial<Record<ScreenReaderSemanticAction, ScreenReaderMaintenanceMethod>>;

const permissiveObjectSchema: PromptObjectSchema<Record<string, unknown>> = {
  safeParse(value: unknown) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { success: false };
    }

    return { success: true, data: value as Record<string, unknown> };
  }
};

export function createStableScreenReaderActionRef<TSemantic extends ScreenReaderSemanticAction>(
  semantic: TSemantic,
  hint?: string
): ScreenReaderStableActionRef {
  return {
    semantic,
    ...(hint ? { hint } : {})
  } as ScreenReaderStableActionRef;
}

export function createCatalogScreenReaderExtensionRef(
  id: string,
  hint: string,
  argsSchema: PromptObjectSchema<Record<string, unknown>>,
  argsExample: Record<string, unknown>
): ScreenReaderExtensionCatalogActionRef {
  return {
    extension: "catalog",
    id,
    hint,
    argsSchema,
    argsExample
  } as ScreenReaderExtensionCatalogActionRef;
}

export function createRawPerformScreenReaderExtensionRef(
  hint: string,
  payloadSchema: PromptObjectSchema<Record<string, unknown>>,
  payloadExample: Record<string, unknown>
): ScreenReaderExtensionRawPerformActionRef {
  return {
    extension: "rawPerform",
    hint,
    payloadSchema,
    payloadExample
  } as ScreenReaderExtensionRawPerformActionRef;
}

export function isScreenReaderSemanticAction(value: unknown): value is ScreenReaderSemanticAction {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(SCREEN_READER_ACTION_DEFINITIONS, value);
}

export function isPublicScreenReaderSemanticAction(value: unknown): value is PublicScreenReaderSemanticAction {
  return typeof value === "string"
    && (SCREEN_READER_PUBLIC_SEMANTICS as readonly string[]).includes(value);
}

export function getScreenReaderSemanticByCatalogId(id: string): ScreenReaderSemanticAction | undefined {
  return SCREEN_READER_SEMANTIC_BY_CATALOG_ID[id as keyof typeof SCREEN_READER_SEMANTIC_BY_CATALOG_ID];
}

export function parseScreenReaderActionRefs(
  value: unknown,
  label: string,
  options: { allowExtensions: boolean }
): ScreenReaderActionRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of screen reader actions.`);
  }

  return value.map((entry, index) =>
    parseScreenReaderActionRef(entry, `${label}[${index}]`, options)
  );
}

export function parseCommaSeparatedScreenReaderActionRefs(
  value: unknown,
  label: string,
  options: { allowExtensions: boolean }
): ScreenReaderActionRef[] {
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

  return entries.map((entry, index) =>
    parseScreenReaderActionRefToken(entry, `${label}[${index}]`, options)
  );
}

export function buildDefaultScreenReaderActionRefs(
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ScreenReaderStableActionRef[] {
  const refs: ScreenReaderStableActionRef[] = [];

  for (const semantic of SCREEN_READER_PUBLIC_SEMANTICS) {
    if (
      getScreenReaderActionDefinition(semantic).defaultAllowed
      && isStableSemanticSupported(semantic, backendId, capabilities)
    ) {
      refs.push(createStableScreenReaderActionRef(semantic));
    }
  }

  return refs;
}

export function buildScreenReaderActionPlan(
  refs: readonly ScreenReaderActionRef[] | undefined,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ScreenReaderActionPlan {
  const effectiveRefs = refs ?? buildDefaultScreenReaderActionRefs(backendId, capabilities);
  const descriptors: ScreenReaderActionDescriptor[] = [];
  const descriptorByToken: Record<string, ScreenReaderActionDescriptor> = {};
  const stableSemantics: ScreenReaderSemanticAction[] = [];
  const extensionCatalogIds: string[] = [];
  let allowsRawPerform = false;

  for (const ref of effectiveRefs) {
    const descriptor = buildDescriptor(ref, backendId, capabilities);
    if (descriptorByToken[descriptor.token]) {
      continue;
    }

    descriptorByToken[descriptor.token] = descriptor;
    descriptors.push(descriptor);

    if (descriptor.kind === "stable") {
      stableSemantics.push(descriptor.semantic);
      continue;
    }

    if (descriptor.extension === "catalog") {
      extensionCatalogIds.push(descriptor.id);
      continue;
    }

    allowsRawPerform = true;
  }

  return {
    backendId,
    refs: [...effectiveRefs],
    descriptors,
    descriptorByToken,
    stableSemantics,
    extensionCatalogIds,
    allowsRawPerform
  };
}

export function parseScreenReaderIntentCandidate(
  candidate: Record<string, unknown>,
  descriptors: readonly ScreenReaderActionDescriptor[] | ScreenReaderActionPlan | undefined
): ParseScreenReaderIntentResult {
  const token = typeof candidate.action === "string" ? candidate.action.trim() : "";
  if (!token) {
    return { status: "not-found" };
  }

  let descriptor: ScreenReaderActionDescriptor | undefined;
  if (!descriptors) {
    descriptor = undefined;
  } else if (Array.isArray(descriptors)) {
    descriptor = descriptors.find((entry) => entry.token === token);
  } else if (isScreenReaderActionPlan(descriptors)) {
    descriptor = descriptors.descriptorByToken[token];
  } else {
    descriptor = undefined;
  }
  if (!descriptor) {
    return { status: "not-found" };
  }

  if (descriptor.kind === "extension") {
    return descriptor.extension === "catalog"
      ? parseCatalogExtensionIntentCandidate(candidate, descriptor)
      : parseRawPerformExtensionIntentCandidate(candidate, descriptor);
  }

  switch (descriptor.argumentKind) {
    case "none":
      if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
        return { status: "malformed" };
      }

      return {
        status: "matched",
        intent: {
          semantic: descriptor.semantic as Exclude<ScreenReaderSemanticAction, "press" | "type" | "click">
        }
      };
    case "key":
      return parseKeyIntentCandidate(candidate);
    case "text":
      return parseTextIntentCandidate(candidate);
    case "click":
      return parseClickIntentCandidate(candidate);
  }

  return { status: "malformed" };
}

export function resolveExecutableScreenReaderAction(
  intent: ScreenReaderIntent,
  options: {
    backendId: ScreenReaderBackendId;
    capabilities: ScreenReaderCapabilities;
    plan?: ScreenReaderActionPlan;
  }
): ExecutableScreenReaderAction {
  if (options.plan && !isScreenReaderIntentAllowed(options.plan, intent)) {
    throw new Error(
      `Screen reader action is not allowed by the configured allowedScreenReaderActions: ${formatScreenReaderIntent(intent)}.`
    );
  }

  if ("extension" in intent) {
    return resolveExtensionExecutableAction(intent, options.capabilities);
  }

  return resolveStableExecutableAction(intent, options.backendId, options.capabilities);
}

export function isScreenReaderIntentAllowed(
  plan: ScreenReaderActionPlan,
  intent: ScreenReaderIntent
): boolean {
  if ("semantic" in intent) {
    return plan.stableSemantics.includes(intent.semantic);
  }

  if (intent.extension === "catalog") {
    return plan.extensionCatalogIds.includes(intent.id);
  }

  return plan.allowsRawPerform;
}

export function buildScreenReaderDescriptorExampleSnippet(
  descriptor: ScreenReaderActionDescriptor,
  includeRationale: boolean
): string {
  const base: Record<string, unknown> = includeRationale
    ? { action: descriptor.token, rationale: "..." }
    : { action: descriptor.token };

  if (descriptor.kind === "extension") {
    return descriptor.extension === "catalog"
      ? JSON.stringify({ ...base, args: descriptor.argsExample })
      : JSON.stringify({ ...base, payload: descriptor.payloadExample });
  }

  switch (descriptor.argumentKind) {
    case "none":
      return JSON.stringify(base);
    case "key":
      return JSON.stringify({ ...base, key: "Enter" });
    case "text":
      return JSON.stringify({ ...base, text: "<text>" });
    case "click":
      return JSON.stringify({ ...base, button: "left", clickCount: 1 });
  }
}

export function formatScreenReaderActionRef(ref: ScreenReaderActionRef): string {
  if ("semantic" in ref) {
    return `sr.${ref.semantic}`;
  }

  return ref.extension === "catalog"
    ? `srx.catalog(${JSON.stringify(ref.id)})`
    : "srx.rawPerform(...)";
}

export function formatScreenReaderIntent(intent: ScreenReaderIntent): string {
  if ("extension" in intent) {
    return intent.extension === "catalog"
      ? `srx.catalog(${intent.id})`
      : "srx.rawPerform";
  }

  switch (intent.semantic) {
    case "press":
      return `sr.press(${intent.key})`;
    case "type":
      return `sr.type(${intent.text})`;
    case "click":
      return `sr.click(${intent.button ?? "left"},${intent.clickCount ?? 1})`;
    default:
      return `sr.${intent.semantic}`;
  }
}

export function formatExecutableScreenReaderAction(action: ExecutableScreenReaderAction): string {
  if (action.kind === "read") {
    return `srAction.read(${action.method})`;
  }

  if (action.kind === "maintenance") {
    return `srAction.maintenance(${action.method})`;
  }

  switch (action.method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return `srAction.invoke(${action.method})`;
    case "perform":
      return action.command.source === "catalog"
        ? `srAction.perform(${action.command.id})`
        : "srAction.perform(raw)";
    case "press":
      return `srAction.press(${action.key})`;
    case "type":
      return `srAction.type(${action.text})`;
    case "click":
      return `srAction.click(${action.options?.button ?? "left"},${action.options?.clickCount ?? 1})`;
  }
}

function buildDescriptor(
  ref: ScreenReaderActionRef,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ScreenReaderActionDescriptor {
  if ("semantic" in ref) {
    return buildStableDescriptor(ref, backendId, capabilities);
  }

  if (ref.extension === "catalog") {
    if (!capabilities.invoke.perform || !hasCatalogId(capabilities, ref.id)) {
      throw new Error(
        `Screen reader backend "${backendId}" does not support action ${formatScreenReaderActionRef(ref)}.`
      );
    }

    return {
      kind: "extension",
      extension: "catalog",
      token: `srx.catalog.${ref.id}`,
      hint: ref.hint,
      id: ref.id,
      argsSchema: ref.argsSchema,
      argsExample: ref.argsExample
    };
  }

  if (!capabilities.invoke.supportsRawPerform) {
    throw new Error(
      `Screen reader backend "${backendId}" does not support action ${formatScreenReaderActionRef(ref)}.`
    );
  }

  return {
    kind: "extension",
    extension: "rawPerform",
    token: "srx.rawPerform",
    hint: ref.hint,
    payloadSchema: ref.payloadSchema,
    payloadExample: ref.payloadExample
  };
}

function buildStableDescriptor(
  ref: ScreenReaderStableActionRef,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ScreenReaderStableActionDescriptor {
  if (!isStableSemanticSupported(ref.semantic, backendId, capabilities)) {
    throw new Error(
      `Screen reader backend "${backendId}" does not support action ${formatScreenReaderActionRef(ref)}.`
    );
  }

  const definition = getScreenReaderActionDefinition(ref.semantic);
  return {
    kind: "stable",
    semantic: ref.semantic,
    token: definition.promptToken,
    hint: ref.hint,
    argumentKind: definition.argumentKind
  };
}

function isStableSemanticSupported(
  semantic: ScreenReaderSemanticAction,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): boolean {
  const definition = getScreenReaderActionDefinition(semantic);
  if (!definition.backendSupport.includes(backendId)) {
    return false;
  }

  switch (definition.kind) {
    case "invoke":
      if (definition.fixedKey) {
        return capabilities.invoke.press;
      }

      return definition.argumentKind === "none"
        ? capabilities.invoke[semantic as Extract<
            keyof ScreenReaderCapabilities["invoke"],
            "next" | "previous" | "act" | "interact" | "stopInteracting"
          >]
        : capabilities.invoke[semantic as keyof ScreenReaderCapabilities["invoke"]];
    case "read":
      return capabilities.read[READ_METHOD_BY_SEMANTIC[semantic as keyof typeof READ_METHOD_BY_SEMANTIC]];
    case "maintenance":
      return capabilities.maintenance[
        MAINTENANCE_METHOD_BY_SEMANTIC[semantic as keyof typeof MAINTENANCE_METHOD_BY_SEMANTIC]
      ];
    case "catalog": {
      const id = definition.catalogIdsByBackend[backendId];
      return Boolean(
        id
        && capabilities.invoke.perform
        && capabilities.performCatalog.some((command) => command.id === id)
      );
    }
  }
}

function resolveStableExecutableAction(
  intent: Extract<ScreenReaderIntent, { semantic: ScreenReaderSemanticAction }>,
  backendId: ScreenReaderBackendId,
  capabilities: ScreenReaderCapabilities
): ExecutableScreenReaderAction {
  const definition = getScreenReaderActionDefinition(intent.semantic);
  if (!isStableSemanticSupported(intent.semantic, backendId, capabilities)) {
    throw new Error(
      `Screen reader backend "${backendId}" does not support action ${formatScreenReaderIntent(intent)}.`
    );
  }

  switch (definition.kind) {
    case "invoke":
      if (definition.fixedKey) {
        return {
          kind: "invoke",
          method: "press",
          key: definition.fixedKey
        };
      }

      switch (intent.semantic) {
        case "next":
        case "previous":
        case "act":
        case "interact":
        case "stopInteracting":
          return { kind: "invoke", method: intent.semantic };
        case "press":
          return { kind: "invoke", method: "press", key: intent.key };
        case "type":
          return { kind: "invoke", method: "type", text: intent.text };
        case "click": {
          const options = intent.button !== undefined || intent.clickCount !== undefined
            ? {
                ...(intent.button !== undefined ? { button: intent.button } : {}),
                ...(intent.clickCount !== undefined ? { clickCount: intent.clickCount } : {})
              }
            : undefined;
          return { kind: "invoke", method: "click", ...(options ? { options } : {}) };
        }
        default:
          throw new Error(`Unknown stable screen reader semantic "${intent.semantic}".`);
      }
    case "read":
      return {
        kind: "read",
        method: READ_METHOD_BY_SEMANTIC[intent.semantic as keyof typeof READ_METHOD_BY_SEMANTIC]
      };
    case "maintenance":
      return {
        kind: "maintenance",
        method: MAINTENANCE_METHOD_BY_SEMANTIC[intent.semantic as keyof typeof MAINTENANCE_METHOD_BY_SEMANTIC]
      };
    case "catalog": {
      const id = definition.catalogIdsByBackend[backendId];
      if (!id) {
        throw new Error(
          `Screen reader backend "${backendId}" does not support action ${formatScreenReaderIntent(intent)}.`
        );
      }

      return {
        kind: "invoke",
        method: "perform",
        command: { source: "catalog", id }
      };
    }
  }
}

function resolveExtensionExecutableAction(
  intent: Extract<ScreenReaderIntent, { extension: "catalog" | "rawPerform" }>,
  capabilities: ScreenReaderCapabilities
): ExecutableScreenReaderAction {
  if (intent.extension === "catalog") {
    if (!capabilities.invoke.perform || !hasCatalogId(capabilities, intent.id)) {
      throw new Error(`Screen reader backend does not support action ${formatScreenReaderIntent(intent)}.`);
    }

    return {
      kind: "invoke",
      method: "perform",
      command: {
        source: "catalog",
        id: intent.id,
        ...(intent.args !== undefined ? { args: intent.args } : {})
      }
    };
  }

  if (!capabilities.invoke.supportsRawPerform) {
    throw new Error(`Screen reader backend does not support action ${formatScreenReaderIntent(intent)}.`);
  }

  return {
    kind: "invoke",
    method: "perform",
    command: {
      source: "raw",
      payload: intent.payload
    }
  };
}

function parseScreenReaderActionRef(
  value: unknown,
  label: string,
  options: { allowExtensions: boolean }
): ScreenReaderActionRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object like sr.next() or srx.catalog(...).`);
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.semantic !== undefined) {
    ensureOnlyKeys(candidate, label, ["semantic", "hint"]);
    if (!isPublicScreenReaderSemanticAction(candidate.semantic)) {
      throw new Error(`${label}.semantic must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    const hint = candidate.hint === undefined
      ? undefined
      : parseNonEmptyString(candidate.hint, `${label}.hint`);
    return createStableScreenReaderActionRef(candidate.semantic, hint);
  }

  if (!options.allowExtensions) {
    throw new Error(`${label} must use stable sr.* actions only.`);
  }

  if (candidate.extension === "catalog") {
    ensureOnlyKeys(candidate, label, ["extension", "id", "hint", "argsSchema", "argsExample"]);
    return createCatalogScreenReaderExtensionRef(
      parseNonEmptyString(candidate.id, `${label}.id`),
      parseNonEmptyString(candidate.hint, `${label}.hint`),
      parsePromptObjectSchema(candidate.argsSchema, `${label}.argsSchema`),
      parseSchemaBoundObjectExample(
        parsePromptObjectSchema(candidate.argsSchema, `${label}.argsSchema`),
        candidate.argsExample,
        `${label}.argsExample`
      )
    );
  }

  if (candidate.extension === "rawPerform") {
    ensureOnlyKeys(candidate, label, ["extension", "hint", "payloadSchema", "payloadExample"]);
    return createRawPerformScreenReaderExtensionRef(
      parseNonEmptyString(candidate.hint, `${label}.hint`),
      parsePromptObjectSchema(candidate.payloadSchema, `${label}.payloadSchema`),
      parseSchemaBoundObjectExample(
        parsePromptObjectSchema(candidate.payloadSchema, `${label}.payloadSchema`),
        candidate.payloadExample,
        `${label}.payloadExample`
      )
    );
  }

  throw new Error(`${label} must be an object like sr.next() or srx.catalog(...).`);
}

function parseScreenReaderActionRefToken(
  token: string,
  label: string,
  options: { allowExtensions: boolean }
): ScreenReaderActionRef {
  if (token.startsWith("sr.")) {
    const semantic = SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC[
      token as keyof typeof SCREEN_READER_PROMPT_TOKEN_TO_SEMANTIC
    ];
    if (!semantic) {
      throw new Error(`${label} must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}.`);
    }

    return createStableScreenReaderActionRef(semantic);
  }

  if (!options.allowExtensions) {
    throw new Error(`${label} must use stable sr.* actions only.`);
  }

  if (token.startsWith("srx.catalog.")) {
    const id = token.slice("srx.catalog.".length);
    if (!id) {
      throw new Error(`${label} must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}, srx.catalog.<id>, or srx.rawPerform.`);
    }

    return createCatalogScreenReaderExtensionRef(
      id,
      `Run extension catalog command ${id}.`,
      permissiveObjectSchema,
      {}
    );
  }

  if (token === "srx.rawPerform") {
    return createRawPerformScreenReaderExtensionRef(
      "Run a raw screen reader perform payload.",
      permissiveObjectSchema,
      {}
    );
  }

  throw new Error(`${label} must be one of ${SCREEN_READER_CLI_TOKEN_LABELS}, srx.catalog.<id>, or srx.rawPerform.`);
}

function parseCatalogExtensionIntentCandidate(
  candidate: Record<string, unknown>,
  descriptor: ScreenReaderExtensionCatalogActionDescriptor
): ParseScreenReaderIntentResult {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "args"])) {
    return { status: "malformed" };
  }

  const args = candidate.args === undefined ? undefined : parseRecord(candidate.args);
  if (candidate.args !== undefined && !args) {
    return { status: "malformed" };
  }

  const parsedArgs = descriptor.argsSchema.safeParse(args ?? {});
  if (!parsedArgs.success) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    intent: {
      extension: "catalog",
      id: descriptor.id,
      args: parsedArgs.data
    }
  };
}

function parseRawPerformExtensionIntentCandidate(
  candidate: Record<string, unknown>,
  descriptor: ScreenReaderExtensionRawPerformActionDescriptor
): ParseScreenReaderIntentResult {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "payload"])) {
    return { status: "malformed" };
  }

  const payload = parseRecord(candidate.payload);
  if (!payload) {
    return { status: "malformed" };
  }

  const parsedPayload = descriptor.payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    intent: {
      extension: "rawPerform",
      payload: parsedPayload.data
    }
  };
}

function parseKeyIntentCandidate(candidate: Record<string, unknown>): ParseScreenReaderIntentResult {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "key"])) {
    return { status: "malformed" };
  }

  const key = typeof candidate.key === "string" && candidate.key.trim()
    ? candidate.key.trim()
    : undefined;
  if (!key) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    intent: {
      semantic: "press",
      key
    }
  };
}

function parseTextIntentCandidate(candidate: Record<string, unknown>): ParseScreenReaderIntentResult {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "text"])) {
    return { status: "malformed" };
  }

  const text = typeof candidate.text === "string" && candidate.text.length > 0
    ? candidate.text
    : undefined;
  if (!text) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    intent: {
      semantic: "type",
      text
    }
  };
}

function parseClickIntentCandidate(candidate: Record<string, unknown>): ParseScreenReaderIntentResult {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "button", "clickCount"])) {
    return { status: "malformed" };
  }

  const button = parseClickButton(candidate.button);
  if (candidate.button !== undefined && button === undefined) {
    return { status: "malformed" };
  }

  const clickCount = parseClickCount(candidate.clickCount);
  if (candidate.clickCount !== undefined && clickCount === undefined) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    intent: {
      semantic: "click",
      ...(button !== undefined ? { button } : {}),
      ...(clickCount !== undefined ? { clickCount } : {})
    }
  };
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

function hasCatalogId(capabilities: ScreenReaderCapabilities, id: string): boolean {
  return capabilities.performCatalog.some((command) => command.id === id);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseClickButton(value: unknown): "left" | "right" | undefined {
  return value === "left" || value === "right" ? value : undefined;
}

function parseClickCount(value: unknown): 1 | 2 | 3 | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function hasUnexpectedKeys(candidate: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(candidate).some((key) => !allowedKeys.includes(key));
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

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function isScreenReaderActionPlan(
  value: readonly ScreenReaderActionDescriptor[] | ScreenReaderActionPlan
): value is ScreenReaderActionPlan {
  return "descriptorByToken" in value;
}

function getScreenReaderActionDefinition(
  semantic: ScreenReaderSemanticAction
): ScreenReaderActionDefinition {
  return SCREEN_READER_ACTION_DEFINITIONS[semantic] as ScreenReaderActionDefinition;
}
