import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chooseCandidate, createLlmModel, generateStructured } from '@rawstep/policies/llm';
import { LlmChoiceClient } from '../packages/dashboard/src/server/llm.js';
import { defaultInstructions, type Connection, type Model } from '../packages/dashboard/src/shared/config.js';

const BASE = 'http://127.0.0.1:1/v1';
const reply = (content: unknown, extra: Record<string, unknown> = {}, finish = 'stop') => Response.json({ id: 'r', created: 1, model: 'fixture', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }], ...extra });
function recorder(respond: (body: any, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init!.body));
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init!.headers).entries()), body });
    return respond(body, init!);
  };
  return { calls, fetcher };
}
const candidates = [{ id: 'key:Tab', label: 'Tab' }, { id: 'stop:success', label: 'Stop' }];
const llm = (fetcher: typeof fetch, extra: Partial<Parameters<typeof createLlmModel>[0]> = {}) => createLlmModel({ baseURL: BASE, modelId: 'fixture', apiKey: 'sk-secret-key', fetch: fetcher, ...extra });

describe('shared AI SDK LLM module', () => {
  it('sends an OpenAI-compatible JSON request with the key and screenshots as image parts', async () => {
    const { calls, fetcher } = recorder(() => reply({ choiceId: 'key:Tab' }));
    const result = await chooseCandidate({ model: llm(fetcher), system: 'Pick wisely.', state: { goal: 'g' }, candidates, images: ['QUJD', 'REVG'] });
    expect(result).toEqual({ choiceId: 'key:Tab', modelId: 'fixture' });
    const { url, headers, body } = calls[0]!;
    expect(url).toBe(BASE + '/chat/completions'); expect(headers.authorization).toBe('Bearer sk-secret-key');
    expect(body).toMatchObject({ model: 'fixture', response_format: { type: 'json_object' } });
    expect(body.messages[0]).toMatchObject({ role: 'system' }); expect(body.messages[0].content).toContain('Pick wisely.'); expect(body.messages[0].content).toContain('Select only an ID');
    const parts = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(JSON.parse(parts[0]!.text!)).toEqual({ state: { goal: 'g' }, candidates });
    expect(parts.slice(1).map(p => p.image_url!.url)).toEqual(['data:image/png;base64,QUJD', 'data:image/png;base64,REVG']);
  });
  it('sends text-only state as plain text and validates structured output with a zod schema', async () => {
    const { calls, fetcher } = recorder(() => reply({ n: 3 }));
    const schema = z.object({ n: z.number() });
    expect((await generateStructured({ model: llm(fetcher), system: 'Return {"n":number}.', user: 'hello', schema })).object).toEqual({ n: 3 });
    expect(typeof calls[0]!.body.messages[1].content === 'string' ? calls[0]!.body.messages[1].content : calls[0]!.body.messages[1].content[0].text).toBe('hello');
    const wrong = recorder(() => reply({ n: 'three' }));
    await expect(generateStructured({ model: llm(wrong.fetcher), system: 's', user: 'u', schema })).rejects.toMatchObject({ code: 'llm-failed' });
  });
  it.each([
    ['unknown candidate', () => reply({ choiceId: 'key:Escape' })],
    ['invalid JSON', () => reply('PRIVATE_BODY not json')],
    ['truncated answer', () => reply({ choiceId: 'key:Tab' }, {}, 'length')],
    ['switched model', () => reply({ choiceId: 'key:Tab' }, { model: 'other-model' })],
    ['echoed key', () => reply({ choiceId: 'key:Tab', note: 'sk-secret-key' })],
    ['HTTP error', () => new Response('PRIVATE_BODY sk-secret-key', { status: 500 })],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'http://evil.example/' } })],
  ])('rejects %s with a fixed error that never carries provider text', async (_name, respond) => {
    const { fetcher } = recorder(respond);
    const error = await chooseCandidate({ model: llm(fetcher), system: 's', state: {}, candidates }).catch((e: unknown) => e) as Error & { code?: string };
    expect(error).toMatchObject({ name: 'RawstepError', code: 'llm-failed' });
    expect(`${error.message} ${JSON.stringify(error.cause ?? '')}`).not.toMatch(/PRIVATE_BODY|sk-secret-key|evil\.example/);
  });
  it('never retries and refuses redirects', async () => {
    let seen = 0, redirect: RequestRedirect | undefined;
    const fetcher: typeof fetch = async (_url, init) => { seen++; redirect = init!.redirect; return new Response('busy', { status: 503 }); };
    await expect(chooseCandidate({ model: llm(fetcher), system: 's', state: {}, candidates })).rejects.toMatchObject({ code: 'llm-failed' });
    expect(seen).toBe(1); expect(redirect).toBe('error');
  });
  it('combines the caller signal with the timeout and tells them apart', async () => {
    const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { if (init!.signal!.aborted) reject(new Error('PRIVATE_TRANSPORT')); init!.signal!.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT')), { once: true }); });
    await expect(chooseCandidate({ model: llm(hang, { timeoutMs: 20 }), system: 's', state: {}, candidates })).rejects.toMatchObject({ code: 'llm-timeout' });
    const controller = new AbortController(), pending = chooseCandidate({ model: llm(hang), system: 's', state: {}, candidates, signal: controller.signal });
    controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'llm-cancelled' });
    const done = new AbortController(); done.abort();
    await expect(chooseCandidate({ model: llm(hang), system: 's', state: {}, candidates, signal: done.signal })).rejects.toMatchObject({ code: 'llm-cancelled' });
  });
  it('requires a safe base URL and an explicit model', () => {
    expect(() => createLlmModel({ baseURL: 'http://example.com/v1', modelId: 'm' })).toThrow('HTTPS');
    expect(() => createLlmModel({ baseURL: 'https://user:pw@example.com/v1', modelId: 'm' })).toThrow();
    expect(() => createLlmModel({ baseURL: BASE, modelId: ' ' })).toThrow('model ID');
    expect(() => createLlmModel({ baseURL: 'https://openrouter.ai/api/v1', modelId: 'm' })).not.toThrow();
  });
});

describe('dashboard LlmChoiceClient', () => {
  const connection: Connection = { id: 'c', name: 'c', provider: 'openai', baseURL: BASE, timeoutMs: 5000 };
  const model: Model = { id: 'm', connectionId: 'c', modelId: 'fixture', name: 'm', family: 'LLM', protocol: 'chat', inputs: ['text', 'image'], capabilitySource: 'manual', maxChoices: 255, maxImages: 2, roles: ['decision'], promptEditable: true };
  const prompt = { id: 'baseline', name: 'b', version: '1', instructions: defaultInstructions.keyboard };
  it('returns the choice with model and prompt evidence', async () => {
    const { fetcher } = recorder(() => reply({ choiceId: 'stop:success' }));
    const answer = await new LlmChoiceClient(connection, model, prompt, 'sk-secret-key', fetcher).choose({ goal: 'g' }, candidates, [], new AbortController().signal);
    expect(answer).toMatchObject({ choiceId: 'stop:success', model: { id: 'fixture', requestedId: 'fixture', runtime: 'openai-compatible-generative-choice' }, prompt: { id: 'baseline', version: '1' } });
    expect(answer.prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('shows only the Korean fixed message for provider failures and passes cancellation through', async () => {
    const { fetcher } = recorder(() => reply({ choiceId: 'key:Tab', leaked: 'sk-secret-key' }));
    const client = new LlmChoiceClient(connection, model, prompt, 'sk-secret-key', fetcher);
    const error = await client.choose({}, candidates, [], new AbortController().signal).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/^LLM 선택 실패/); expect((error as Error).message).not.toContain('sk-secret-key');
    const cancelled = new AbortController(); cancelled.abort(new Error('stopped'));
    await expect(client.choose({}, candidates, [], cancelled.signal)).rejects.toThrow('stopped');
  });
});
