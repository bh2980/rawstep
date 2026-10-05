import type { BackendAction, BackendCapabilities } from '@rawstep/core/contracts';
import { OrcaBridgeError } from './transport.js';

/** X11 keysyms, not WebDriver private-use key codes. */
const keys: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Tab: ['Tab'], Enter: ['Return'], Escape: ['Escape'], Space: ['space'],
  Backspace: ['BackSpace'], Delete: ['Delete'], ArrowLeft: ['Left'],
  ArrowRight: ['Right'], ArrowUp: ['Up'], ArrowDown: ['Down'],
  Home: ['Home'], End: ['End'], PageUp: ['Page_Up'], PageDown: ['Page_Down'],
  'Shift+Tab': ['Shift_L', 'Tab'], 'Shift+Enter': ['Shift_L', 'Return'],
  'Mod+A': ['Control_L', 'a'],
});
const intents: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: ['Down'], previous: ['Up'], activate: ['Return'],
  'heading.next': ['h'], 'heading.previous': ['Shift_L', 'h'],
  'form.next': ['f'],
});
const punctuation: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'space', '-': 'minus', '=': 'equal', '[': 'bracketleft', ']': 'bracketright',
  '\\': 'backslash', ';': 'semicolon', "'": 'apostrophe', ',': 'comma',
  '.': 'period', '/': 'slash', '`': 'grave',
});
const shifted: Readonly<Record<string, string>> = Object.freeze({
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8',
  '(': '9', ')': '0', '_': 'minus', '+': 'equal', '{': 'bracketleft', '}': 'bracketright',
  '|': 'backslash', ':': 'semicolon', '"': 'apostrophe', '<': 'comma', '>': 'period',
  '?': 'slash', '~': 'grave',
});

export const orcaCapabilities: BackendCapabilities = Object.freeze({
  intents: Object.freeze(Object.keys(intents)), keys: Object.freeze(Object.keys(keys)),
  textEntry: true, replaceText: true,
});
export const orcaAssumptions = Object.freeze([
  'Linux X11 session, US keyboard layout and default Orca bindings',
  'next/previous are caret/line navigation, not VoiceOver object navigation',
  'Structural navigation requires Orca browse mode; form fields may switch to focus mode',
  'No interact/stopInteracting mapping: toggling focus mode is not an idempotent semantic action',
  'Text entry supports printable ASCII only, through native keyboard events; no clipboard or DOM fallback',
  'Speech is text submitted by Orca to its speech pipeline, not an audio recording or proof of audible completion',
]);

/** Validate the entire action before any native keypress, including destructive replacement. */
export function mapOrcaAction(action: BackendAction): string[][] {
  if (action.kind === 'intent' || action.kind === 'key') {
    const value = action.kind === 'intent' ? action.intent : action.key;
    const mapping = action.kind === 'intent' ? intents : keys;
    if (!Object.hasOwn(mapping, value)) throw new OrcaBridgeError(`Unsupported Orca ${action.kind}: ${value}`, 'unsupported action');
    return [[...mapping[value]!]];
  }
  if (action.kind !== 'typeText' && action.kind !== 'replaceText') throw new OrcaBridgeError('Unknown Orca action', 'unsupported action');
  if (typeof action.text !== 'string') throw new OrcaBridgeError('Text must be a string', 'unsupported action');
  const presses = Array.from(action.text, character => {
    if (/^[a-z0-9]$/.test(character)) return [character];
    if (/^[A-Z]$/.test(character)) return ['Shift_L', character.toLowerCase()];
    if (Object.hasOwn(punctuation, character)) return [punctuation[character]!];
    if (Object.hasOwn(shifted, character)) return ['Shift_L', shifted[character]!];
    throw new OrcaBridgeError(`Orca text entry requires printable ASCII (unsupported U+${character.codePointAt(0)!.toString(16).toUpperCase()})`, 'unsupported action');
  });
  return action.kind === 'replaceText' ? [['Control_L', 'a'], ['BackSpace'], ...presses] : presses;
}
