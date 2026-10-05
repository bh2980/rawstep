import { validateCapabilities, validateSystemOneRequest, validateSystemOneResult, type SystemOneCapabilities, type SystemOneClient, type SystemOneRequest, type SystemOneResult } from './client.js';

export type SystemOneHttpOptions = {
  baseURL: string; model: string; apiKey?: string; timeoutMs?: number; fetch?: typeof fetch;
};
export function modelBaseURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Model base URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('Model base URL requires HTTPS, or loopback HTTP, without credentials/query/fragment.');
  url.pathname = url.pathname.replace(/\/$/, '') + '/'; return url;
}
/** Response cap avoids retaining arbitrary server output in errors or memory. */
async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`SystemOne HTTP ${response.status}; response body omitted for privacy.`); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty SystemOne response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length;
      if (length > 1_000_000) throw new Error('SystemOne response exceeds byte limit.'); chunks.push(part.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid SystemOne JSON; response body omitted for privacy.'); }
  } finally { await reader.cancel().catch(() => {}); }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

abstract class HttpClient implements SystemOneClient {
  abstract readonly capabilities: SystemOneCapabilities;
  protected readonly base: URL;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  constructor(protected readonly options: SystemOneHttpOptions) {
    this.base = modelBaseURL(options.baseURL);
    if (!options.model?.trim()) throw new Error('An explicit SystemOne model is required.');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) throw new Error('Invalid SystemOne timeout.');
    this.fetcher = options.fetch ?? fetch;
  }
  protected async request(path: string, body: unknown | undefined, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    let response: Response;
    try { response = await this.fetcher(new URL(path, this.base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: bounded,
      headers: { 'content-type': 'application/json', ...(body !== undefined && this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { throw new Error('SystemOne connection failed, cancelled, or timed out; transport details omitted for privacy.'); }
    try { const value = await jsonResponse(response); bounded.throwIfAborted(); return value; }
    catch (error) { if (bounded.aborted) throw new Error('SystemOne request cancelled or timed out.'); throw error; }
  }
  protected decode(value: unknown, request: SystemOneRequest, runtime: string, expectedModel = this.options.model): SystemOneResult {
    const result = record(value), answer = record(record(result.answers).next), probabilities = record(answer.probabilities);
    if (answer.type !== 'choice' || Object.keys(probabilities).length !== request.choices.length || typeof result.model !== 'string' ||
        (this.options.apiKey && result.model.includes(this.options.apiKey))) throw new Error('Invalid SystemOne response contract.');
    const decoded = { choiceId: answer.choice as string, probabilities: request.choices.map(c => probabilities[c.id] as number),
      model: { id: result.model, requestedId: this.options.model, runtime } };
    validateSystemOneResult(decoded, request.choices);
    // Never accept a silently switched model, including a generative fallback.
    if (decoded.model.id !== expectedModel) throw new Error('SystemOne response used a different model; automatic fallback is forbidden.');
    return decoded;
  }
  abstract evaluate(request: SystemOneRequest, options: { signal: AbortSignal }): Promise<SystemOneResult>;
}

/** Native evaluation only: no chat completions, fallback models, or arbitrary providerOptions. */
export class VercelEvaluationClient extends HttpClient {
  readonly capabilities: SystemOneCapabilities = { inputs: ['text'], maxChoices: 255, maxImages: 0 };
  private ready = false;
  constructor(options: SystemOneHttpOptions) { super(options); if (!options.apiKey) throw new Error('Vercel evaluation requires an API key.'); }
  async prepare({ signal }: { signal: AbortSignal }): Promise<void> {
    if (this.ready) return;
    const catalog = record(await this.request('models', undefined, signal));
    const model = Array.isArray(catalog.data) ? catalog.data.map(record).find(m => m.id === this.options.model) : undefined;
    if (!model || model.type !== 'evaluation' || !Array.isArray(record(model.modalities).input) || !(record(model.modalities).input as unknown[]).includes('text'))
      throw new Error('Configured Gateway model is not a confirmed native text evaluation model.');
    this.ready = true;
  }
  async evaluate(request: SystemOneRequest, { signal }: { signal: AbortSignal }): Promise<SystemOneResult> {
    validateSystemOneRequest(request, this); await this.prepare({ signal });
    return this.decode(await this.request('evaluate', { model: this.options.model, state: request.state,
      questions: { next: { type: 'choice', instructions: request.instructions, criteria: Object.fromEntries(request.choices.map(c => [c.id, c.label])) } } }, signal), request, 'vercel-evaluation-http');
  }
}

/** TypeSafe-compatible /systemone with OneJev inline-media extension. Capabilities are explicit. */
export class SystemOneHttpClient extends HttpClient {
  readonly capabilities: SystemOneCapabilities;
  constructor(options: SystemOneHttpOptions & { capabilities: SystemOneCapabilities }) {
    super(options); validateCapabilities(options.capabilities); this.capabilities = structuredClone(options.capabilities);
  }
  async evaluate(request: SystemOneRequest, { signal }: { signal: AbortSignal }): Promise<SystemOneResult> {
    validateSystemOneRequest(request, this);
    const images = request.images ?? [];
    const state = { ...request.state, ...(images.length ? { screens: images.map((_, i) => `<image:${i + 1}>`) } : {}) };
    // Reject caller-authored media references; only this adapter may create them.
    if (/<(?:image|video):\d+>/.test(JSON.stringify(request.state))) throw new Error('Media references are reserved for the SystemOne adapter.');
    return this.decode(await this.request('systemone', { model: this.options.model, state,
      questions: { next: { type: 'choice', instructions: request.instructions, criteria: Object.fromEntries(request.choices.map(c => [c.id, c.label])) } },
      ...(images.length ? { media: images.map(image => ({ type: 'image', data: `data:image/png;base64,${image.pngBase64}` })) } : {}) }, signal), request, 'systemone-http');
  }
}

/** Native OpenRouter decisions, never /chat/completions or generated JSON.
 * Images are content parts inside state, not the direct Cloudflare `images` extension.
 */
export class OpenRouterSystemOneClient extends HttpClient {
  readonly capabilities: SystemOneCapabilities;
  private resolvedModel?: string;
  constructor(options: SystemOneHttpOptions & { capabilities: SystemOneCapabilities }) {
    super(options);
    if (!options.apiKey?.trim()) throw new Error('OpenRouter SystemOne requires an API key. Set RAWSTEP_DECISION_OPENROUTER_API_KEY for a CLI override.');
    validateCapabilities(options.capabilities);
    this.capabilities = Object.freeze({ ...options.capabilities, inputs: Object.freeze([...options.capabilities.inputs]) });
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    if (!local && (this.base.origin !== 'https://openrouter.ai' || this.base.pathname !== '/api/v1/'))
      throw new Error('OpenRouter SystemOne base URL must be https://openrouter.ai/api/v1 (or loopback for tests).');
  }
  async prepare({ signal }: { signal: AbortSignal }): Promise<void> {
    signal.throwIfAborted();
    if (this.resolvedModel) return;
    // Decisions have their own catalog filter; the default catalog is chat-only.
    const catalog = record(await this.request('models?output_modalities=decisions', undefined, signal));
    const model = Array.isArray(catalog.data) ? catalog.data.map(record).find(m => m.id === this.options.model || m.canonical_slug === this.options.model) : undefined;
    const architecture = record(model?.architecture);
    if (!model || !Array.isArray(architecture.output_modalities) || architecture.output_modalities.length !== 1 || architecture.output_modalities[0] !== 'decisions' ||
        !Array.isArray(architecture.input_modalities) || !this.capabilities.inputs.every(input => (architecture.input_modalities as unknown[]).includes(input)) ||
        typeof model.canonical_slug !== 'string' || !model.canonical_slug.trim() || model.canonical_slug.includes(this.options.apiKey!))
      throw new Error('Configured OpenRouter model is not a confirmed native decision model with the required inputs.');
    // Resolve an alias before acquiring a browser, then pin every inference to this exact ID.
    // No prefix/date heuristics, auto routers, latest-model swaps, or generative fallback.
    if (!/^[a-z0-9._:-]+\/[a-z0-9._:-]+$/i.test(model.canonical_slug)) throw new Error('Invalid OpenRouter canonical model identity.');
    this.resolvedModel = model.canonical_slug;
  }
  async evaluate(request: SystemOneRequest, { signal }: { signal: AbortSignal }): Promise<SystemOneResult> {
    validateSystemOneRequest(request, this);
    const images = request.images ?? [];
    let totalBytes = 0;
    for (const image of images) {
      const bytes = Buffer.from(image.pngBase64, 'base64'); totalBytes += bytes.length;
      if (bytes.length > 4 * 1024 * 1024 || bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
          bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 16_000_000)
        throw new Error('OpenRouter PNG exceeds the image byte/pixel limit or has an invalid header.');
    }
    if (totalBytes > 8 * 1024 * 1024) throw new Error('OpenRouter images exceed the total byte limit.');
    await this.prepare({ signal });
    const value = await this.request('systemone', {
      model: this.resolvedModel,
      state: images.length ? [
        { type: 'text', text: JSON.stringify(request.state) },
        ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.pngBase64}` } })),
      ] : request.state,
      questions: { next: { type: 'choice', instructions: request.instructions, criteria: Object.fromEntries(request.choices.map(c => [c.id, c.label])) } },
      provider: { allow_fallbacks: false },
    }, signal);
    return this.decode(value, request, 'openrouter-systemone-http', this.resolvedModel);
  }
}
