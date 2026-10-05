import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeSystemOneClient, OpenRouterSystemOneClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, SCREENSHOT_DECISION_PROMPT, systemOnePromptEvidence } from 'rawstep/systemone';
import { ScreenshotDecisionPolicy, type ScreenshotModelRequest } from 'rawstep/screenshot';
import type { SystemOneCapabilities, SystemOneRequest } from 'rawstep/systemone';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII=';
const previousPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const visual: SystemOneCapabilities = { inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 };
const text: SystemOneCapabilities = { inputs: ['text'], maxChoices: 255, maxImages: 0 };
const signal = () => new AbortController().signal;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const models = { data: [
  { id: 'typesafe/jev-1.13', canonical_slug: 'typesafe/jev-1.13-20260917', architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } },
  { id: 'cloudflare/clef-flash', canonical_slug: 'cloudflare/clef-flash', architecture: { input_modalities: ['text', 'image'], output_modalities: ['decisions'] } },
] };
const request: SystemOneRequest = { state: { goal: 'Start' }, instructions: 'Choose next', choices: [{ id: 'key:Enter', label: 'Enter' }, { id: 'stop:uncertain', label: 'Uncertain' }] };
type WireRequest = { path: string; authorization?: string; body?: any };
async function http(handler: (request: WireRequest) => unknown) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const result = handler({ path: req.url!, authorization: req.headers.authorization, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
}
const answer = (body: any) => ({ model: body.model, answers: { next: { type: 'choice', choice: 'key:Enter', probabilities: { 'key:Enter': 0.9, 'stop:uncertain': 0.1 } } } });

describe('native OpenRouter SystemOne transport (no real inference or browser)', () => {
  it('resolves Jev from the decisions catalog, pins its exact ID, and retains requested identity', async () => {
    const seen: WireRequest[] = [];
    const baseURL = await http(r => { seen.push(r); return r.body ? answer(r.body) : models; });
    const client = new OpenRouterSystemOneClient({ baseURL, model: 'typesafe/jev-1.13', apiKey: 'PRIVATE_KEY', capabilities: text });
    await client.prepare({ signal: signal() });
    const result = await client.evaluate(request, { signal: signal() });
    expect(seen.map(r => r.path)).toEqual(['/api/v1/models?output_modalities=decisions', '/api/v1/systemone']);
    expect(seen[0]?.authorization).toBeUndefined(); expect(seen[1]?.authorization).toBe('Bearer PRIVATE_KEY');
    expect(seen[1]?.body).toEqual({ model: 'typesafe/jev-1.13-20260917', state: request.state,
      questions: { next: { type: 'choice', instructions: request.instructions, criteria: { 'key:Enter': 'Enter', 'stop:uncertain': 'Uncertain' } } }, provider: { allow_fallbacks: false } });
    expect(result.model).toEqual({ id: 'typesafe/jev-1.13-20260917', requestedId: 'typesafe/jev-1.13', runtime: 'openrouter-systemone-http' });
    expect(JSON.stringify(seen[1]?.body)).not.toContain('PRIVATE_KEY');
    await client.evaluate(request, { signal: signal() }); expect(seen).toHaveLength(3);
  });
  it('accepts an explicit canonical Jev version and rejects a swapped or unrecognized result', async () => {
    for (const model of ['typesafe/jev-1.13-20260917', 'typesafe/jev-1.13', 'google/gemini-other']) {
      const baseURL = await http(r => r.body ? { ...answer(r.body), model } : models);
      const client = new OpenRouterSystemOneClient({ baseURL, model: 'typesafe/jev-1.13-20260917', apiKey: 'test', capabilities: text });
      if (model === 'typesafe/jev-1.13-20260917') expect((await client.evaluate(request, { signal: signal() })).choiceId).toBe('key:Enter');
      else await expect(client.evaluate(request, { signal: signal() })).rejects.toThrow('different model');
    }
  });
  it('sends current/previous PNGs as ordered state content, not ignored top-level extensions', async () => {
    const seen: WireRequest[] = [];
    const baseURL = await http(r => { seen.push(r); return r.body ? answer(r.body) : models; });
    const client = new OpenRouterSystemOneClient({ baseURL, model: 'cloudflare/clef-flash', apiKey: 'PRIVATE_KEY', capabilities: visual });
    const state = { ...request.state, imageOrder: ['current', 'previous'] };
    const result = await client.evaluate({ ...request, state, images: [{ pngBase64: png }, { pngBase64: previousPng }] }, { signal: signal() });
    expect(seen[1]?.body.state).toEqual([
      { type: 'text', text: JSON.stringify(state) },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${previousPng}` } },
    ]);
    expect(seen[1]?.body).not.toHaveProperty('images'); expect(seen[1]?.body).not.toHaveProperty('media');
    expect(seen[1]?.body.provider).toEqual({ allow_fallbacks: false });
    expect(seen[1]?.path).toBe('/api/v1/systemone'); expect(JSON.stringify(seen[1]?.body)).not.toContain('PRIVATE_KEY');
    expect(result.model.id).toBe('cloudflare/clef-flash');
    expect(Object.isFrozen(client.capabilities)).toBe(true); expect(Object.isFrozen(client.capabilities.inputs)).toBe(true);
    expect(state).toEqual({ ...request.state, imageOrder: ['current', 'previous'] });
  });
  it('rejects images for text-only clients before network activity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(models));
    const client = new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text, fetch: fetcher });
    await expect(client.evaluate({ ...request, images: [{ pngBase64: png }] }, { signal: signal() })).rejects.toThrow('input modalities');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects image byte/pixel limits and invalid headers before any network request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(models));
    const client = new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model: 'cloudflare/clef-flash', apiKey: 'test', capabilities: { ...visual, maxImages: 3 }, fetch: fetcher });
    const large = Buffer.alloc(4 * 1024 * 1024 + 1); Buffer.from(png, 'base64').copy(large);
    const pixels = Buffer.from(png, 'base64'); pixels.writeUInt32BE(5000, 16); pixels.writeUInt32BE(5000, 20);
    for (const bytes of [large, pixels, Buffer.from('89504e470d0a1a0a', 'hex')])
      await expect(client.evaluate({ ...request, images: [{ pngBase64: bytes.toString('base64') }] }, { signal: signal() })).rejects.toThrow('header');
    const combined = Buffer.alloc(3 * 1024 * 1024); Buffer.from(png, 'base64').copy(combined);
    await expect(client.evaluate({ ...request, images: Array.from({ length: 3 }, () => ({ pngBase64: combined.toString('base64') })) }, { signal: signal() })).rejects.toThrow('total byte limit');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects wrong capabilities, missing catalog identities, and generative models before POST', async () => {
    for (const catalog of [{ data: [{ ...models.data[1], architecture: { input_modalities: ['image'], output_modalities: ['decisions'] } }] }, { data: [] }, { data: [{ ...models.data[1], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }] }]) {
      const post = vi.fn();
      const baseURL = await http(r => { if (r.body) post(); return catalog; });
      const client = new OpenRouterSystemOneClient({ baseURL, model: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text });
      await expect(client.prepare({ signal: signal() })).rejects.toThrow('confirmed native decision'); expect(post).not.toHaveBeenCalled();
    }
  });
  it('rejects unknown candidates, malformed distributions and secret-bearing metadata', async () => {
    for (const result of [
      { ...answer({ model: 'cloudflare/clef-flash' }), model: 'PRIVATE_KEY' },
      { model: 'cloudflare/clef-flash', answers: { next: { type: 'choice', choice: 'shell:delete', probabilities: { 'key:Enter': 1, 'stop:uncertain': 0 } } } },
      { model: 'cloudflare/clef-flash', answers: { next: { type: 'choice', choice: 'key:Enter', probabilities: { 'key:Enter': 2, 'stop:uncertain': -1 } } } },
    ]) {
      const baseURL = await http(r => r.body ? result : models);
      const client = new OpenRouterSystemOneClient({ baseURL, model: 'cloudflare/clef-flash', apiKey: 'PRIVATE_KEY', capabilities: text });
      const error = await client.evaluate(request, { signal: signal() }).catch(e => e);
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('PRIVATE_KEY');
    }
  });
  it('keeps response bodies private and never retries HTTP failures or invalid JSON', async () => {
    for (const response of [() => new Response('PRIVATE_RESPONSE', { status: 402 }), () => new Response('PRIVATE_RESPONSE')]) {
      const fetcher = vi.fn<typeof fetch>(async (_url, options) => options?.method === 'GET' ? Response.json(models) : response());
      const client = new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model: 'cloudflare/clef-flash', apiKey: 'PRIVATE_KEY', capabilities: text, fetch: fetcher });
      const error = await client.evaluate(request, { signal: signal() }).catch(e => e);
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toMatch(/PRIVATE_RESPONSE|PRIVATE_KEY/); expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('honors abort and timeout without a fallback inference', async () => {
    let began!: () => void; const started = new Promise<void>(resolve => began = resolve);
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      if (options?.method === 'GET') return Response.json(models);
      began();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(options!.signal!.reason);
        if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    });
    const client = new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text, fetch: fetcher, timeoutMs: 10 });
    await client.prepare({ signal: signal() });
    const controller = new AbortController(); const pending = client.evaluate(request, { signal: controller.signal });
    await started; controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    await expect(client.evaluate(request, { signal: signal() })).rejects.toThrow('timed out'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects unsupported API roots and missing keys without exposing credentials', () => {
    expect(() => new OpenRouterSystemOneClient({ baseURL: 'https://example.test/v1', model: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text })).toThrow('base URL');
    expect(() => new OpenRouterSystemOneClient({ baseURL: 'https://openrouter.ai/api/v1', model: 'cloudflare/clef-flash', capabilities: text })).toThrow('API key');
  });
});

describe('UI-ready prompt injection', () => {
  it('takes a copied instruction config, records its version/hash, and keeps candidates constrained', async () => {
    const prompt = { id: 'custom-visual', version: '2', instructions: 'CUSTOM_INSTRUCTION' };
    const client = new FakeSystemOneClient(['key:Enter']); const adapter = new SystemOneScreenshotAdapter(client, prompt); prompt.instructions = 'MUTATED';
    const visualRequest: ScreenshotModelRequest = { protocol: 'rawstep-screenshot-choice-v1', goal: 'Start', screenshot: { pngBase64: png, viewport: { w: 1, h: 1 } },
      choices: [{ id: 'key:Enter', label: 'Enter', decision: { action: { kind: 'key', key: 'Enter' } } }], history: [], visualState: { sha256: 'fixture', visits: 1, unchangedTransitions: 0 } };
    const result = await adapter.choose(visualRequest, { signal: signal() });
    expect(client.requests[0]?.instructions).toBe('CUSTOM_INSTRUCTION'); expect(result.prompt).toEqual({ id: 'custom-visual', version: '2', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.prompt?.sha256).not.toBe(systemOnePromptEvidence(SCREENSHOT_DECISION_PROMPT, request.choices).sha256);
    expect(JSON.stringify(result)).not.toContain('CUSTOM_INSTRUCTION');
    const policy = new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(new FakeSystemOneClient(['key:Enter'])) });
    await policy.decide({ goal: 'Start', observation: { kind: 'keyboard', screenshot: visualRequest.screenshot, window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'test' } }, history: [], allowedActions: { intents: [], keys: ['Enter'], inputKeys: [], replaceText: false }, inputs: {}, signal: signal() });
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ prompt: expect.objectContaining({ id: 'rawstep-screenshot-decision', version: '1' }) })]);
    expect(() => new SystemOneSpeechPolicy(new FakeSystemOneClient([]), 12, { id: 'bad', version: '1', instructions: '' })).toThrow('prompt');
  });
});
