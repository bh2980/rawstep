import { createHash } from 'node:crypto';
import type { DecisionPolicy, Decision } from '@rawstep/core/contracts';
import { speechChoices } from '@rawstep/policies/systemone';
import { chooseCandidate, createLlmModel, type LlmModel } from '@rawstep/policies/llm';
import type { ScreenshotModelAdapter, ScreenshotModelRequest } from '@rawstep/policies/screenshot/model';
import type { Connection, Model, Prompt } from '../shared/config.js';

export class LlmChoiceClient {
  private readonly llm: LlmModel;
  constructor(readonly connection: Connection, readonly model: Model, readonly prompt: Prompt, apiKey?: string, fetcher?: typeof fetch) {
    this.llm = createLlmModel({ baseURL: connection.baseURL, modelId: model.modelId, apiKey, timeoutMs: connection.timeoutMs, name: 'rawstep-choice', fetch: fetcher });
  }
  async choose(state: unknown, choices: readonly { id: string; label: string }[], images: readonly string[], signal: AbortSignal) {
    signal.throwIfAborted();
    try {
      const { choiceId } = await chooseCandidate({ model: this.llm, system: this.prompt.instructions, state, candidates: choices, images, signal });
      return { choiceId, model: { id: this.model.modelId, requestedId: this.model.modelId, runtime: 'openai-compatible-generative-choice' },
        prompt: { id: this.prompt.id, version: this.prompt.version, sha256: createHash('sha256').update(JSON.stringify({ instructions: this.prompt.instructions, choices })).digest('hex') } };
    } catch {
      signal.throwIfAborted();
      throw new Error('LLM 선택 실패: 연결·응답 형식·후보 ID·모델 ID를 확인하세요. Provider 원문은 표시하지 않습니다.');
    }
  }
}
export class LlmSpeechPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  constructor(private readonly client: LlmChoiceClient, private readonly historyLimit: number, private readonly options: { modelGiveUp?: boolean } = {}) {}
  takeDecisionEvidence() { return this.evidence.splice(0); }
  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    if (input.observation.kind !== 'screenreader') throw new Error('Speech-only policy required');
    const choices = speechChoices(input.allowedActions, this.options);
    const started = performance.now();
    const response = await this.client.choose({
      goal: input.goal, speech: input.observation.speech,
      history: input.history.slice(-this.historyLimit).map(h => ({ step: h.step, decision: h.decision, ...(h.observation.kind === 'screenreader' ? { speech: h.observation.speech } : {}) })),
    }, choices.map(({ id, label }) => ({ id, label })), [], input.signal);
    this.evidence.push({ kind: 'model-inference', ...response, elapsedMs: performance.now() - started, noDomOrAxContext: true, observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only', choices: choices.map(({ id, label }) => ({ id, label })) });
    const decision = structuredClone(choices.find(c => c.id === response.choiceId)!.decision);
    return 'stop' in decision ? { ...decision, stopSource: 'model' } : decision;
  }
}
export class LlmScreenshotAdapter implements ScreenshotModelAdapter {
  constructor(private readonly client: LlmChoiceClient) {}
  choose(request: ScreenshotModelRequest, { signal }: { signal: AbortSignal }) {
    return this.client.choose({ goal: request.goal, purpose: request.purpose, viewport: request.screenshot.viewport, history: request.history, visualState: request.visualState },
      request.choices.map(({ id, label }) => ({ id, label })),
      [request.screenshot.pngBase64, ...(request.previousScreenshot ? [request.previousScreenshot.pngBase64] : [])], signal);
  }
}
