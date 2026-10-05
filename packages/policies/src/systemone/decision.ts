import { createGateway, experimental_decide as decide, type JSONValue } from 'ai';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { RawstepError } from '@rawstep/core/errors';
import { validateCapabilities, validateSystemOneRequest, validateSystemOneResult, type SystemOneCapabilities, type SystemOneClient, type SystemOneRequest, type SystemOneResult } from './client.js';
import { checkOpenRouterImages, SystemOneDecisionModel, systemOneProviderOptions, type DecisionModelV4 } from './decision-model.js';

/**
 * The one client for every decision model. It asks `experimental_decide` from the AI SDK (an experimental API: the
 * versions of `ai` are pinned exactly, and only this file and decision-model.ts depend on its shape) and turns the
 * answer into a SystemOneResult. `typesafe`, `openrouter` and `custom` use the in-house /systemone adapter; `gateway`
 * uses the Vercel AI Gateway provider's decision model and takes text only.
 *
 * Provider text can carry credentials or page content, so SDK and server errors are never forwarded: callers only see
 * a RawstepError with a fixed message and one of `decision-cancelled`, `decision-timeout` or `decision-failed`.
 */
export type DecisionProviderName = 'typesafe' | 'gateway' | 'openrouter' | 'custom';
export type DecisionClientOptions = {
  provider: DecisionProviderName;
  /** The /systemone server root. Unused by `gateway` unless set, which only tests do. */
  baseURL?: string;
  modelId: string;
  apiKey?: string;
  timeoutMs?: number;
  capabilities: SystemOneCapabilities;
  /** Test seam; the default is global fetch. Redirects always fail so credentials never follow them. */
  fetch?: typeof fetch;
};

const MESSAGES = {
  'decision-cancelled': 'Decision call was cancelled.',
  'decision-timeout': 'Decision call timed out.',
  'decision-failed': 'Decision call failed: connection, response format or model identity; raw provider details omitted for privacy.',
} as const;
export const decisionError = (code: keyof typeof MESSAGES) => new RawstepError(code, MESSAGES[code]);

const RUNTIME: Record<DecisionProviderName, string> = { typesafe: 'systemone-http', custom: 'systemone-http', openrouter: 'openrouter-systemone-http', gateway: 'vercel-gateway-decision' };
const GATEWAY_DECISION_TYPES: readonly unknown[] = ['decision', 'evaluation'];

/** Resolves when `promise` does, rejects as soon as `signal` aborts (the gateway catalog call takes no signal). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function gatewayProvider(options: { apiKey: string; baseURL?: string | undefined; fetch?: typeof fetch | undefined }) {
  const fetcher = options.fetch ?? fetch;
  return createGateway({ apiKey: options.apiKey, ...(options.baseURL ? { baseURL: options.baseURL } : {}), fetch: (input, init) => fetcher(input, { ...init, redirect: 'error' }) });
}
/** The decision and evaluation models the Vercel AI Gateway lists, for the model picker. */
export async function listGatewayDecisionModels(options: { apiKey: string; baseURL?: string; fetch?: typeof fetch; signal?: AbortSignal }): Promise<{ id: string; name: string }[]> {
  const { models } = await abortable(gatewayProvider(options).getAvailableModels(), options.signal ?? new AbortController().signal);
  return models.filter(m => GATEWAY_DECISION_TYPES.includes(m.modelType)).map(m => ({ id: m.id, name: m.name || m.id }));
}

export class DecisionClient implements SystemOneClient {
  readonly capabilities: SystemOneCapabilities;
  private readonly model: DecisionModelV4;
  private readonly timeoutMs: number;
  private ready = false;
  constructor(private readonly options: DecisionClientOptions) {
    if (!options.modelId?.trim()) throw new Error('An explicit decision model is required.');
    validateCapabilities(options.capabilities);
    this.capabilities = Object.freeze({ ...options.capabilities, inputs: Object.freeze([...options.capabilities.inputs]) });
    this.timeoutMs = options.timeoutMs ?? RAWSTEP_DEFAULTS.modelTimeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) throw new Error('Invalid decision timeout.');
    if (options.provider === 'gateway') {
      if (!options.apiKey?.trim()) throw new Error('The Vercel AI Gateway requires an API key.');
      if (options.capabilities.inputs.includes('image')) throw new Error('The Vercel AI Gateway decision models take text only.');
      this.model = gatewayProvider({ apiKey: options.apiKey, baseURL: options.baseURL, fetch: options.fetch }).decisionModel(options.modelId);
    } else {
      if (!options.baseURL) throw new Error('A decision server address is required.');
      this.model = new SystemOneDecisionModel({ provider: options.provider, baseURL: options.baseURL, modelId: options.modelId, ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        dialect: options.provider === 'openrouter' ? 'openrouter' : 'onejev', inputs: options.capabilities.inputs, ...(options.fetch ? { fetch: options.fetch } : {}) });
    }
  }

  private signal(caller: AbortSignal | undefined) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return { timeout, signal: caller ? AbortSignal.any([caller, timeout]) : timeout };
  }
  private fail(error: unknown, caller: AbortSignal | undefined, timeout: AbortSignal): never {
    if (error instanceof RawstepError) throw error;
    if (caller?.aborted) throw decisionError('decision-cancelled');
    if (timeout.aborted) throw decisionError('decision-timeout');
    throw decisionError('decision-failed');
  }

  /** Network preflight before a browser or screen reader is acquired. No inference. */
  async prepare({ signal: caller }: { signal: AbortSignal }): Promise<void> {
    caller.throwIfAborted();
    if (this.ready) return;
    const { signal, timeout } = this.signal(caller);
    try {
      if (this.model instanceof SystemOneDecisionModel) await this.model.prepare({ signal });
      else {
        // The gateway lists every kind of model; only a confirmed decision model may be used here.
        const listed = await listGatewayDecisionModels({ apiKey: this.options.apiKey!, ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}), ...(this.options.fetch ? { fetch: this.options.fetch } : {}), signal });
        if (!listed.some(m => m.id === this.options.modelId)) throw new Error('Configured Gateway model is not a confirmed decision model.');
      }
      this.ready = true;
    } catch (error) { this.fail(error, caller, timeout); }
  }

  async evaluate(request: SystemOneRequest, { signal: caller }: { signal: AbortSignal }): Promise<SystemOneResult> {
    validateSystemOneRequest(request, this);
    const images = (request.images ?? []).map(image => image.pngBase64);
    if (this.options.provider === 'openrouter') checkOpenRouterImages(images);
    caller.throwIfAborted();
    await this.prepare({ signal: caller });
    const { signal, timeout } = this.signal(caller);
    const criteria = Object.fromEntries(request.choices.map(c => [c.id, c.label]));
    try {
      // A JSON round trip drops `undefined` fields, which the SDK rejects as non-JSON.
      const state = JSON.parse(JSON.stringify(request.state)) as Record<string, JSONValue>;
      const result = await decide({
        model: this.model, state, questions: { next: { type: 'choice', instructions: request.instructions, criteria } },
        maxRetries: 0, abortSignal: signal, providerOptions: systemOneProviderOptions(images),
      });
      const answer = result.answers.next, probabilities = answer.probabilities;
      if (!probabilities) throw new Error('The model returned no probabilities.');
      const expected = this.model instanceof SystemOneDecisionModel ? this.model.pinnedModelId : this.options.modelId;
      // Never accept a silently switched model, including a generative fallback.
      if (result.response.modelId !== expected) throw new Error('The model changed.');
      if (this.options.apiKey && result.response.modelId.includes(this.options.apiKey)) throw new Error('credential echoed');
      const decoded: SystemOneResult = { choiceId: answer.choice, probabilities: request.choices.map(c => probabilities[c.id] as number),
        model: { id: result.response.modelId, requestedId: this.options.modelId, runtime: RUNTIME[this.options.provider] } };
      validateSystemOneResult(decoded, request.choices);
      return decoded;
    } catch (error) { return this.fail(error, caller, timeout); }
  }
}
