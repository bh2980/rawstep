import type { TaskBrowser } from '@rawstep/core/contracts';

/**
 * Which browser a task opens, as a person picks it: a new one Rawstep starts, a Chrome they started themselves, or that Chrome with
 * a copy of its sign-in. (`copySignIn` is a `connect` task with `copySignIn` set; it is its own choice because it is its own sentence.)
 */
export type BrowserMode = 'launch' | 'connect' | 'copySignIn';
export const BROWSER_MODES: readonly BrowserMode[] = ['launch', 'connect', 'copySignIn'];
/** The browser choice of a task: the mode, and whether a person passes bot checks in a visible window. */
export type BrowserChoice = { mode: BrowserMode; personCheck: boolean };
export const DEFAULT_BROWSER: BrowserChoice = { mode: 'launch', personCheck: false };

/** The choice written in a task's JSON (`browser`); a task without the field launches a browser. Anything unreadable counts as the default. */
export function browserChoiceOf(task: unknown): BrowserChoice {
  const browser = task && typeof task === 'object' ? (task as { browser?: unknown }).browser : undefined;
  if (!browser || typeof browser !== 'object') return DEFAULT_BROWSER;
  const { mode, copySignIn, personCheck } = browser as { mode?: unknown; copySignIn?: unknown; personCheck?: unknown };
  return { mode: mode === 'connect' ? (copySignIn === true ? 'copySignIn' : 'connect') : 'launch', personCheck: personCheck === true };
}

/** The `browser` field to write for a choice; nothing for the default (a launched browser, no person check), so the file stays as short as it was. */
export function browserField(choice: BrowserChoice): TaskBrowser | undefined {
  if (choice.mode === 'launch' && !choice.personCheck) return undefined;
  return { mode: choice.mode === 'launch' ? 'launch' : 'connect', ...(choice.mode === 'copySignIn' ? { copySignIn: true } : {}), ...(choice.personCheck ? { personCheck: true } : {}) };
}

/** Whether the choice needs the address of a Chrome the person started (`machine.browserEndpoint`). */
export const needsEndpoint = (choice: BrowserChoice): boolean => choice.mode !== 'launch';
