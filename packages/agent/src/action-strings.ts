import { SCREEN_READER_SEMANTIC_BY_CATALOG_ID } from "@rawstep/action-catalog";
import type {
  AllowedScreenReaderAction,
  ScreenReaderSemanticAction,
  ResolvedPromptScreenReaderAction
} from "@rawstep/core";

export function getBuiltInScreenReaderSemanticByCatalogId(
  id: string
): ScreenReaderSemanticAction | undefined {
  return SCREEN_READER_SEMANTIC_BY_CATALOG_ID[id as keyof typeof SCREEN_READER_SEMANTIC_BY_CATALOG_ID];
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
