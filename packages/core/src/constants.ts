export const ALLOWED_KEYS = [
  "Tab",
  "Shift+Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Space",
  "Escape"
] as const;

export const SCREENREADER_COMMANDS = [
  "nextItem",
  "previousItem",
  "nextHeading",
  "previousHeading",
  "nextFormControl",
  "previousFormControl",
  "act"
] as const;

export const SCREENREADER_COMMAND_METADATA = {
  nextItem: { category: "navigation" },
  previousItem: { category: "navigation" },
  nextHeading: { category: "heading" },
  previousHeading: { category: "heading" },
  nextFormControl: { category: "form" },
  previousFormControl: { category: "form" },
  act: { category: "action" }
} as const;

export const SCROLL_HINTS = ["top", "middle", "bottom"] as const;

export const DEFAULT_VIEWPORT = {
  w: 1280,
  h: 800
} as const;

export const SETTLE_MS = 120;

export type AllowedKey = (typeof ALLOWED_KEYS)[number];
export type ScreenReaderCommand = (typeof SCREENREADER_COMMANDS)[number];
export type ScreenReaderCommandCategory =
  (typeof SCREENREADER_COMMAND_METADATA)[ScreenReaderCommand]["category"];
export type ScrollHint = (typeof SCROLL_HINTS)[number];

export function isAllowedKey(value: string): value is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(value);
}

export function isScrollHint(value: string): value is ScrollHint {
  return (SCROLL_HINTS as readonly string[]).includes(value);
}

export function isScreenReaderCommand(value: string): value is ScreenReaderCommand {
  return (SCREENREADER_COMMANDS as readonly string[]).includes(value);
}

export function createEmptyKeyCounts(): Record<AllowedKey, number> {
  return Object.fromEntries(ALLOWED_KEYS.map((key) => [key, 0])) as Record<AllowedKey, number>;
}
