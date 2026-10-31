import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecisionClient, FakeSystemOneClient, SystemOneChoiceModel, SPEECH_DECISION_PROMPT, systemOnePromptEvidence } from 'rawstep/systemone';
import { SpeechDecisionPolicy } from 'rawstep/policy';
import type { SystemOneCapabilities, SystemOneRequest } from 'rawstep/systemone';

const text: SystemOneCapabilities = { maxChoices: 255 };
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

describe('native OpenRouter SystemOne through the AI SDK decide API (no real inference or browser)', () => {
  it('resolves Jev from the decisions catalog, pins its exact ID, and retains requested identity', async () => {
    const seen: WireRequest[] = [];
    const baseURL = await http(r => { seen.push(r); return r.body ? answer(r.body) : models; });
    const client = new DecisionClient({ provider: 'openrouter', baseURL, modelId: 'typesafe/jev-1.13', apiKey: 'PRIVATE_KEY', capabilities: text });
    await client.prepare({ signal: signal() });
    const result = await client.evaluate(request, { signal: signal() });
    expect(seen.map(r => r.path)).toEqual(['/api/v1/models?output_modalities=decisions', '/api/v1/systemone']);
    expect(seen[0]?.authorization).toBe('Bearer PRIVATE_KEY'); expect(seen[1]?.authorization).toBe('Bearer PRIVATE_KEY');
    expect(seen[1]?.body).toEqual({ model: 'typesafe/jev-1.13-20260917', state: request.state,
      questions: { next: { type: 'choice', instructions: request.instructions, criteria: { 'key:Enter': 'Enter', 'stop:uncertain': 'Uncertain' } } }, provider: { allow_fallbacks: false } });
    expect(result.model).toEqual({ id: 'typesafe/jev-1.13-20260917', requestedId: 'typesafe/jev-1.13', runtime: 'openrouter-systemone-http' });
    expect(JSON.stringify(seen[1]?.body)).not.toContain('PRIVATE_KEY');
    await client.evaluate(request, { signal: signal() }); expect(seen).toHaveLength(3);
    expect(Object.isFrozen(client.capabilities)).toBe(true);
  });
  it('accepts an explicit canonical Jev version and rejects a swapped or unrecognized result', async () => {
    for (const model of ['typesafe/jev-1.13-20260917', 'typesafe/jev-1.13', 'google/gemini-other']) {
      const baseURL = await http(r => r.body ? { ...answer(r.body), model } : models);
      const client = new DecisionClient({ provider: 'openrouter', baseURL, modelId: 'typesafe/jev-1.13-20260917', apiKey: 'test', capabilities: text });
      if (model === 'typesafe/jev-1.13-20260917') expect((await client.evaluate(request, { signal: signal() })).choiceId).toBe('key:Enter');
      else await expect(client.evaluate(request, { signal: signal() })).rejects.toMatchObject({ name: 'RawstepError', code: 'decision-failed' });
    }
  });
  it('rejects wrong capabilities, missing catalog identities, and generative models before POST', async () => {
    for (const catalog of [{ data: [{ ...models.data[1], architecture: { input_modalities: ['image'], output_modalities: ['decisions'] } }] }, { data: [] }, { data: [{ ...models.data[1], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }] }]) {
      const post = vi.fn();
      const baseURL = await http(r => { if (r.body) post(); return catalog; });
      const client = new DecisionClient({ provider: 'openrouter', baseURL, modelId: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text });
      await expect(client.prepare({ signal: signal() })).rejects.toMatchObject({ code: 'decision-failed' }); expect(post).not.toHaveBeenCalled();
    }
  });
  it('rejects unknown candidates, malformed distributions and secret-bearing metadata', async () => {
    for (const result of [
      { ...answer({ model: 'cloudflare/clef-flash' }), model: 'PRIVATE_KEY' },
      { model: 'cloudflare/clef-flash', answers: { next: { type: 'choice', choice: 'shell:delete', probabilities: { 'key:Enter': 1, 'stop:uncertain': 0 } } } },
      { model: 'cloudflare/clef-flash', answers: { next: { type: 'choice', choice: 'key:Enter', probabilities: { 'key:Enter': 2, 'stop:uncertain': -1 } } } },
    ]) {
      const baseURL = await http(r => r.body ? result : models);
      const client = new DecisionClient({ provider: 'openrouter', baseURL, modelId: 'cloudflare/clef-flash', apiKey: 'PRIVATE_KEY', capabilities: text });
      const error = await client.evaluate(request, { signal: signal() }).catch(e => e);
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('PRIVATE_KEY');
    }
  });
  it('keeps response bodies private and never retries HTTP failures or invalid JSON', async () => {
    for (const response of [() => new Response('PRIVATE_RESPONSE', { status: 402 }), () => new Response('PRIVATE_RESPONSE')]) {
      const fetcher = vi.fn<typeof fetch>(async (_url, options) => options?.method === 'GET' ? Response.json(models) : response());
      const client = new DecisionClient({ provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', modelId: 'cloudflare/clef-flash', apiKey: 'PRIVATE_KEY', capabilities: text, fetch: fetcher });
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
    const client = new DecisionClient({ provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', modelId: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text, fetch: fetcher, timeoutMs: 10 });
    await client.prepare({ signal: signal() });
    const controller = new AbortController(); const pending = client.evaluate(request, { signal: controller.signal });
    await started; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'decision-cancelled' });
    await expect(client.evaluate(request, { signal: signal() })).rejects.toMatchObject({ code: 'decision-timeout' }); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects unsupported API roots and missing keys without exposing credentials', () => {
    expect(() => new DecisionClient({ provider: 'openrouter', baseURL: 'https://example.test/v1', modelId: 'cloudflare/clef-flash', apiKey: 'test', capabilities: text })).toThrow('base URL');
    expect(() => new DecisionClient({ provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', modelId: 'cloudflare/clef-flash', capabilities: text })).toThrow('API key');
  });
});

describe('UI-ready prompt injection', () => {
  it('takes a copied instruction config, records its version/hash, and keeps candidates constrained', async () => {
    const prompt = { id: 'custom-speech', version: '2', instructions: 'CUSTOM_INSTRUCTION' };
    const client = new FakeSystemOneClient(['key:Enter']); const model = new SystemOneChoiceModel(client, prompt); prompt.instructions = 'MUTATED';
    const result = await model.choose({ state: { goal: 'Start' }, choices: [{ id: 'key:Enter', label: 'Enter' }] }, { signal: signal() });
    expect(client.requests[0]?.instructions).toBe('CUSTOM_INSTRUCTION'); expect(result.prompt).toEqual({ id: 'custom-speech', version: '2', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.prompt?.sha256).not.toBe(systemOnePromptEvidence(SPEECH_DECISION_PROMPT, [{ id: 'key:Enter', label: 'Enter' }]).sha256);
    expect(JSON.stringify(result)).not.toContain('CUSTOM_INSTRUCTION');
    const policy = new SpeechDecisionPolicy(new SystemOneChoiceModel(new FakeSystemOneClient(['key:Enter'])));
    await policy.decide({ goal: 'Start', observation: { kind: 'screenreader', speech: ['Start, button'], outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'test' } }, history: [], allowedActions: { intents: [], keys: ['Enter'], inputKeys: [], replaceText: false }, inputs: {}, signal: signal() });
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ prompt: expect.objectContaining({ id: 'rawstep-speech-decision', version: '1' }) })]);
    expect(() => new SystemOneChoiceModel(new FakeSystemOneClient([]), { id: 'bad', version: '1', instructions: '' })).toThrow('prompt');
  });
});
