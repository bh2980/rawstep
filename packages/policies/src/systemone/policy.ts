import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { AllowedActions, Decision, DecisionPolicy } from '@rawstep/core/contracts';
import { assertSystemOneInputs, validateSystemOneResult, type SystemOneClient, type SystemOneRequest } from './client.js';
import type { ScreenshotModelAdapter, ScreenshotModelRequest, ScreenshotModelResponse } from '../screenshot/model.js';
import { copySystemOnePrompt, systemOnePromptEvidence, SPEECH_DECISION_PROMPT, SCREENSHOT_DECISION_PROMPT, type SystemOnePrompt } from './prompts.js';

function actionOnly(decision: Decision): Decision {
  if ('stop' in decision) return { stop: decision.stop };
  const a = decision.action;
  return { action: a.kind === 'key' ? { kind: a.kind, key: a.key } : a.kind === 'intent' ? { kind: a.kind, intent: a.intent } : { kind: a.kind, input: a.input } };
}
export function speechChoices(allowed: AllowedActions, options: { modelGiveUp?: boolean } = {}): { id: string; label: string; decision: Decision }[] {
  return [
    ...allowed.intents.map(intent => ({ id: `intent:${intent}`, label: `Screen reader intent: ${intent}`, decision: { action: { kind: 'intent' as const, intent } } })),
    ...allowed.keys.map(key => ({ id: `key:${key}`, label: `Press key: ${key}`, decision: { action: { kind: 'key' as const, key } } })),
    ...allowed.inputKeys.flatMap(input => [
      ...(allowed.typeText !== false ? [{ id: `type:${input}`, label: `Type the named input ${input} into the focused editable field`, decision: { action: { kind: 'typeText' as const, input } } }] : []),
      ...(allowed.replaceText ? [{ id: `replace:${input}`, label: `Replace the focused field with the named input ${input}`, decision: { action: { kind: 'replaceText' as const, input } } }] : []),
    ]),
    ...(options.modelGiveUp === false ? ['success'] as const : ['success', 'stuck', 'uncertain'] as const).map(stop => ({ id: `stop:${stop}`, label: stop === 'success' ? 'Stop: goal appears complete; an independent verifier must confirm' : `Stop: ${stop}`, decision: { stop } })),
  ];
}
export class SystemOneSpeechPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  private readonly prompt: SystemOnePrompt;
  constructor(readonly client: SystemOneClient, private readonly historyLimit: number = RAWSTEP_DEFAULTS.policy.historyLimit, prompt: SystemOnePrompt = SPEECH_DECISION_PROMPT, private readonly options: { modelGiveUp?: boolean } = {}) {
    assertSystemOneInputs(client, ['text']);
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 10_000) throw new Error('Invalid SystemOne history limit.');
    this.prompt = copySystemOnePrompt(prompt);
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
    if (input.observation.kind !== 'screenreader') throw new Error('SystemOne speech policy requires screen reader observations.');
    const choices = speechChoices(input.allowedActions, this.options);
    const request: SystemOneRequest = {
      state: { goal: input.goal, speech: [...input.observation.speech],
        history: input.history.slice(-this.historyLimit).map(h => ({ step: h.step, decision: actionOnly(h.decision),
          ...(h.observation.kind === 'screenreader' ? { speech: [...h.observation.speech] } : {}) })) },
      instructions: this.prompt.instructions,
      choices: choices.map(({ id, label }) => ({ id, label })),
    };
    const started = performance.now();
    const response = await this.client.evaluate(request, { signal: input.signal });
    input.signal.throwIfAborted(); validateSystemOneResult(response, choices);
    this.evidence.push({ kind: 'model-inference', model: response.model, elapsedMs: performance.now() - started,
      prompt: systemOnePromptEvidence(this.prompt, request.choices),
      observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only',
      choices: request.choices, choiceId: response.choiceId, probabilities: response.probabilities,
      noDomOrAxContext: true, uncertainty: 'Model probabilities are not measured accuracy or accessibility certification.' });
    const decision = structuredClone(choices.find(c => c.id === response.choiceId)!.decision);
    return 'stop' in decision ? { ...decision, stopSource: 'model' } : decision;
  }
}

/** Bridge, not a second visual policy: existing focus gates/repetition/replay remain authoritative. */
export class SystemOneScreenshotAdapter implements ScreenshotModelAdapter {
  private readonly prompt: SystemOnePrompt;
  constructor(readonly client: SystemOneClient, prompt: SystemOnePrompt = SCREENSHOT_DECISION_PROMPT) {
    assertSystemOneInputs(client, ['text', 'image'], 1, 2);
    this.prompt = copySystemOnePrompt(prompt);
  }
  async choose(request: ScreenshotModelRequest, { signal }: { signal: AbortSignal }): Promise<ScreenshotModelResponse> {
    const result = await this.client.evaluate({
      state: { goal: request.goal, purpose: request.purpose ?? 'action', viewport: { ...request.screenshot.viewport },
        history: request.history.map(h => ({ step: h.step, decision: actionOnly(h.decision) })),
        visualState: { sha256: request.visualState.sha256, visits: request.visualState.visits, unchangedTransitions: request.visualState.unchangedTransitions },
        imageOrder: request.previousScreenshot ? ['current', 'previous'] : ['current'] },
      instructions: this.prompt.instructions,
      choices: request.choices.map(c => ({ id: c.id, label: c.label })),
      images: [request.screenshot, ...(request.previousScreenshot ? [request.previousScreenshot] : [])].map(s => ({ pngBase64: s.pngBase64 })),
    }, { signal });
    signal.throwIfAborted(); validateSystemOneResult(result, request.choices);
    return { choiceId: result.choiceId, probabilities: result.probabilities, model: result.model,
      prompt: systemOnePromptEvidence(this.prompt, request.choices.map(c => ({ id: c.id, label: c.label }))) };
  }
}
