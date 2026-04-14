import {
  DEFAULT_ALLOWED_KEYS,
  SUPPORTED_KEYS,
  SUPPORTED_KEY_LABELS
} from "@rawstep/action-catalog";

export {
  DEFAULT_ALLOWED_KEYS,
  SUPPORTED_KEYS,
  SUPPORTED_KEY_LABELS
};

// Backward-compatible alias for callers that still import ALLOWED_KEYS as the default preset.
export const ALLOWED_KEYS = DEFAULT_ALLOWED_KEYS;

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

export type AllowedKey = (typeof SUPPORTED_KEYS)[number];
export type ScreenReaderActionKind = (typeof SCREEN_READER_ACTION_KINDS)[number];
export type ScreenReaderInvokeMethod = (typeof SCREEN_READER_INVOKE_METHODS)[number];
export type ScreenReaderReadMethod = (typeof SCREEN_READER_READ_METHODS)[number];
export type ScreenReaderMaintenanceMethod = (typeof SCREEN_READER_MAINTENANCE_METHODS)[number];
export type ScrollHint = (typeof SCROLL_HINTS)[number];

export function isAllowedKey(value: string): value is AllowedKey {
  return (SUPPORTED_KEYS as readonly string[]).includes(value);
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
  return Object.fromEntries(SUPPORTED_KEYS.map((key) => [key, 0])) as Record<AllowedKey, number>;
}
