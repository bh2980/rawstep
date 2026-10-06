/** The colour theme: follow the system, or an explicit light or dark choice kept in localStorage. */
export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_KEY = 'rawstep.theme';
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Anything stored that is not a known choice means "follow the system". */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): 'light' | 'dark' =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

/** The toggle cycles system, light, dark. */
export const nextThemePreference = (preference: ThemePreference): ThemePreference => ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;

/** Reads and writes never throw: storage can be blocked, full or missing (private windows, previews). */
export function readThemePreference(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): ThemePreference {
  try { return parseThemePreference(storage?.getItem(THEME_KEY)); } catch { return 'system'; }
}

export function writeThemePreference(preference: ThemePreference, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  try {
    if (preference === 'system') storage?.removeItem(THEME_KEY); else storage?.setItem(THEME_KEY, preference);
  } catch { /* the choice then only lasts until the page is closed */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
