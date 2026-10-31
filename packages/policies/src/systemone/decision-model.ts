import type { Experimental_DecisionModel } from 'ai';
import { isLoopbackHostname } from '@rawstep/core/defaults';
import { modelBaseURL } from './base-url.js';

// `ai` does not re-export the provider-level decision model types, so they are derived from the one it does.
export type DecisionModelV4 = Extract<Experimental_DecisionModel, { doDecide: unknown }>;
type DecisionCallOptions = Parameters<DecisionModelV4['doDecide']>[0];
type DecisionResult = Awaited<ReturnType<DecisionModelV4['doDecide']>>;

/**
 * The /systemone protocol as an AI SDK decision model.
 *
 * The decision API in `ai` is experimental (`experimental_decide`, `Experimental_DecisionModelV4`) and may change in
 * patch releases, so the SDK versions are pinned exactly in package.json and this file is the only place that
 * implements the model contract. One class serves every /systemone server; `dialect` only changes the request:
 * - `onejev` (TypeSafe, custom servers): the state and questions as they are.
 * - `openrouter`: `provider.allow_fallbacks: false`, and the model pinned to the `canonical_slug` found in the decision catalog.
 *
 * Server text never reaches an error: failures carry fixed messages only.
 */
export type SystemOneDialect = 'onejev' | 'openrouter';
export type SystemOneDecisionModelOptions = {
  /** Provider label for SDK metadata (for example `typesafe`). */
  provider: string;
  baseURL: string;
  modelId: string;
  apiKey?: string;
  dialect: SystemOneDialect;
  /** Test seam; the default is global fetch. Redirects always fail so credentials never follow them. */
  fetch?: typeof fetch;
};

const MAX_RESPONSE_BYTES = 1_000_000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Response cap avoids retaining arbitrary server output in errors or memory. Returns the raw text so credential echoes can be rejected. */
async function boundedText(response: Response): Promise<string> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`SystemOne HTTP ${response.status}; response body omitted for privacy.`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty SystemOne response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > MAX_RESPONSE_BYTES) throw new Error('SystemOne response exceeds byte limit.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export class SystemOneDecisionModel implements DecisionModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider: string;
  readonly modelId: string;
  /** Only choice questions: the Rawstep policies always choose among candidates. */
  readonly supportedQuestionTypes = ['choice'] as const;
  private readonly base: URL;
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;
  private resolved?: string;
  constructor(private readonly options: SystemOneDecisionModelOptions) {
    if (!options.modelId?.trim()) throw new Error('An explicit SystemOne model is required.');
    this.provider = options.provider; this.modelId = options.modelId; this.apiKey = options.apiKey || undefined;
    this.base = modelBaseURL(options.baseURL);
    this.fetcher = options.fetch ?? fetch;
    if (options.dialect === 'openrouter') {
      if (!this.apiKey?.trim()) throw new Error('OpenRouter SystemOne requires an API key.');
      // The OpenRouter key goes nowhere else (loopback is for tests).
      if (!isLoopbackHostname(this.base.hostname) && (this.base.origin !== 'https://openrouter.ai' || this.base.pathname !== '/api/v1/'))
        throw new Error('OpenRouter SystemOne base URL must be https://openrouter.ai/api/v1 (or loopback for tests).');
    }
  }
  /** The model ID every response must name: the configured one, or for openrouter the canonical slug resolved by `prepare`. */
  get pinnedModelId(): string { return this.resolved ?? this.modelId; }

  private async request(path: string, body: unknown | undefined, signal: AbortSignal | undefined, headers?: Record<string, string | undefined>): Promise<string> {
    signal?.throwIfAborted();
    const extra = Object.fromEntries(Object.entries(headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const response = await this.fetcher(new URL(path, this.base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', ...(signal ? { signal } : {}),
      headers: { ...extra, 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await boundedText(response);
    signal?.throwIfAborted();
    if (this.apiKey && text.includes(this.apiKey)) throw new Error('The SystemOne response contained the credential.');
    return text;
  }

  /**
   * Network preflight with no inference. For openrouter it reads the decision catalog, confirms the model is a native
   * decision model that takes text and pins inference to its `canonical_slug`: no aliases, auto routers or
   * generative fallback. Other dialects have nothing to check.
   */
  async prepare({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    signal?.throwIfAborted();
    if (this.options.dialect !== 'openrouter' || this.resolved) return;
    let catalog: Record<string, unknown>;
    try { catalog = record(JSON.parse(await this.request('models?output_modalities=decisions', undefined, signal))); } catch { throw new Error('Cannot read the OpenRouter decision catalog.'); }
    const model = Array.isArray(catalog.data) ? catalog.data.map(record).find(m => m.id === this.modelId || m.canonical_slug === this.modelId) : undefined;
    const architecture = record(model?.architecture);
    if (!model || !Array.isArray(architecture.output_modalities) || architecture.output_modalities.length !== 1 || architecture.output_modalities[0] !== 'decisions' ||
        !Array.isArray(architecture.input_modalities) || !architecture.input_modalities.includes('text') ||
        typeof model.canonical_slug !== 'string' || !model.canonical_slug.trim() || model.canonical_slug.includes(this.apiKey!))
      throw new Error('Configured OpenRouter model is not a confirmed native decision model that takes text.');
    if (!/^[a-z0-9._:-]+\/[a-z0-9._:-]+$/i.test(model.canonical_slug)) throw new Error('Invalid OpenRouter canonical model identity.');
    this.resolved = model.canonical_slug;
  }

  async doDecide({ state, questions, abortSignal, headers }: DecisionCallOptions): Promise<DecisionResult> {
    const wireQuestions = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      if (q.type !== 'choice') throw new Error('Only choice questions are supported.');
      return [id, { type: 'choice', instructions: q.instructions, criteria: q.criteria }];
    }));
    let body: Record<string, unknown>;
    if (this.options.dialect === 'openrouter') {
      await this.prepare({ signal: abortSignal });
      body = { model: this.resolved, questions: wireQuestions, provider: { allow_fallbacks: false }, state };
    } else body = { model: this.modelId, questions: wireQuestions, state };
    const text = await this.request('systemone', body, abortSignal, headers);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('Invalid SystemOne JSON; response body omitted for privacy.'); }
    return this.decode(value, questions);
  }

  private decode(value: unknown, questions: DecisionCallOptions['questions']): DecisionResult {
    const result = record(value), answers = record(result.answers), ids = Object.keys(questions);
    // A silently switched model, including a generative fallback, is never accepted.
    if (typeof result.model !== 'string' || result.model !== this.pinnedModelId) throw new Error('SystemOne response used a different model; automatic fallback is forbidden.');
    if (Object.keys(answers).length !== ids.length) throw new Error('Invalid SystemOne response contract.');
    const decoded: DecisionResult['answers'] = {};
    for (const id of ids) {
      const answer = record(answers[id]), criteria = Object.keys(questions[id]!.criteria as object), probabilities = record(answer.probabilities);
      if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !criteria.includes(answer.choice) || Object.keys(probabilities).length !== criteria.length ||
          !criteria.every(key => typeof probabilities[key] === 'number' && Number.isFinite(probabilities[key]) && (probabilities[key] as number) >= 0 && (probabilities[key] as number) <= 1))
        throw new Error('Invalid SystemOne choice or probability distribution.');
      const sum = criteria.reduce((total, key) => total + (probabilities[key] as number), 0);
      if (Math.abs(sum - 1) > 0.01) throw new Error('SystemOne probabilities must sum to 1.');
      // Servers round their output; the SDK checks the distribution against 1e-6, so hand it a normalized copy.
      decoded[id] = { type: 'choice', choice: answer.choice, probabilities: Object.fromEntries(criteria.map(key => [key, (probabilities[key] as number) / sum])) };
    }
    return { answers: decoded, warnings: [], response: { modelId: result.model } };
  }
}
