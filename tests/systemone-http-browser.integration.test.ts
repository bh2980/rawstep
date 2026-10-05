import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveTask } from '@rawstep/core/contracts';
import { DecisionClient, SystemOneScreenshotAdapter } from '@rawstep/policies/systemone';
import { ScreenshotDecisionPolicy } from '@rawstep/policies/screenshot/policy';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { readTrace } from '@rawstep/core/trace';
import { createTestBrowserSession } from './helpers/browser.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it.each(['systemone-http', 'openrouter-systemone'] as const)('runs %s → PNG → keyboard → verifier → prompt trace in one Chrome (fake HTTP model)', async provider => {
  const calls: any[] = [], choices = ['key:Tab', 'key:Tab', 'key:Enter'];
  const model = provider === 'openrouter-systemone' ? 'cloudflare/clef-flash' : 'fixture-multimodal';
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    res.setHeader('content-type', 'application/json');
    if (!body) { res.end(JSON.stringify({ data: [{ id: model, canonical_slug: model,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['decisions'] } }] })); return; }
    calls.push({ path: req.url, body });
    const choice = choices[calls.length - 1];
    res.end(JSON.stringify({ model: body.model, answers: { next: { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(body.questions.next.criteria).map(id => [id, id === choice ? 1 : 0])) } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const out = await mkdtemp(join(tmpdir(), 'rawstep-multimodal-chrome-')); cleanup.push(() => rm(out, { recursive: true, force: true }));
  let launches = 0, closes = 0;
  const errors: string[] = [];
  const options = { baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`, modelId: model, apiKey: 'FAKE_HTTP_ONLY', capabilities: { inputs: ['text', 'image'] as ('text' | 'image')[], maxChoices: 255, maxImages: 2 } };
  const client = new DecisionClient({ ...options, provider: provider === 'openrouter-systemone' ? 'openrouter' : 'custom' });
  await client.prepare({ signal: AbortSignal.timeout(10000) });
  const task = resolveTask(JSON.parse(await readFile('examples/screenshot/openrouter-task.json', 'utf8')), resolve('examples/screenshot'));
  const finished = await runScreenshotTask(task, { outDir: out, policy: new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(client) }), browserSessionFactory: async (url, browserOptions) => {
    launches++; const session = await createTestBrowserSession(url, browserOptions); const close = session.close;
    return { ...session, close: async () => { await close(); closes++; } };
  } });
  expect(finished.outcome?.status, errors.join('')).toBe('success');
  expect(launches).toBe(1); expect(closes).toBe(1); expect(calls).toHaveLength(3);
  expect(calls.every(call => call.path === '/api/v1/systemone')).toBe(true);
  const images = (body: any) => provider === 'openrouter-systemone' ? body.state.filter((part: any) => part.type === 'image_url').map((part: any) => part.image_url.url) : body.media.map((part: any) => part.data);
  expect(calls.every(call => images(call.body).length >= 1)).toBe(true);
  expect(images(calls[1].body)).toHaveLength(2);
  expect(images(calls[1].body)[1]).toBe(images(calls[0].body)[0]);
  expect(JSON.stringify(calls)).not.toMatch(/FAKE_HTTP_ONLY|textVisibleExact|selector|domEvents|"verify"/);
  const trace = await readTrace(out);
  expect(trace.outcome?.status).toBe('success'); expect(trace.endedAt).toBeTruthy();
  const evidence = trace.events.filter(event => event.type === 'policy.evidence');
  expect(evidence).toHaveLength(3);
  const details = evidence.map(event => (event.data as { evidence?: { model?: { runtime?: string }; prompt?: { version?: string } } })?.evidence);
  expect(details.every(detail => detail?.model?.runtime === (provider === 'openrouter-systemone' ? 'openrouter-systemone-http' : 'systemone-http') && detail?.prompt?.version === '1')).toBe(true);
  expect(await readFile(join(out, 'trace.json'), 'utf8')).not.toContain('FAKE_HTTP_ONLY');
});
