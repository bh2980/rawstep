import { formatScreenReaderIntent, type ScreenReaderIntent } from "./screen-reader";

export type FormattableAction =
  | { key: string }
  | { typeText: string }
  | { replaceText: string }
  | { srAction: ScreenReaderIntent };

export function formatDecisionAction(action: FormattableAction): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("typeText" in action) {
    return `typeText(${JSON.stringify(action.typeText)})`;
  }

  if ("replaceText" in action) {
    return `replaceText(${JSON.stringify(action.replaceText)})`;
  }

  return formatScreenReaderIntent(action.srAction);
}
