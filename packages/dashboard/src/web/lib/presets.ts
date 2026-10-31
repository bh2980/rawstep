import type { ActionSet, Permissions } from '@rawstep/project/config';

/** What the backend of a mode can do. */
export type ActionCapabilities = { keys: readonly string[]; intents: readonly string[] };

export const KEYBOARD_BASIC = ['Tab', 'Shift+Tab', 'Enter', 'Space'] as const;
/** Arrow keys, Escape, Home and End on top of the basic keys: menus, tabs, comboboxes and dialogs move with them. */
export const KEYBOARD_WIDGETS = [...KEYBOARD_BASIC, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End'] as const;
export const SCREENREADER_BASIC = ['next', 'previous', 'activate'] as const;
/** Jump by heading or form control, and list the headings (the rotor): how people who know their screen reader move around. */
export const SCREENREADER_QUICK = ['heading.next', 'heading.previous', 'form.next', 'headings.list'] as const;
/** Links and going back through form controls, by quick navigation and the rotor (its links and form controls lists): what a skilled screen reader user adds. */
export const SCREENREADER_MORE = ['form.previous', 'link.next', 'link.previous', 'links.list', 'formControls.rotor'] as const;
/** Keys a skilled screen reader user presses in forms, menus and dialogs, where focus moves with them. */
export const SCREENREADER_KEYS = ['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
/** Every keyboard key, with scrolling up a page (Shift+Space) and the browser's back (Alt+←). */
export const KEYBOARD_ALL = [...KEYBOARD_WIDGETS, 'PageUp', 'PageDown', 'Shift+Space', 'Backspace', 'Delete', 'Alt+ArrowLeft'] as const;

/** The action sets a person can start from: a novice, a practised screen reader user, and one who works widgets with the keyboard. */
export const ACTION_SET_PRESETS = ['novice', 'expert', 'widgets'] as const;
export type ActionSetPreset = (typeof ACTION_SET_PRESETS)[number];

const permissions = (keys: readonly string[], intents: readonly string[], typeText: boolean): Permissions => ({ keys: [...keys], intents: [...intents], typeText, replaceText: false });

/** The two modes of a starting action set. */
export function presetPermissions(preset: ActionSetPreset): Pick<ActionSet, 'keyboard' | 'screenreader'> {
  switch (preset) {
    case 'novice': return { keyboard: permissions(KEYBOARD_BASIC, [], false), screenreader: permissions([], SCREENREADER_BASIC, false) };
    case 'expert': return { keyboard: permissions(KEYBOARD_BASIC, [], true), screenreader: permissions([], [...SCREENREADER_BASIC, ...SCREENREADER_QUICK], true) };
    case 'widgets': return { keyboard: permissions(KEYBOARD_WIDGETS, [], true), screenreader: permissions([], SCREENREADER_BASIC, true) };
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;
const samePermissions = (a: Permissions, b: Permissions) => sameSet(a.keys, b.keys) && sameSet(a.intents, b.intents) && a.typeText === b.typeText && a.replaceText === b.replaceText && !a.inputKeys;

/** The starting set an action set still equals, if any. */
export function matchingPreset(actionSet: Pick<ActionSet, 'keyboard' | 'screenreader'>): ActionSetPreset | undefined {
  return ACTION_SET_PRESETS.find(preset => {
    const p = presetPermissions(preset);
    return samePermissions(actionSet.keyboard, p.keyboard) && samePermissions(actionSet.screenreader, p.screenreader);
  });
}
