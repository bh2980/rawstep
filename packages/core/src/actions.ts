/**
 * The names of the actions Rawstep's own backends offer, and what kind of thing each one is. The one list: the backends take their
 * intent names from here, and the planner's labels, the runner, the hints and the dashboard ask here whether an action moved the
 * cursor, pressed something or read a list. A custom backend may offer other intents; they are then none of these kinds.
 * Pure and free of Node APIs, so a browser page can use it too.
 */

/**
 * The named keys every built-in backend presses, the simulation and the real screen readers alike: a profile that allows a key
 * means the same thing whichever of them runs it. `Mod+A` is select-all (Command on macOS, Control elsewhere).
 */
export const BACKEND_KEYS = ['Tab', 'Shift+Tab', 'Enter', 'Shift+Enter', 'Space', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Mod+A'] as const;
export type BackendKey = typeof BACKEND_KEYS[number];
/** Keys that move focus or the caret and press nothing. */
export const NAVIGATION_KEYS = ['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'] as const;
/** Keys that press the focused control. */
export const ACTIVATION_KEYS = ['Enter', 'Space'] as const;
/** Presses what the screen reader cursor is on. */
export const ACTIVATE_INTENT = 'activate';
/** Intents that move the screen reader cursor, item by item or to the next of a kind, with the way each one goes. */
export const MOVE_INTENTS = Object.freeze({
  next: 1, previous: -1,
  'heading.next': 1, 'heading.previous': -1, 'form.next': 1, 'form.previous': -1, 'link.next': 1, 'link.previous': -1,
} as const);
/**
 * Intents a task makes once: a list that is read out and closes says the same thing again, and a rotor list that is opened again
 * starts over.
 */
export const LIST_INTENTS = ['headings.list', 'links.list', 'formControls.rotor'] as const;
/** Intents that say where the cursor or focus is again, moving nothing. */
export const READ_INTENTS = ['readCurrent', 'readFocused'] as const;
/** Intents that go into or come out of a group (VoiceOver's interact). */
export const GROUP_INTENTS = ['interact', 'stopInteracting'] as const;
export type MoveIntent = keyof typeof MOVE_INTENTS;
/** Every intent a built-in backend offers. */
export type KnownIntent = MoveIntent | typeof ACTIVATE_INTENT | typeof LIST_INTENTS[number] | typeof READ_INTENTS[number] | typeof GROUP_INTENTS[number];
export const KNOWN_INTENTS: readonly KnownIntent[] = Object.freeze([
  ...Object.keys(MOVE_INTENTS) as MoveIntent[], ACTIVATE_INTENT, ...LIST_INTENTS, ...READ_INTENTS, ...GROUP_INTENTS,
]);

/** An action as a decision, a trace or a step view holds it: only its key or intent matters here. */
export type NamedAction = { kind?: string | undefined; key?: string | undefined; intent?: string | undefined };
const FORWARD_KEYS: readonly string[] = ['Tab', 'ArrowDown', 'ArrowRight'], BACKWARD_KEYS: readonly string[] = ['Shift+Tab', 'ArrowUp', 'ArrowLeft'];

/** The action pressed something: Enter, Space or the activate intent. */
export function isActivation(action: NamedAction): boolean {
  return action.intent === ACTIVATE_INTENT || (action.key !== undefined && (ACTIVATION_KEYS as readonly string[]).includes(action.key));
}
/** The action only moved: a navigation key, or an intent that moves the cursor (quick navigation to the next heading included). */
export function isNavigation(action: NamedAction): boolean {
  return (action.key !== undefined && (NAVIGATION_KEYS as readonly string[]).includes(action.key)) || (action.intent !== undefined && Object.hasOwn(MOVE_INTENTS, action.intent));
}
/** Which way a move went: 1 forward, -1 backward, 0 for anything that has no direction (Home, End, a press). */
export function moveDirection(action: NamedAction): 1 | -1 | 0 {
  if (action.intent !== undefined && Object.hasOwn(MOVE_INTENTS, action.intent)) return MOVE_INTENTS[action.intent as MoveIntent];
  if (action.key === undefined) return 0;
  return FORWARD_KEYS.includes(action.key) ? 1 : BACKWARD_KEYS.includes(action.key) ? -1 : 0;
}
