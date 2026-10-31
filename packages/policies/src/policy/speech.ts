import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { inputLabel, type AllowedActions, type Decision, type DecisionPolicy, type HistoryEntry, type InputDescriptor, type Observation } from '@rawstep/core/contracts';

/**
 * What each screen reader intent does, in plain words, as the planner reads the actions it may plan with. The item the cursor is
 * on goes in `currentItem`, never in a label.
 */
const INTENT_LABELS: Record<string, string> = {
  next: 'Move to the next item', previous: 'Move to the previous item',
  'heading.next': 'Jump to the next heading', 'heading.previous': 'Jump to the previous heading', 'form.next': 'Jump to the next form control',
  'form.previous': 'Jump to the previous form control', 'link.next': 'Jump to the next link', 'link.previous': 'Jump to the previous link',
  readCurrent: 'Read the current item again', readFocused: 'Read the focused element', 'headings.list': "List the page's headings", 'links.list': "List the page's links",
  'formControls.rotor': "Open the rotor's list of form controls, buttons included (it says \"Form controls\" and the first item). While it is open, next and previous move through the list, and activate moves the cursor to that item without pressing it",
};
const intentLabel = (intent: string) => intent === 'activate' ? 'Activate the current item' : INTENT_LABELS[intent] ?? `Screen reader intent: ${intent}`;
/**
 * The item the screen reader cursor is on, as last spoken: the last line of the latest speech that said anything (an activation
 * can say nothing). A screen reader user knows what they are on; the label for activating names it.
 */
export function currentItem(observation: Observation, history: readonly HistoryEntry[]): string | undefined {
  for (const o of [observation, ...history.map(entry => entry.observation).reverse()]) {
    const line = [...o.speech].reverse().find(text => text.trim());
    if (line) return line.trim();
  }
  return undefined;
}
/** `currentItem` for a model's state, when anything has been spoken. */
export const currentItemState = (input: { observation: Observation; history: readonly HistoryEntry[] }): { currentItem?: string } => {
  const item = currentItem(input.observation, input.history);
  return item ? { currentItem: item.slice(0, 300) } : {};
};
/** The actions a profile allows, as the planner reads them and Rawstep carries them out. */
export function speechChoices(allowed: AllowedActions, inputs: Readonly<Record<string, InputDescriptor>> = {}): { id: string; label: string; decision: Extract<Decision, { action: unknown }> }[] {
  return [
    ...allowed.intents.map(intent => ({ id: `intent:${intent}`, label: intentLabel(intent), decision: { action: { kind: 'intent' as const, intent } } })),
    ...allowed.keys.map(key => ({ id: `key:${key}`, label: `Press key: ${key}`, decision: { action: { kind: 'key' as const, key } } })),
    ...allowed.inputKeys.flatMap(input => [
      ...(allowed.typeText !== false ? [{ id: `type:${input}`, label: `Type ${inputLabel(input, inputs[input])} into the focused editable field`, decision: { action: { kind: 'typeText' as const, input } } }] : []),
      ...(allowed.replaceText ? [{ id: `replace:${input}`, label: `Replace the focused field with ${inputLabel(input, inputs[input])}`, decision: { action: { kind: 'replaceText' as const, input } } }] : []),
    ]),
  ];
}
/** Rawstep's repetition guard for screen reader runs. */
export type SpeechGuard = {
  /** On: stop as stuck when the same action keeps producing the same speech. */
  repetitionGuard?: boolean;
  /** How many times in a row (default 4). */
  maxUnchangedTransitions?: number;
};
/**
 * Whether the last `limit` decisions chose the same action and each left the reader saying the same thing — for example `next` at
 * the end of the page answering "End of content" every time.
 */
export function speechRepetition(history: readonly HistoryEntry[], current: Observation, limit: number): { action: string; speech: string; times: number } | undefined {
  if (history.length < limit) return undefined;
  const recent = history.slice(-limit), key = (d: Decision) => 'action' in d ? JSON.stringify(d.action) : undefined;
  const action = key(recent[0]!.decision);
  if (!action || recent.some(entry => key(entry.decision) !== action)) return undefined;
  // History holds the speech each decision was made on; the current observation is what the last one produced.
  const said = [...recent.slice(1).map(entry => entry.observation), current].map(o => o.speech.join('\n'));
  if (said.some(text => text !== said[0])) return undefined;
  return { action, speech: said[0]!, times: limit };
}
/** The guard's stop for a speech policy, with its evidence, or undefined when it does not apply. */
export function speechGuardStop(guard: SpeechGuard, input: Pick<Parameters<DecisionPolicy['decide']>[0], 'history' | 'observation'>): { decision: Decision; evidence: unknown } | undefined {
  if (!guard.repetitionGuard) return undefined;
  const limit = guard.maxUnchangedTransitions ?? RAWSTEP_DEFAULTS.policy.maxUnchangedTransitions;
  const repeated = speechRepetition(input.history, input.observation, limit);
  if (!repeated) return undefined;
  return { decision: { stop: 'stuck', stopSource: 'exploration-guard' },
    evidence: { kind: 'repetition-guard', observationSource: 'speech', repeated, limit, uncertainty: 'The same action produced the same speech; this ends exploration, it does not establish an accessibility defect.' } };
}

export type SpeechPolicyOptions = SpeechGuard;
