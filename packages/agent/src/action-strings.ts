import type {
  AllowedScreenReaderAction,
  ScreenReaderSemanticAction,
  ResolvedPromptScreenReaderAction
} from "@rawstep/core";

const BUILTIN_SEMANTIC_BY_CATALOG_ID: Partial<Record<string, ScreenReaderSemanticAction>> = {
  "keyboard.findNextHeading": "heading.next",
  "keyboard.moveToNextHeading": "heading.next",
  "commands.moveToNextHeading": "heading.next",
  "keyboard.findPreviousHeading": "heading.previous",
  "keyboard.moveToPreviousHeading": "heading.previous",
  "commands.moveToPreviousHeading": "heading.previous",
  "keyboard.moveToNextHeadingLevel1": "heading.level.1.next",
  "commands.moveToNextHeadingLevel1": "heading.level.1.next",
  "keyboard.moveToPreviousHeadingLevel1": "heading.level.1.previous",
  "commands.moveToPreviousHeadingLevel1": "heading.level.1.previous",
  "keyboard.moveToNextHeadingLevel2": "heading.level.2.next",
  "commands.moveToNextHeadingLevel2": "heading.level.2.next",
  "keyboard.moveToPreviousHeadingLevel2": "heading.level.2.previous",
  "commands.moveToPreviousHeadingLevel2": "heading.level.2.previous",
  "keyboard.moveToNextHeadingLevel3": "heading.level.3.next",
  "commands.moveToNextHeadingLevel3": "heading.level.3.next",
  "keyboard.moveToPreviousHeadingLevel3": "heading.level.3.previous",
  "commands.moveToPreviousHeadingLevel3": "heading.level.3.previous",
  "keyboard.moveToNextHeadingLevel4": "heading.level.4.next",
  "commands.moveToNextHeadingLevel4": "heading.level.4.next",
  "keyboard.moveToPreviousHeadingLevel4": "heading.level.4.previous",
  "commands.moveToPreviousHeadingLevel4": "heading.level.4.previous",
  "keyboard.moveToNextHeadingLevel5": "heading.level.5.next",
  "commands.moveToNextHeadingLevel5": "heading.level.5.next",
  "keyboard.moveToPreviousHeadingLevel5": "heading.level.5.previous",
  "commands.moveToPreviousHeadingLevel5": "heading.level.5.previous",
  "keyboard.moveToNextHeadingLevel6": "heading.level.6.next",
  "commands.moveToNextHeadingLevel6": "heading.level.6.next",
  "keyboard.moveToPreviousHeadingLevel6": "heading.level.6.previous",
  "commands.moveToPreviousHeadingLevel6": "heading.level.6.previous",
  "keyboard.findNextControl": "form.next",
  "keyboard.moveToNextFormField": "form.next",
  "commands.moveToNextForm": "form.next",
  "keyboard.findPreviousControl": "form.previous",
  "keyboard.moveToPreviousFormField": "form.previous",
  "commands.moveToPreviousForm": "form.previous",
  "keyboard.moveToNextLink": "link.next",
  "commands.moveToNextLink": "link.next",
  "keyboard.moveToPreviousLink": "link.previous",
  "commands.moveToPreviousLink": "link.previous",
  "commander.FIND_NEXT_BUTTON": "button.next",
  "keyboard.moveToNextButton": "button.next",
  "commander.FIND_PREVIOUS_BUTTON": "button.previous",
  "keyboard.moveToPreviousButton": "button.previous",
  "commander.FIND_NEXT_LANDMARK": "landmark.next",
  "keyboard.moveToNextLandmark": "landmark.next",
  "commands.moveToNextLandmark": "landmark.next",
  "commander.FIND_PREVIOUS_LANDMARK": "landmark.previous",
  "keyboard.moveToPreviousLandmark": "landmark.previous",
  "commands.moveToPreviousLandmark": "landmark.previous",
  "keyboard.moveToNextList": "list.next",
  "keyboard.moveToPreviousList": "list.previous",
  "keyboard.moveToNextTable": "table.next",
  "keyboard.moveToPreviousTable": "table.previous"
};

export function getBuiltInScreenReaderSemanticByCatalogId(
  id: string
): ScreenReaderSemanticAction | undefined {
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
