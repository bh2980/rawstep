import {
  DEFAULT_ALLOWED_KEYS,
  SUPPORTED_KEYS,
  SUPPORTED_KEY_LABELS
} from "./generated";

export {
  DEFAULT_ALLOWED_KEYS,
  SUPPORTED_KEYS,
  SUPPORTED_KEY_LABELS
};

export type KeyboardSupportedKey = (typeof SUPPORTED_KEYS)[number];
export type AllowedKey = KeyboardSupportedKey;
export type KeyboardPromptToken = `key.${KeyboardSupportedKey}`;

type KeyboardActionRefShape = {
  key: KeyboardSupportedKey;
  hint?: string;
};

declare const keyboardActionRefBrand: unique symbol;

export type KeyboardActionRef = KeyboardActionRefShape & {
  readonly [keyboardActionRefBrand]: true;
};

export type KeyboardActionDescriptor = {
  key: KeyboardSupportedKey;
  token: KeyboardPromptToken;
  hint?: string;
};

export type KeyboardActionPlan = {
  refs: readonly KeyboardActionRef[];
  descriptors: readonly KeyboardActionDescriptor[];
  descriptorByToken: Readonly<Record<string, KeyboardActionDescriptor>>;
  allowedKeys: readonly KeyboardSupportedKey[];
};

export type ParseKeyboardActionResult =
  | { status: "matched"; action: { key: KeyboardSupportedKey } }
  | { status: "not-found" }
  | { status: "malformed" };

export function createKeyboardActionRef(
  key: KeyboardSupportedKey,
  hint?: string
): KeyboardActionRef {
  return {
    key,
    ...(hint ? { hint } : {})
  } as KeyboardActionRef;
}

export function createDefaultKeyboardActionRefs(): readonly KeyboardActionRef[] {
  return DEFAULT_ALLOWED_KEYS.map((key) => createKeyboardActionRef(key));
}

export function buildKeyboardActionPlan(
  refs: readonly KeyboardActionRef[] = createDefaultKeyboardActionRefs()
): KeyboardActionPlan {
  const order: KeyboardSupportedKey[] = [];
  const hints = new Map<KeyboardSupportedKey, string | undefined>();

  for (const ref of refs) {
    if (!order.includes(ref.key)) {
      order.push(ref.key);
    }

    hints.set(ref.key, normalizeHint(ref.hint));
  }

  const normalizedRefs = order.map((key) => createKeyboardActionRef(key, hints.get(key)));
  const descriptors = order.map((key) => buildKeyboardActionDescriptor(key, hints.get(key)));
  const descriptorByToken: Record<string, KeyboardActionDescriptor> = {};

  for (const descriptor of descriptors) {
    if (descriptorByToken[descriptor.token]) {
      throw new Error(`Duplicate keyboard prompt token "${descriptor.token}".`);
    }

    descriptorByToken[descriptor.token] = descriptor;
  }

  return {
    refs: normalizedRefs,
    descriptors,
    descriptorByToken,
    allowedKeys: order
  };
}

export function parseKeyboardActionRef(value: unknown, label: string): KeyboardActionRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object like kb.tab() or { key: "Tab" }.`);
  }

  const candidate = value as Record<string, unknown>;
  ensureOnlyKeys(candidate, label, ["key", "hint"]);

  const key = candidate.key;
  if (typeof key !== "string" || !isKeyboardSupportedKey(key)) {
    throw new Error(`${label}.key must be one of ${SUPPORTED_KEY_LABELS}.`);
  }

  const hint = candidate.hint === undefined
    ? undefined
    : parseNonEmptyString(candidate.hint, `${label}.hint`);

  return createKeyboardActionRef(key, hint);
}

export function parseKeyboardActionRefs(value: unknown, label: string): KeyboardActionRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of keyboard actions.`);
  }

  return value.map((entry, index) => parseKeyboardActionRef(entry, `${label}[${index}]`));
}

export function parseKeyboardActionCandidate(
  candidate: Record<string, unknown>,
  descriptors?: readonly KeyboardActionDescriptor[] | KeyboardActionPlan
): ParseKeyboardActionResult {
  const value = typeof candidate.action === "string" ? candidate.action.trim() : "";
  if (!value.startsWith("key.")) {
    return { status: "not-found" };
  }

  if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
    return { status: "malformed" };
  }

  const descriptor = resolveKeyboardActionDescriptor(value, descriptors);
  if (!descriptor) {
    return { status: "malformed" };
  }

  return {
    status: "matched",
    action: {
      key: descriptor.key
    }
  };
}

export function buildKeyboardDescriptorExampleSnippet(
  descriptor: KeyboardActionDescriptor,
  includeRationale = false
): string {
  return JSON.stringify(
    includeRationale
      ? { action: descriptor.token, rationale: "..." }
      : { action: descriptor.token }
  );
}

export function formatKeyboardPromptToken(key: KeyboardSupportedKey): KeyboardPromptToken {
  return `key.${key}`;
}

export function isKeyboardSupportedKey(value: string): value is KeyboardSupportedKey {
  return (SUPPORTED_KEYS as readonly string[]).includes(value);
}

export function isAllowedKey(value: string): value is AllowedKey {
  return isKeyboardSupportedKey(value);
}

export function createEmptyKeyCounts(): Record<AllowedKey, number> {
  return Object.fromEntries(SUPPORTED_KEYS.map((key) => [key, 0])) as Record<AllowedKey, number>;
}

function buildKeyboardActionDescriptor(
  key: KeyboardSupportedKey,
  hint?: string
): KeyboardActionDescriptor {
  return {
    key,
    token: formatKeyboardPromptToken(key),
    ...(hint ? { hint } : {})
  };
}

function resolveKeyboardActionDescriptor(
  token: string,
  descriptors?: readonly KeyboardActionDescriptor[] | KeyboardActionPlan
): KeyboardActionDescriptor | undefined {
  if (!descriptors) {
    return buildKeyboardActionPlan().descriptorByToken[token];
  }

  if (isKeyboardActionPlan(descriptors)) {
    return descriptors.descriptorByToken[token];
  }

  return descriptors.find((descriptor) => descriptor.token === token);
}

function isKeyboardActionPlan(value: unknown): value is KeyboardActionPlan {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "descriptorByToken" in value;
}

function normalizeHint(hint: string | undefined): string | undefined {
  if (hint === undefined) {
    return undefined;
  }

  const normalized = hint.trim();
  return normalized ? normalized : undefined;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
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

function hasUnexpectedKeys(candidate: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(candidate).some((key) => !allowedKeys.includes(key));
}
