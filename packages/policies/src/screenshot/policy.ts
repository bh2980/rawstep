import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { createHash } from 'node:crypto';
import { inputLabel, type AllowedActions, type Decision, type DecisionPolicy, type InputDescriptor, type ScreenshotObservation } from '@rawstep/core/contracts';
import { SCREENSHOT_KEYS } from '@rawstep/core/screenshot';
import { SCREENSHOT_MODEL_PROTOCOL, validateModelResponse, type ScreenshotChoice, type ScreenshotModelAdapter, type ScreenshotModelRequest, type ScreenshotModelResponse } from './model.js';

export function screenshotHash(screenshot: ScreenshotObservation): string {
  const bytes = Buffer.from(screenshot.pngBase64, 'base64');
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || !Number.isInteger(screenshot.viewport.w) || screenshot.viewport.w < 1 || !Number.isInteger(screenshot.viewport.h) || screenshot.viewport.h < 1) throw new Error('Expected PNG screenshot pixels and positive viewport dimensions.');
  return createHash('sha256').update(bytes).digest('hex');
}
export function screenshotChoices(allowed: AllowedActions, options: { modelGiveUp?: boolean } = {}, inputs: Readonly<Record<string, InputDescriptor>> = {}): ScreenshotChoice[] {
  const choices: ScreenshotChoice[] = [];
  for (const key of allowed.keys) {
    if (!(SCREENSHOT_KEYS as readonly string[]).includes(key)) throw new Error(`Screenshot policy cannot use key ${key}.`);
    choices.push({ id: `key:${key}`, label: key === 'Tab' ? 'Tab: move keyboard focus forward' : key === 'Shift+Tab' ? 'Shift+Tab: move keyboard focus backward' : key === 'Enter' ? 'Enter: activate the currently focused control' : key === 'Space' ? 'Space: activate or toggle the currently focused control' : `${key}: press this keyboard key`, decision: { action: { kind: 'key', key } } });
  }
  for (const input of allowed.inputKeys) {
    if (allowed.typeText !== false) choices.push({ id: `type:${input}`, label: `Type ${inputLabel(input, inputs[input])} into the currently focused editable field`, decision: { action: { kind: 'typeText', input } } });
    if (allowed.replaceText) choices.push({ id: `replace:${input}`, label: `Replace the currently focused editable field with ${inputLabel(input, inputs[input])}`, decision: { action: { kind: 'replaceText', input } } });
  }
  choices.push({ id: 'stop:success', label: 'Stop: the visible goal appears complete (independent verifier will check)', decision: { stop: 'success' } });
  if (options.modelGiveUp === true) choices.push({ id: 'stop:uncertain', label: 'Stop: uncertain whether further keyboard actions are appropriate or whether the goal is complete', decision: { stop: 'uncertain' } },
    { id: 'stop:stuck', label: 'Stop: unable to progress with the available keyboard actions', decision: { stop: 'stuck' } });
  return choices;
}
export const FOCUS_CONTEXT_CHOICES: readonly ScreenshotChoice[] = Object.freeze([
  { id: 'focus:editable-target', label: 'A visibly focused editable field is the appropriate target for this goal', decision: { stop: 'uncertain' } },
  { id: 'focus:activation-target', label: 'A visibly focused button, link, or toggle is the appropriate activation target for this goal', decision: { stop: 'uncertain' } },
  { id: 'focus:other', label: 'A focus indicator is visible on another control, not an appropriate goal target', decision: { stop: 'uncertain' } },
  { id: 'focus:none', label: 'No keyboard focus indicator is visible in the screenshot', decision: { stop: 'uncertain' } },
  { id: 'focus:uncertain', label: 'The visual evidence is insufficient to identify appropriate keyboard focus', decision: { stop: 'uncertain' } },
]);
export type FocusGateOptions = { minimumProbability?: number; minimumMargin?: number };
/** Uncalibrated visual scores only restrict actions. They are never browser focus truth. */
export function restrictChoicesByVisualFocus(choices: readonly ScreenshotChoice[], response: ScreenshotModelResponse, options: FocusGateOptions = {}): ScreenshotChoice[] {
  validateModelResponse(response, FOCUS_CONTEXT_CHOICES);
  const minimumProbability = options.minimumProbability ?? RAWSTEP_DEFAULTS.focusGate.minimumProbability, minimumMargin = options.minimumMargin ?? RAWSTEP_DEFAULTS.focusGate.minimumMargin;
  for (const v of [minimumProbability, minimumMargin]) if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('Focus thresholds must be finite numbers from 0 to 1.');
  const index = FOCUS_CONTEXT_CHOICES.findIndex(c => c.id === response.choiceId), scores = response.probabilities;
  const confident = !!scores && scores[index]! >= minimumProbability && scores[index]! - Math.max(...scores.filter((_, i) => i !== index)) >= minimumMargin;
  const editable = confident && response.choiceId === 'focus:editable-target';
  const activation = confident && response.choiceId === 'focus:activation-target';
  return choices.filter(c => {
    if ('stop' in c.decision) return true;
    const a = c.decision.action;
    if (a.kind === 'typeText' || a.kind === 'replaceText') return editable;
    if (a.kind !== 'key') return false;
    if (a.key === 'Enter') return editable || activation;
    if (a.key === 'Space') return activation;
    if (['Backspace', 'Delete'].includes(a.key)) return editable;
    return true;
  }).map(c => structuredClone(c));
}
export type ScreenshotPolicyOptions = {
  model: ScreenshotModelAdapter;
  /** Opt-in: a separate visual focus comparison narrows choices before the action call. */
  focusGate?: FocusGateOptions;
  /** Identical pixels are a conservative loop signal, never proof of a keyboard trap. */
  maxStateVisits?: number;
  maxUnchangedTransitions?: number;
  historyLimit?: number;
  /** Default true. False never stops on repetition; visualState is still computed and reported. */
  repetitionGuard?: boolean;
  /** Default false: only stop:success is offered. True adds the model's stop:stuck and stop:uncertain choices. */
  modelGiveUp?: boolean;
};

/** The model chooses every executed action. Deterministic guards only stop; never substitute actions. */
export class ScreenshotDecisionPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  private readonly options: Required<Omit<ScreenshotPolicyOptions, 'model' | 'focusGate'>> & Pick<ScreenshotPolicyOptions, 'model' | 'focusGate'>;
  constructor(options: ScreenshotPolicyOptions) {
    this.options = { ...RAWSTEP_DEFAULTS.policy, ...options, repetitionGuard: options.repetitionGuard ?? true, modelGiveUp: options.modelGiveUp ?? false };
    for (const key of ['maxStateVisits', 'maxUnchangedTransitions', 'historyLimit'] as const) {
      if (!Number.isSafeInteger(this.options[key]) || this.options[key] < 1 || this.options[key] > 10_000) throw new Error(`${key} must be an integer from 1 to 10000.`);
    }
    if (options.focusGate) restrictChoicesByVisualFocus([], { choiceId: 'focus:uncertain', model: { id: 'validation', runtime: 'validation' } }, options.focusGate);
    if (!options.model || typeof options.model.choose !== 'function') throw new Error('A screenshot model adapter is required.');
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    this.evidence = [];
    input.signal.throwIfAborted();
    if (input.observation.kind !== 'keyboard') throw new Error('Screenshot policy requires keyboard screenshot observations.');
    const sha256 = screenshotHash(input.observation.screenshot);
    const hashes = input.history.map(entry => entry.observation.kind === 'keyboard' ? screenshotHash(entry.observation.screenshot) : undefined);
    const visits = hashes.filter(hash => hash === sha256).length + 1;
    let unchangedTransitions = 0;
    for (let i = hashes.length - 1; i >= 0 && hashes[i] === sha256; i--) unchangedTransitions++;
    const limits = { maxStateVisits: this.options.maxStateVisits, maxUnchangedTransitions: this.options.maxUnchangedTransitions, historyLimit: this.options.historyLimit };
    if (this.options.repetitionGuard && (visits > limits.maxStateVisits || unchangedTransitions >= limits.maxUnchangedTransitions)) {
      this.evidence.push({ kind: 'exploration-limit', sha256, visits, unchangedTransitions, limits, modelCalled: false,
        uncertainty: 'Repeated pixels may reflect an invisible focus change, a trap, or a legitimate unchanged state. No accessibility defect is established.' });
      return { stop: 'stuck', stopSource: 'exploration-guard', rationale: 'Conservative visual repetition limit reached.' };
    }
    let choices = screenshotChoices(input.allowedActions, { modelGiveUp: this.options.modelGiveUp }, input.inputs);
    // Construct a fresh allowlisted request: never forward arbitrary input/observation/history objects.
    const pixels = (s: ScreenshotObservation): ScreenshotObservation => ({ pngBase64: s.pngBase64, viewport: { w: s.viewport.w, h: s.viewport.h } });
    const decisionOnly = (decision: Decision): Decision => {
      if ('stop' in decision) return { stop: decision.stop };
      const action = decision.action;
      if (action.kind === 'key') return { action: { kind: 'key', key: action.key } };
      if (action.kind === 'typeText' || action.kind === 'replaceText') return { action: { kind: action.kind, input: action.input } };
      throw new Error('Screenshot history cannot contain screen-reader intents.');
    };
    if (input.observation.previousScreenshot) screenshotHash(input.observation.previousScreenshot);
    const request: ScreenshotModelRequest = { protocol: SCREENSHOT_MODEL_PROTOCOL, goal: input.goal,
      screenshot: pixels(input.observation.screenshot), ...(input.observation.previousScreenshot ? { previousScreenshot: pixels(input.observation.previousScreenshot) } : {}),
      choices: structuredClone(choices), history: input.history.slice(-limits.historyLimit).map(entry => ({ step: entry.step, decision: decisionOnly(entry.decision) })),
      visualState: { sha256, visits, unchangedTransitions } };
    if (this.options.focusGate) {
      const gateStartedAt = new Date().toISOString(), gateStarted = performance.now();
      const focus = await this.options.model.choose({ ...structuredClone(request), purpose: 'focus-context', choices: structuredClone([...FOCUS_CONTEXT_CHOICES]) }, { signal: input.signal });
      input.signal.throwIfAborted();
      const originalChoices = choices;
      choices = restrictChoicesByVisualFocus(choices, focus, this.options.focusGate);
      request.choices = structuredClone(choices);
      this.evidence.push({ kind: 'visual-focus-gate', startedAt: gateStartedAt, elapsedMs: performance.now() - gateStarted,
        ...(focus.prompt ? { prompt: { ...focus.prompt } } : {}),
        model: { id: focus.model.id, runtime: focus.model.runtime, ...(focus.model.requestedId ? { requestedId: focus.model.requestedId } : {}), ...(focus.model.revision ? { revision: focus.model.revision } : {}) },
        choiceId: focus.choiceId, probabilities: focus.probabilities ? [...focus.probabilities] : undefined,
        screenshotSha256: sha256, thresholds: { minimumProbability: this.options.focusGate.minimumProbability ?? RAWSTEP_DEFAULTS.focusGate.minimumProbability, minimumMargin: this.options.focusGate.minimumMargin ?? RAWSTEP_DEFAULTS.focusGate.minimumMargin },
        permittedChoiceIds: choices.map(c => c.id), blockedChoiceIds: originalChoices.filter(c => !choices.some(x => x.id === c.id)).map(c => c.id),
        observationSource: 'viewport-png-only', noDomOrAxContext: true,
        uncertainty: 'Model focus prediction is uncalibrated; it can be wrong. This is not native focus truth or accessibility certification.' });
    }
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const response = await this.options.model.choose(request, { signal: input.signal });
    input.signal.throwIfAborted();
    validateModelResponse(response, choices);
    this.evidence.push({ kind: 'model-inference', model: { id: response.model.id, runtime: response.model.runtime, ...(response.model.requestedId ? { requestedId: response.model.requestedId } : {}), ...(response.model.revision ? { revision: response.model.revision } : {}) },
      ...(response.prompt ? { prompt: { ...response.prompt } } : {}),
      startedAt, endedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      ...(response.inferenceMs !== undefined ? { inferenceMs: response.inferenceMs } : {}),
      screenshotSha256: sha256, previousScreenshotSha256: input.observation.previousScreenshot ? screenshotHash(input.observation.previousScreenshot) : undefined,
      observationSource: 'viewport-png-only', noDomOrAxContext: true, choices, choiceId: response.choiceId,
      ...(response.probabilities ? { probabilities: [...response.probabilities] } : {}), visualState: request.visualState, limits, earlyStop: { repetitionGuard: this.options.repetitionGuard, modelGiveUp: this.options.modelGiveUp },
      focusAssessment: response.focusAssessment ?? { visibility: 'uncertain', note: 'No model focus assessment was supplied; inspect the saved pixels.' },
      uncertainty: 'Model probabilities and visual focus judgments are uncalibrated observations, not accessibility certification.' });
    const decision = structuredClone(choices.find(choice => choice.id === response.choiceId)!.decision);
    return 'stop' in decision ? { ...decision, stopSource: 'model' } : decision;
  }
}
