import type { Permissions, Profile } from '@rawstep/project/config';
import { t } from '../i18n/index.js';
import { SCREENREADER_BASIC, SCREENREADER_KEYS, SCREENREADER_MORE, SCREENREADER_QUICK } from './presets.js';

/**
 * Who the simulated user is: a starting point in the words a person picks it by. A screen reader user new to their screen reader reads
 * item by item; one who knows it jumps by heading, lists the headings and types the task's inputs; a skilled one also jumps by link,
 * lists the links and uses Tab and the arrow keys in forms and menus.
 * `custom` is a user whose actions were picked one by one.
 */
export type Persona = 'novice' | 'expert' | 'skilled' | 'custom';
type Preset = Exclude<Persona, 'custom'>;
export const PRESETS: readonly Preset[] = ['novice', 'expert', 'skilled'];

const permissions = (keys: readonly string[], intents: readonly string[], typeText: boolean): Permissions => ({ keys: [...keys], intents: [...intents], typeText, replaceText: false });
const PERMISSIONS: Record<Preset, Permissions> = {
  novice: permissions([], SCREENREADER_BASIC, false),
  expert: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_QUICK], true),
  skilled: permissions(SCREENREADER_KEYS, [...SCREENREADER_BASIC, ...SCREENREADER_QUICK, ...SCREENREADER_MORE], true),
};
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every(item => a.includes(item));

/** The starting point a profile's actions still equal, or `custom`. Typing is the user's to change and does not count. */
export function personaOf(profile: Pick<Profile, 'actions'>): Persona {
  const actions = profile.actions;
  return PRESETS.find(preset => sameSet(actions.keys, PERMISSIONS[preset].keys) && sameSet(actions.intents, PERMISSIONS[preset].intents)) ?? 'custom';
}

/** The profile's actions after picking a starting point. */
export function withPreset<P extends Pick<Profile, 'actions'>>(profile: P, preset: Preset): P {
  return { ...profile, actions: structuredClone(PERMISSIONS[preset]) };
}

/** The user in a few words, such as "처음 쓰는 스크린리더 사용자". */
export function personaName(persona: Persona): string {
  return t(`persona.${persona}.name`);
}
