import { formatScreenReaderIntent, type ScreenReaderIntent } from "./screen-reader";

export type FormattableAction =
  | { key: string }
  | { typeText: string }
  | { srAction: ScreenReaderIntent };

export function formatDecisionAction(action: FormattableAction): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("typeText" in action) {
    return `typeText(${action.typeText})`;
  }

  return formatScreenReaderIntent(action.srAction);
}
