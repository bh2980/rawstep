import type { Permissions } from '@rawstep/project/config';

/** What the backend of a mode can do; the screen reader side depends on the screen reader chosen for this computer. */
export type ActionCapabilities = { keys: readonly string[]; intents: readonly string[] };

export const KEYBOARD_BASIC = ['Tab', 'Shift+Tab', 'Enter', 'Space'] as const;
export const KEYBOARD_WIDGETS = [...KEYBOARD_BASIC, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End'] as const;
export const SCREENREADER_BASIC = ['next', 'previous', 'activate'] as const;
/** Jump by heading or form control; only the native screen reader backends have them. */
export const SCREENREADER_QUICK = ['heading.next', 'heading.previous', 'form.next'] as const;

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export type KeyboardPreset = 'basic' | 'widgets' | 'custom';
export type ScreenreaderPreset = 'basic' | 'quick' | 'custom';

/** Which keyboard preset the allowed actions equal; any other combination is a custom choice. */
export function keyboardPreset(permissions: Pick<Permissions, 'keys' | 'intents'>): KeyboardPreset {
  if (permissions.intents.length) return 'custom';
  if (sameSet(permissions.keys, KEYBOARD_BASIC)) return 'basic';
  return sameSet(permissions.keys, KEYBOARD_WIDGETS) ? 'widgets' : 'custom';
}

export function applyKeyboardPreset<T extends Permissions>(permissions: T, preset: Exclude<KeyboardPreset, 'custom'>): T {
  return { ...permissions, keys: [...(preset === 'basic' ? KEYBOARD_BASIC : KEYBOARD_WIDGETS)], intents: [] };
}

/** The quick-navigation intents this screen reader backend supports. */
export const quickIntents = (capabilities: ActionCapabilities): string[] => SCREENREADER_QUICK.filter(intent => capabilities.intents.includes(intent));
export const quickAvailable = (capabilities: ActionCapabilities): boolean => quickIntents(capabilities).length > 0;

/** Which screen reader preset the allowed actions equal for this backend; anything else, such as an intent the backend lacks, is custom. */
export function screenreaderPreset(permissions: Pick<Permissions, 'keys' | 'intents'>, capabilities: ActionCapabilities): ScreenreaderPreset {
  if (permissions.keys.length) return 'custom';
  if (sameSet(permissions.intents, SCREENREADER_BASIC)) return 'basic';
  return quickAvailable(capabilities) && sameSet(permissions.intents, [...SCREENREADER_BASIC, ...quickIntents(capabilities)]) ? 'quick' : 'custom';
}

export function applyScreenreaderPreset<T extends Permissions>(permissions: T, preset: Exclude<ScreenreaderPreset, 'custom'>, capabilities: ActionCapabilities): T {
  return { ...permissions, keys: [], intents: [...SCREENREADER_BASIC, ...(preset === 'quick' ? quickIntents(capabilities) : [])] };
}
