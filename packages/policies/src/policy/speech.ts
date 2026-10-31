import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { inputLabel, type AllowedActions, type Decision, type DecisionPolicy, type HistoryEntry, type InputDescriptor, type Observation } from '@rawstep/core/contracts';
import type { ChoiceModel } from './choice.js';
import { modelHistory } from './history.js';

/**
 * What each screen reader intent does, in plain words. The item the cursor is on goes in the state (`currentItem`), never in a label:
 * an offline comparison (plan doc §12) found that without it the executor rarely pressed the item it was told to press, and with
 * the item's words in the activation label it pressed links whose words resembled the goal far more often.
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
    if (o.kind !== 'screenreader') continue;
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
export function speechChoices(allowed: AllowedActions, options: { modelGiveUp?: boolean } = {}, inputs: Readonly<Record<string, InputDescriptor>> = {}): { id: string; label: string; decision: Decision }[] {
  return [
    ...allowed.intents.map(intent => ({ id: `intent:${intent}`, label: intentLabel(intent), decision: { action: { kind: 'intent' as const, intent } } })),
    ...allowed.keys.map(key => ({ id: `key:${key}`, label: `Press key: ${key}`, decision: { action: { kind: 'key' as const, key } } })),
    ...allowed.inputKeys.flatMap(input => [
      ...(allowed.typeText !== false ? [{ id: `type:${input}`, label: `Type ${inputLabel(input, inputs[input])} into the focused editable field`, decision: { action: { kind: 'typeText' as const, input } } }] : []),
      ...(allowed.replaceText ? [{ id: `replace:${input}`, label: `Replace the focused field with ${inputLabel(input, inputs[input])}`, decision: { action: { kind: 'replaceText' as const, input } } }] : []),
    ]),
    ...(options.modelGiveUp === true ? ['success', 'stuck', 'uncertain'] as const : ['success'] as const).map(stop => ({ id: `stop:${stop}`, label: stop === 'success' ? 'Stop: goal appears complete; an independent verifier must confirm' : `Stop: ${stop}`, decision: { stop } })),
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
 * the end of the page answering "End of content" every time. Speech is exact text, so unlike screenshots there is no animation noise.
 */
export function speechRepetition(history: readonly HistoryEntry[], current: Observation, limit: number): { action: string; speech: string; times: number } | undefined {
  if (current.kind !== 'screenreader' || history.length < limit) return undefined;
  const recent = history.slice(-limit), key = (d: Decision) => 'action' in d ? JSON.stringify(d.action) : undefined;
  const action = key(recent[0]!.decision);
  if (!action || recent.some(entry => key(entry.decision) !== action)) return undefined;
  // History holds the speech each decision was made on; the current observation is what the last one produced.
  const said = [...recent.slice(1).map(entry => entry.observation), current].map(o => o.kind === 'screenreader' ? o.speech.join('\n') : undefined);
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

export type SpeechPolicyOptions = SpeechGuard & {
  /** How many past steps the model sees (default 12). */
  historyLimit?: number;
  /** Default false: only stop:success is offered. True adds the model's stop:stuck and stop:uncertain choices. */
  modelGiveUp?: boolean;
};
/**
 * Screen reader decisions from speech only: each step the model reads the goal, what the reader just said and the recent
 * steps with their results, and picks one permitted action. The model may be a SystemOne decision model or an LLM.
 */
export class SpeechDecisionPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  private readonly historyLimit: number;
  constructor(readonly model: ChoiceModel, private readonly options: SpeechPolicyOptions = {}) {
    if (!model.inputs.includes('text')) throw new Error('A speech policy needs a model that takes text.');
    this.historyLimit = options.historyLimit ?? RAWSTEP_DEFAULTS.policy.historyLimit;
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 1 || this.historyLimit > 10_000) throw new Error('Invalid speech policy history limit.');
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
    if (input.observation.kind !== 'screenreader') throw new Error('The speech policy requires screen reader observations.');
    const guarded = speechGuardStop(this.options, input);
    if (guarded) { this.evidence.push(guarded.evidence); return guarded.decision; }
    const choices = speechChoices(input.allowedActions, this.options, input.inputs), candidates = choices.map(({ id, label }) => ({ id, label }));
    const started = performance.now();
    const response = await this.model.choose({
      state: { goal: input.goal, speech: [...input.observation.speech], ...currentItemState(input), history: modelHistory(input.history, input.observation, this.historyLimit) },
      choices: candidates,
    }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (!choices.some(c => c.id === response.choiceId)) throw new Error('The model selected an unknown choice.');
    this.evidence.push({ kind: 'model-inference', role: 'executor', model: response.model, ...(response.prompt ? { prompt: response.prompt } : {}), elapsedMs: performance.now() - started,
      observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only',
      choices: candidates, choiceId: response.choiceId, ...(response.probabilities ? { probabilities: response.probabilities } : {}),
      noDomOrAxContext: true, uncertainty: 'Model probabilities are not measured accuracy or accessibility certification.' });
    const decision = structuredClone(choices.find(c => c.id === response.choiceId)!.decision);
    return 'stop' in decision ? { ...decision, stopSource: 'model' } : decision;
  }
}
