import type { Mode, Permissions, Profile } from '@rawstep/project/config';
import { SCREENREADER_BASIC, SCREENREADER_QUICK } from './presets';

/**
 * Who the simulated user is, in the words a person picks it by: a screen reader user new to their screen reader (reads item by item),
 * one who knows it (jumps by heading, lists the headings, types the task's inputs), or a keyboard user. `custom` is a screen reader
 * user whose actions were picked one by one.
 */
export type Persona = 'novice' | 'expert' | 'keyboard' | 'custom';
export const PERSONAS = ['novice', 'expert', 'keyboard'] as const;

const NOVICE: Permissions = { keys: [], intents: [...SCREENREADER_BASIC], typeText: false, replaceText: false };
const EXPERT: Permissions = { keys: [], intents: [...SCREENREADER_BASIC, ...SCREENREADER_QUICK], typeText: true, replaceText: false };
const sameIntents = (a: readonly string[], b: readonly string[]) => a.length === b.length && b.every(intent => a.includes(intent));

/** The persona a mode and profile amount to: keyboard mode is the keyboard user; in screen reader mode the allowed actions decide. */
export function personaOf(mode: Mode, profile: Pick<Profile, 'actions'>): Persona {
  if (mode === 'keyboard') return 'keyboard';
  const actions = profile.actions.screenreader;
  if (actions.keys.length) return 'custom';
  if (sameIntents(actions.intents, NOVICE.intents)) return 'novice';
  if (sameIntents(actions.intents, EXPERT.intents)) return 'expert';
  return 'custom';
}

/**
 * The mode and profile after picking a persona. A screen reader persona sets the screen reader actions (and keeps the keyboard ones);
 * the keyboard user only switches the mode, since keyboard keys do not change with experience in the same way.
 */
export function withPersona<P extends Pick<Profile, 'actions'>>(profile: P, persona: Exclude<Persona, 'custom'>): { mode: Mode; profile: P } {
  if (persona === 'keyboard') return { mode: 'keyboard', profile };
  const screenreader = structuredClone(persona === 'novice' ? NOVICE : EXPERT);
  return { mode: 'screenreader', profile: { ...profile, actions: { ...profile.actions, screenreader } } };
}
