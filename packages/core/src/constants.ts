export const ALLOWED_KEYS = [
  "Tab",
  "Shift+Tab",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Space",
  "Escape"
] as const;

export const SCREEN_READER_ACTION_KINDS = [
  "invoke",
  "read",
  "maintenance"
] as const;

export const SCREEN_READER_INVOKE_METHODS = [
  "next",
  "previous",
  "act",
  "interact",
  "stopInteracting",
  "press",
  "type",
  "click",
  "perform"
] as const;

export const SCREEN_READER_READ_METHODS = [
  "itemText",
  "itemTextLog",
  "lastSpokenPhrase",
  "spokenPhraseLog"
] as const;

export const SCREEN_READER_MAINTENANCE_METHODS = [
  "clearItemTextLog",
  "clearSpokenPhraseLog"
] as const;

export const SCROLL_HINTS = ["top", "middle", "bottom"] as const;

export const DEFAULT_VIEWPORT = {
  w: 1280,
  h: 800
} as const;

export const SETTLE_MS = 120;

export type AllowedKey = (typeof ALLOWED_KEYS)[number];
export type ScreenReaderActionKind = (typeof SCREEN_READER_ACTION_KINDS)[number];
export type ScreenReaderInvokeMethod = (typeof SCREEN_READER_INVOKE_METHODS)[number];
export type ScreenReaderReadMethod = (typeof SCREEN_READER_READ_METHODS)[number];
export type ScreenReaderMaintenanceMethod = (typeof SCREEN_READER_MAINTENANCE_METHODS)[number];
export type ScrollHint = (typeof SCROLL_HINTS)[number];

export function isAllowedKey(value: string): value is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(value);
}

export function isScrollHint(value: string): value is ScrollHint {
  return (SCROLL_HINTS as readonly string[]).includes(value);
}

export function isScreenReaderActionKind(value: string): value is ScreenReaderActionKind {
  return (SCREEN_READER_ACTION_KINDS as readonly string[]).includes(value);
}

export function isScreenReaderInvokeMethod(value: string): value is ScreenReaderInvokeMethod {
  return (SCREEN_READER_INVOKE_METHODS as readonly string[]).includes(value);
}

export function isScreenReaderReadMethod(value: string): value is ScreenReaderReadMethod {
  return (SCREEN_READER_READ_METHODS as readonly string[]).includes(value);
}

export function isScreenReaderMaintenanceMethod(value: string): value is ScreenReaderMaintenanceMethod {
  return (SCREEN_READER_MAINTENANCE_METHODS as readonly string[]).includes(value);
}

export function createEmptyKeyCounts(): Record<AllowedKey, number> {
  return Object.fromEntries(ALLOWED_KEYS.map((key) => [key, 0])) as Record<AllowedKey, number>;
}
