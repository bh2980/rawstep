import { createHash } from 'node:crypto';
import type { DecisionPolicy, Decision } from '@rawstep/core/contracts';
import { speechChoices, speechGuardStop, type SpeechGuard } from '@rawstep/policies/systemone';
import { chooseCandidate, closeLlmModel, createAgentModel, createLlmModel, type LlmModel } from '@rawstep/policies/llm';
import { AcpAgent } from '@rawstep/policies/acp';
import type { ScreenshotModelAdapter, ScreenshotModelRequest } from '@rawstep/policies/screenshot/model';
import { agentOf, resolveBaseURL, type Model, type Prompt } from './config.js';

/** The model behind a connection: an OpenAI-compatible endpoint, or an agent CLI started on first use (close it with `closeLlmModel`). */
export function languageModelOf(model: Pick<Model, 'kind' | 'provider' | 'baseURL' | 'modelId' | 'timeoutMs'>, options: { apiKey?: string; name: string; fetch?: typeof fetch }): LlmModel {
  const agent = agentOf(model);
  if (agent) return createAgentModel({ agent: new AcpAgent(agent), modelId: model.modelId, timeoutMs: model.timeoutMs });
  return createLlmModel({ baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey: options.apiKey, timeoutMs: model.timeoutMs, name: options.name, fetch: options.fetch });
}

export class LlmChoiceClient {
  private readonly llm: LlmModel;
  constructor(readonly model: Model, readonly prompt: Prompt, apiKey?: string, fetcher?: typeof fetch) {
    this.llm = languageModelOf(model, { apiKey, name: 'rawstep-choice', fetch: fetcher });
  }
  /** Starts an agent CLI ahead of the first choice (its own time limit); a no-op for an endpoint. */
  async prepare(signal: AbortSignal): Promise<void> {
    if (!('agent' in this.llm)) return;
    try { await this.llm.agent.start(signal); }
    catch { signal.throwIfAborted(); throw new Error(`Could not start ${this.model.name}: check that the CLI is installed and logged in.`); }
  }
  /** Ends an agent CLI the client started; a no-op for an endpoint. */
  close(): Promise<void> { return closeLlmModel(this.llm); }
  async choose(state: unknown, choices: readonly { id: string; label: string }[], images: readonly string[], signal: AbortSignal) {
    signal.throwIfAborted();
    try {
      const { choiceId } = await chooseCandidate({ model: this.llm, system: this.prompt.instructions, state, candidates: choices, images, signal });
      return { choiceId, model: { id: this.model.modelId, requestedId: this.model.modelId, runtime: agentOf(this.model) ? 'acp-agent-generative-choice' : 'openai-compatible-generative-choice' },
        prompt: { id: this.prompt.id, version: this.prompt.version, sha256: createHash('sha256').update(JSON.stringify({ instructions: this.prompt.instructions, choices })).digest('hex') } };
    } catch {
      signal.throwIfAborted();
      throw new Error('LLM choice failed: check the connection, the response format, the candidate IDs and the model ID. The provider response is not shown.');
    }
  }
}
export class LlmSpeechPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  constructor(private readonly client: LlmChoiceClient, private readonly historyLimit: number, private readonly options: { modelGiveUp?: boolean } & SpeechGuard = {}) {}
  takeDecisionEvidence() { return this.evidence.splice(0); }
  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    if (input.observation.kind !== 'screenreader') throw new Error('Speech-only policy required');
    const guarded = speechGuardStop(this.options, input);
    if (guarded) { this.evidence.push(guarded.evidence); return guarded.decision; }
    const choices = speechChoices(input.allowedActions, this.options, input.inputs);
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
