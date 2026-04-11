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

export const SCROLL_HINTS = ["top", "middle", "bottom"] as const;

export const DEFAULT_VIEWPORT = {
  w: 1280,
  h: 800
} as const;

export const DEFAULT_MAX_STEPS = 50;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const HISTORY_WINDOW = 8;
export const SETTLE_MS = 120;

export type AllowedKey = (typeof ALLOWED_KEYS)[number];
export type ScreenReaderCommand = (typeof SCREENREADER_COMMANDS)[number];
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
