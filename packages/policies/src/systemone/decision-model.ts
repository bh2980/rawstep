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
 * implements the model contract. One class serves every /systemone server; `dialect` only changes how images travel:
 * - `onejev` (TypeSafe, custom servers): the OneJev `media` field, referenced from `state.screens` as `<image:N>`.
 * - `openrouter`: image content parts inside `state`, `provider.allow_fallbacks: false`, and the model pinned to the
 *   `canonical_slug` found in the decision catalog.
 *
 * Images are not part of the SDK's call options, so callers pass base64 PNGs in `providerOptions.rawstep.images`.
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
  /** Inputs the model must accept; the openrouter dialect confirms them against the catalog before inference. */
  inputs?: readonly ('text' | 'image')[];
  /** Test seam; the default is global fetch. Redirects always fail so credentials never follow them. */
  fetch?: typeof fetch;
};

/** The provider-options key that carries the PNG images of one decision. */
export const SYSTEMONE_PROVIDER_OPTIONS_KEY = 'rawstep';
export const systemOneProviderOptions = (images: readonly string[]) => images.length ? { [SYSTEMONE_PROVIDER_OPTIONS_KEY]: { images: [...images] } } : undefined;

const MAX_RESPONSE_BYTES = 1_000_000;
const PNG_SIGNATURE = '89504e470d0a1a0a';
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

function readImages(providerOptions: DecisionCallOptions['providerOptions']): string[] {
  const images = record(providerOptions?.[SYSTEMONE_PROVIDER_OPTIONS_KEY]).images;
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.some(image => typeof image !== 'string')) throw new Error('SystemOne images must be base64 strings.');
  for (const image of images as string[]) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image) || Buffer.from(image, 'base64').subarray(0, 8).toString('hex') !== PNG_SIGNATURE) throw new Error('SystemOne images must contain inline PNG bytes.');
  }
  return images as string[];
}
/** OpenRouter bounds: 4 MiB and 16 megapixels per PNG, 8 MiB in total, a readable IHDR header. */
export function checkOpenRouterImages(images: readonly string[]): void {
  let total = 0;
  for (const image of images) {
    const bytes = Buffer.from(image, 'base64'); total += bytes.length;
    if (bytes.length > 4 * 1024 * 1024 || bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000)
      throw new Error('OpenRouter PNG exceeds the image byte/pixel limit or has an invalid header.');
  }
  if (total > 8 * 1024 * 1024) throw new Error('OpenRouter images exceed the total byte limit.');
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
   * decision model with the required inputs and pins inference to its `canonical_slug`: no aliases, auto routers or
   * generative fallback. Other dialects have nothing to check.
   */
  async prepare({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    signal?.throwIfAborted();
    if (this.options.dialect !== 'openrouter' || this.resolved) return;
    let catalog: Record<string, unknown>;
    try { catalog = record(JSON.parse(await this.request('models?output_modalities=decisions', undefined, signal))); } catch { throw new Error('Cannot read the OpenRouter decision catalog.'); }
    const model = Array.isArray(catalog.data) ? catalog.data.map(record).find(m => m.id === this.modelId || m.canonical_slug === this.modelId) : undefined;
    const architecture = record(model?.architecture), required = this.options.inputs ?? ['text'];
    if (!model || !Array.isArray(architecture.output_modalities) || architecture.output_modalities.length !== 1 || architecture.output_modalities[0] !== 'decisions' ||
        !Array.isArray(architecture.input_modalities) || !required.every(input => (architecture.input_modalities as unknown[]).includes(input)) ||
        typeof model.canonical_slug !== 'string' || !model.canonical_slug.trim() || model.canonical_slug.includes(this.apiKey!))
      throw new Error('Configured OpenRouter model is not a confirmed native decision model with the required inputs.');
    if (!/^[a-z0-9._:-]+\/[a-z0-9._:-]+$/i.test(model.canonical_slug)) throw new Error('Invalid OpenRouter canonical model identity.');
    this.resolved = model.canonical_slug;
  }

  async doDecide({ state, questions, abortSignal, headers, providerOptions }: DecisionCallOptions): Promise<DecisionResult> {
    const images = readImages(providerOptions);
    const wireQuestions = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      if (q.type !== 'choice') throw new Error('Only choice questions are supported.');
      return [id, { type: 'choice', instructions: q.instructions, criteria: q.criteria }];
    }));
    let body: Record<string, unknown>;
    if (this.options.dialect === 'openrouter') {
      checkOpenRouterImages(images);
      await this.prepare({ signal: abortSignal });
      body = { model: this.resolved, questions: wireQuestions, provider: { allow_fallbacks: false },
        state: images.length ? [
          { type: 'text', text: JSON.stringify(state) },
          ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } })),
        ] : state };
    } else {
      // Media references are reserved: only this adapter may create them.
      if (/<(?:image|video):\d+>/.test(JSON.stringify(state))) throw new Error('Media references are reserved for the SystemOne adapter.');
      if (images.length && (typeof state !== 'object' || Array.isArray(state))) throw new Error('Images need an object state.');
      body = { model: this.modelId, questions: wireQuestions,
        state: images.length ? { ...(state as object), screens: images.map((_, i) => `<image:${i + 1}>`) } : state,
        ...(images.length ? { media: images.map(image => ({ type: 'image', data: `data:image/png;base64,${image}` })) } : {}) };
    }
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
