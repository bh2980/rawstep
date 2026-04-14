import type {
  AllowedScreenReaderAction,
  ResolvedPromptScreenReaderAction
} from "@rawstep/core";

const BUILTIN_SEMANTIC_BY_CATALOG_ID: Record<string, "heading.next" | "heading.previous" | "form.next" | "form.previous"> = {
  "keyboard.findNextHeading": "heading.next",
  "keyboard.moveToNextHeading": "heading.next",
  "commands.moveToNextHeading": "heading.next",
  "keyboard.findPreviousHeading": "heading.previous",
  "keyboard.moveToPreviousHeading": "heading.previous",
  "commands.moveToPreviousHeading": "heading.previous",
  "keyboard.findNextControl": "form.next",
  "keyboard.moveToNextFormField": "form.next",
  "commands.moveToNextForm": "form.next",
  "keyboard.findPreviousControl": "form.previous",
  "keyboard.moveToPreviousFormField": "form.previous",
  "commands.moveToPreviousForm": "form.previous"
};

export function getBuiltInScreenReaderSemanticByCatalogId(
  id: string
): "heading.next" | "heading.previous" | "form.next" | "form.previous" | undefined {
  return BUILTIN_SEMANTIC_BY_CATALOG_ID[id];
}

export function formatResolvedPromptScreenReaderActionName(
  action: ResolvedPromptScreenReaderAction
): string {
  if ("unstable" in action && action.unstable === "catalog") {
    return `srUnstable.catalog.${action.id}`;
  }

  if ("unstable" in action && action.unstable === "rawPerform") {
    return "srUnstable.rawPerform";
  }

  return `sr.${action.semantic}`;
}

export function formatAllowedScreenReaderActionPromptName(
  action: AllowedScreenReaderAction
): string {
  if (action.kind === "read") {
    return `sr.read.${action.method}`;
  }

  if (action.kind === "maintenance") {
    return action.method === "clearItemTextLog"
      ? "sr.clear.itemTextLog"
      : "sr.clear.spokenPhraseLog";
  }

  if (action.kind === "invoke" && action.method === "perform") {
    if (action.source === "raw") {
      return "";
    }

    const semantic = getBuiltInScreenReaderSemanticByCatalogId(action.id);
    return semantic ? `sr.${semantic}` : "";
  }

  return `sr.${action.method}`;
}
