import {
  type AllowedKey,
  buildKeyboardActionPlan,
  createKeyboardActionRef,
  parseKeyboardActionRefs,
  type KeyboardActionPlan,
  type KeyboardActionRef
} from "@rawstep/action-catalog";
import { KEYBOARD_HELPER_PATH_TO_KEY } from "@rawstep/action-catalog";
import { buildNestedHelperTree, type ExpandDeep, type PathToTree, type UnionToIntersection } from "./helper-tree";

type KeyboardActionOptions = {
  hint?: string;
};

type KeyboardHelperPath = keyof typeof KEYBOARD_HELPER_PATH_TO_KEY & string;

export type KeyboardHelperApi = ExpandDeep<
  UnionToIntersection<{
    [Path in KeyboardHelperPath]: PathToTree<
      Path,
      (options?: KeyboardActionOptions) => KeyboardActionRef
    >;
  }[KeyboardHelperPath]>
>;

export const kb = buildNestedHelperTree(
  KEYBOARD_HELPER_PATH_TO_KEY,
  (key) => (options?: KeyboardActionOptions) =>
    createKeyboardActionRef(key as AllowedKey, options?.hint)
) as KeyboardHelperApi;

export function parseConfiguredKeyboardActions(
  value: unknown,
  label: string
): KeyboardActionRef[] {
  return parseKeyboardActionRefs(value, label);
}

export function buildKeyboardActionPlanFromAllowedKeys(
  allowedKeys: readonly AllowedKey[]
): KeyboardActionPlan {
  return buildKeyboardActionPlan(
    allowedKeys.map((key) => createKeyboardActionRef(key))
  );
}
