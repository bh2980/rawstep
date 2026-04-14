import type {
  AllowedKey,
  ConfiguredKeyboardAction,
  ResolvedPromptKeyboardAction
} from "@rawstep/core";
import { isAllowedKey, SUPPORTED_KEY_LABELS } from "@rawstep/core";
import { KEYBOARD_HELPER_PATH_TO_KEY } from "@rawstep/action-catalog";
import { buildNestedHelperTree, type ExpandDeep, type PathToTree, type UnionToIntersection } from "./helper-tree";

type KeyboardActionOptions = {
  hint?: string;
};

type ConfiguredKeyboardActionShape = Omit<ConfiguredKeyboardAction, never>;

type KeyboardHelperPath = keyof typeof KEYBOARD_HELPER_PATH_TO_KEY & string;

export type KeyboardHelperApi = ExpandDeep<
  UnionToIntersection<{
    [Path in KeyboardHelperPath]: PathToTree<
      Path,
      (options?: KeyboardActionOptions) => ConfiguredKeyboardAction
    >;
  }[KeyboardHelperPath]>
>;

export const kb = buildNestedHelperTree(
  KEYBOARD_HELPER_PATH_TO_KEY,
  (key) => (options?: KeyboardActionOptions) =>
    buildConfiguredKeyboardAction(key as ConfiguredKeyboardActionShape["key"], options)
) as KeyboardHelperApi;

export function parseConfiguredKeyboardActions(
  value: unknown,
  label: string
): ConfiguredKeyboardAction[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of keyboard actions.`);
  }

  return value.map((entry, index) => parseConfiguredKeyboardAction(entry, `${label}[${index}]`));
}

export function resolveConfiguredKeyboardActions(
  configuredActions: readonly ConfiguredKeyboardAction[]
): {
  runtimeKeys: readonly AllowedKey[];
  promptActions: readonly ResolvedPromptKeyboardAction[];
} {
  const order: AllowedKey[] = [];
  const hints = new Map<AllowedKey, string | undefined>();

  for (const action of configuredActions) {
    if (!order.includes(action.key)) {
      order.push(action.key);
    }

    hints.set(action.key, action.hint);
  }

  return {
    runtimeKeys: order,
    promptActions: order.map((key) => ({
      key,
      ...(hints.get(key) ? { hint: hints.get(key) } : {})
    }))
  };
}

export function buildPromptKeyboardActions(
  allowedKeys: readonly AllowedKey[]
): readonly ResolvedPromptKeyboardAction[] {
  return allowedKeys.map((key) => ({ key }));
}

function buildConfiguredKeyboardAction(
  key: ConfiguredKeyboardActionShape["key"],
  options?: KeyboardActionOptions
): ConfiguredKeyboardAction {
  return {
    key,
    ...(options?.hint ? { hint: options.hint } : {})
  } as ConfiguredKeyboardAction;
}

function parseConfiguredKeyboardAction(
  value: unknown,
  label: string
): ConfiguredKeyboardAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object like { key: "Tab" }.`);
  }

  const candidate = value as Record<string, unknown>;
  ensureOnlyKeys(candidate, label, ["key", "hint"]);

  const key = candidate.key;
  if (typeof key !== "string" || !isAllowedKey(key)) {
    throw new Error(`${label}.key must be one of ${SUPPORTED_KEY_LABELS}.`);
  }

  const hint = candidate.hint === undefined
    ? undefined
    : parseOptionalHint(candidate.hint, `${label}.hint`);

  return buildConfiguredKeyboardAction(key, hint ? { hint } : undefined);
}

function parseOptionalHint(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
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
