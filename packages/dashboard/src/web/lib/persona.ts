import type { Permissions, Profile } from '@rawstep/project/config';
import { t } from '../i18n/index.js';
import { SCREENREADER_BASIC, SCREENREADER_FORM_CONTROLS, SCREENREADER_HEADINGS, SCREENREADER_LINKS } from './presets.js';

/**
 * Who the simulated user is: a starting point in the words a person picks it by. A screen reader user is described by how they look
 * for things, not by how skilled they are: item by item, or item by item plus one way of jumping (headings, form controls or links,
 * each with its rotor list). People differ in the way they pick, so each way is run and costed on its own rather than one guess at
 * what a skilled user does.
 * `custom` is a user whose actions were picked one by one.
 */
export type Persona = 'linear' | 'headings' | 'formControls' | 'links' | 'custom';
type Preset = Exclude<Persona, 'custom'>;
export const PRESETS: readonly Preset[] = ['linear', 'headings', 'formControls', 'links'];

const permissions = (keys: readonly string[], intents: readonly string[], typeText: boolean): Permissions => ({ keys: [...keys], intents: [...intents], typeText, replaceText: false });
// Typing the task's inputs is part of the task, not a way of finding things, so every screen reader way allows it.
const PERMISSIONS: Record<Preset, Permissions> = {
  linear: permissions([], SCREENREADER_BASIC, true),
  headings: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_HEADINGS], true),
  formControls: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_FORM_CONTROLS], true),
  links: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_LINKS], true),
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

/** The user in a few words, such as "제목으로 찾는 스크린리더 사용자". */
export function personaName(persona: Persona): string {
  return t(`persona.${persona}.name`);
}
