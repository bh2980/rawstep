import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLlmModel, generateStructured, LlmPlanner } from '@rawstep/policies/llm';

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
const pick = z.object({ choiceId: z.enum(['key:Tab', 'stop:success']) });
/** One structured call whose reply must be a `pick`: the cases below only differ in what the server answers. */
const ask = (model: ReturnType<typeof createLlmModel>, extra: Partial<Parameters<typeof generateStructured>[0]> = {}) => generateStructured({ model, system: 's', user: '{}', schema: pick, ...extra });
const llm = (fetcher: typeof fetch, extra: Partial<Parameters<typeof createLlmModel>[0]> = {}) => createLlmModel({ baseURL: BASE, modelId: 'fixture', apiKey: 'sk-secret-key', fetch: fetcher, ...extra });

describe('shared AI SDK LLM module', () => {
  it('sends an OpenAI-compatible JSON request with the key and the state as text', async () => {
    const { calls, fetcher } = recorder(() => reply({ choiceId: 'key:Tab' }));
    const result = await generateStructured({ model: llm(fetcher), system: 'Pick wisely.', user: JSON.stringify({ state: { goal: 'g' } }), schema: pick });
    expect(result).toEqual({ object: { choiceId: 'key:Tab' }, modelId: 'fixture' });
    const { url, headers, body } = calls[0]!;
    expect(url).toBe(BASE + '/chat/completions'); expect(headers.authorization).toBe('Bearer sk-secret-key');
    expect(body).toMatchObject({ model: 'fixture', response_format: { type: 'json_object' } });
    expect(body.messages[0]).toMatchObject({ role: 'system' }); expect(body.messages[0].content).toContain('Pick wisely.');
    expect(JSON.parse(typeof body.messages[1].content === 'string' ? body.messages[1].content : body.messages[1].content[0].text)).toEqual({ state: { goal: 'g' } });
  });
  it('asks once more when a reply has the wrong shape, saying what was wrong, and records why when the second reply fails too', async () => {
    const schema = z.object({ n: z.number() });
    let sent = 0;
    const once = recorder(() => reply(sent++ === 0 ? { n: 'three' } : { n: 3 }));
    expect(await generateStructured({ model: llm(once.fetcher), system: 's', user: 'u', schema })).toMatchObject({ object: { n: 3 }, retried: { kind: 'schema', issues: [{ path: 'n' }], reply: '{"n":"three"}' } });
    expect(once.calls).toHaveLength(2);
    expect(JSON.stringify(once.calls[1]!.body.messages[1].content)).toContain('did not match the required shape: n:');
    const twice = recorder(() => reply({ n: 'three' }));
    const failed = await generateStructured({ model: llm(twice.fetcher), system: 's', user: 'u', schema }).catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: 'llm-failed', detail: { modelFailure: { kind: 'schema', issues: [{ path: 'n' }], reply: '{"n":"three"}' } } });
    expect(twice.calls).toHaveLength(2);
    // A reply that echoes the credential is neither kept nor asked again.
    const echo = recorder(() => reply({ n: 'sk-secret-key' }));
    const leaked = await generateStructured({ model: llm(echo.fetcher), system: 's', user: 'u', schema }).catch((error: unknown) => error) as { detail?: unknown };
    expect(leaked.detail).toEqual({ modelFailure: { kind: 'credential-echoed' } });
    expect(echo.calls).toHaveLength(1);
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
    ['unknown value', () => reply({ choiceId: 'key:Escape' })],
    ['invalid JSON', () => reply('PRIVATE_BODY not json')],
    ['truncated answer', () => reply({ choiceId: 'key:Tab' }, {}, 'length')],
    ['switched model', () => reply({ choiceId: 'key:Tab' }, { model: 'other-model' })],
    ['echoed key', () => reply({ choiceId: 'key:Tab', note: 'sk-secret-key' })],
    ['HTTP error', () => new Response('PRIVATE_BODY sk-secret-key', { status: 500 })],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'http://evil.example/' } })],
  ])('rejects %s with a fixed error that never carries provider text', async (_name, respond) => {
    const { fetcher } = recorder(respond);
    const error = await ask(llm(fetcher), { strictModel: true }).catch((e: unknown) => e) as Error & { code?: string };
    expect(error).toMatchObject({ name: 'RawstepError', code: 'llm-failed' });
    expect(`${error.message} ${JSON.stringify(error.cause ?? '')}`).not.toMatch(/PRIVATE_BODY|sk-secret-key|evil\.example/);
  });
  it('never retries and refuses redirects', async () => {
    let seen = 0, redirect: RequestRedirect | undefined;
    const fetcher: typeof fetch = async (_url, init) => { seen++; redirect = init!.redirect; return new Response('busy', { status: 503 }); };
    await expect(ask(llm(fetcher))).rejects.toMatchObject({ code: 'llm-failed' });
    expect(seen).toBe(1); expect(redirect).toBe('error');
  });
  it('combines the caller signal with the timeout and tells them apart', async () => {
    const hang: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { if (init!.signal!.aborted) reject(new Error('PRIVATE_TRANSPORT')); init!.signal!.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT')), { once: true }); });
    await expect(ask(llm(hang, { timeoutMs: 20 }))).rejects.toMatchObject({ code: 'llm-timeout' });
    const controller = new AbortController(), pending = ask(llm(hang), { signal: controller.signal });
    controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'llm-cancelled' });
    const done = new AbortController(); done.abort();
    await expect(ask(llm(hang), { signal: done.signal })).rejects.toMatchObject({ code: 'llm-cancelled' });
  });
  it('requires a safe base URL and an explicit model', () => {
    expect(() => createLlmModel({ baseURL: 'http://example.com/v1', modelId: 'm' })).toThrow('HTTPS');
    expect(() => createLlmModel({ baseURL: 'https://user:pw@example.com/v1', modelId: 'm' })).toThrow();
    expect(() => createLlmModel({ baseURL: BASE, modelId: ' ' })).toThrow('model ID');
    expect(() => createLlmModel({ baseURL: 'https://openrouter.ai/api/v1', modelId: 'm' })).not.toThrow();
  });
});

describe('LlmPlanner', () => {
  const request = { goal: 'Add Thor Hammer to the cart', trigger: 'start' as const, speech: ['Toolshop, heading level 1'], actions: [{ id: 'intent:next', label: 'Screen reader intent: next' }], attempts: [], effort: { moves: 0, sinceLastLook: 0, withoutGoalWords: 0, longestWithoutGoalWords: 0 } };
  it('sends the plan request as JSON and returns a validated draft with versioned prompt evidence', async () => {
    const draft = { complete: false, rationale: '', strategy: 'Search, then open the product', criteria: [{ id: 'C1', text: 'The product page title is heard' }], assumptions: [{ id: 'A1', text: 'There is a search field' }], phases: [{ title: 'Find the product', criteria: ['C1'], tasks: [{ goal: 'Move to the search field', done: 'Hear "Search, edit text"', cue: 'Search, edit text', serves: ['C1'], relies: ['A1'] }] }] };
    const { calls, fetcher } = recorder(() => reply(draft));
    const result = await new LlmPlanner(llm(fetcher)).plan(request, { signal: new AbortController().signal });
    expect(result).toEqual({ draft, model: { id: 'fixture', runtime: 'openai-compatible-generative-plan' }, prompt: { id: 'rawstep-planner', version: expect.stringMatching(/^[0-9a-f]{12}$/), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    const system = (body: { messages: { role: string; content: unknown }[] }) => JSON.stringify(body.messages);
    expect(system(calls[0]!.body)).not.toContain('Additional instructions');
    expect(JSON.stringify(calls[0]!.body)).toContain('Screen reader intent: next');
    const extra = recorder(() => reply(draft));
    const custom = await new LlmPlanner(llm(extra.fetcher), 'Plan like an expert screen reader user.').plan(request, { signal: new AbortController().signal });
    expect(system(extra.calls[0]!.body)).toContain('Additional instructions:\\nPlan like an expert screen reader user.');
    expect(custom.prompt!.sha256).not.toBe(result.prompt!.sha256);
    expect(JSON.stringify(calls[0]!.body)).toContain('Thor Hammer');
  });
  it('tells the planner to keep moving and pressing apart and to give typing its own task, since Rawstep carries the plan out as written', () => {
    const { instructions } = new LlmPlanner(llm(recorder(() => reply({})).fetcher));
    expect(instructions).toContain('Keep moving and pressing in separate tasks.');
    expect(instructions).toContain('"types"');
    expect(instructions).toContain('Rawstep carries out your plan one task at a time, exactly as written');
  });
  it('rejects a draft of the wrong shape', async () => {
    const { fetcher } = recorder(() => reply({ complete: false, steps: [{ goal: 'no done cue' }] }));
    await expect(new LlmPlanner(llm(fetcher)).plan(request, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'llm-failed' });
  });
});
