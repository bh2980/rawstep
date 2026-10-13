import type { Mode, Permissions, Profile } from '@rawstep/project/config';
import { t } from '../i18n';
import { KEYBOARD_ALL, KEYBOARD_BASIC, KEYBOARD_WIDGETS, SCREENREADER_BASIC, SCREENREADER_KEYS, SCREENREADER_MORE, SCREENREADER_QUICK } from './presets';

/**
 * Who the simulated user is: first how they use the page (the profile's mode), then a starting point within it, in the words a person
 * picks it by. A screen reader user new to their screen reader reads item by item; one who knows it jumps by heading, lists the
 * headings and types the task's inputs; a skilled one also jumps by link, lists the links and uses Tab and the arrow keys in forms and
 * menus. A keyboard user moves with the basic keys, also works menus and dialogs with the arrow keys, or uses every key including
 * scrolling and the browser's back.
 * `custom` is a user whose actions were picked one by one.
 */
export type Persona = 'novice' | 'expert' | 'skilled' | 'basic' | 'widgets' | 'full' | 'custom';
type Preset = Exclude<Persona, 'custom'>;
export const PRESETS: Record<Mode, readonly Preset[]> = { screenreader: ['novice', 'expert', 'skilled'], keyboard: ['basic', 'widgets', 'full'] };

const permissions = (keys: readonly string[], intents: readonly string[], typeText: boolean): Permissions => ({ keys: [...keys], intents: [...intents], typeText, replaceText: false });
const PERMISSIONS: Record<Preset, Permissions> = {
  novice: permissions([], SCREENREADER_BASIC, false),
  expert: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_QUICK], true),
  skilled: permissions(SCREENREADER_KEYS, [...SCREENREADER_BASIC, ...SCREENREADER_QUICK, ...SCREENREADER_MORE], true),
  basic: permissions(KEYBOARD_BASIC, [], false),
  widgets: permissions(KEYBOARD_WIDGETS, [], true),
  full: permissions(KEYBOARD_ALL, [], true),
};
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every(item => a.includes(item));

/** The starting point a profile's actions in its mode still equal, or `custom`. Typing is the user's to change and does not count. */
export function personaOf(mode: Mode, profile: Pick<Profile, 'actions'>): Persona {
  const actions = profile.actions[mode];
  return PRESETS[mode].find(preset => sameSet(actions.keys, PERMISSIONS[preset].keys) && sameSet(actions.intents, PERMISSIONS[preset].intents)) ?? 'custom';
}

/** The profile's actions in a mode after picking a starting point there; the other mode's actions stay. */
export function withPreset<P extends Pick<Profile, 'actions'>>(profile: P, mode: Mode, preset: Preset): P {
  return { ...profile, actions: { ...profile.actions, [mode]: structuredClone(PERMISSIONS[preset]) } };
}

/** The user in a few words, such as "처음 쓰는 스크린리더 사용자". */
export function personaName(mode: Mode, persona: Persona): string {
  return persona === 'custom' ? t(`persona.custom.${mode}`) : t(`persona.${persona}.name`);
}
