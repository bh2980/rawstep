import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DecisionClient, SystemOneChoiceModel } from '@rawstep/policies/systemone';
import { SpeechDecisionPolicy } from '@rawstep/policies/policy';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { readTrace } from '@rawstep/core/trace';
import { createTestBrowserSession } from './helpers/browser.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it.each(['systemone-http', 'openrouter-systemone'] as const)('runs %s → speech → keys → verifier → prompt trace in one Chrome (fake HTTP model)', async provider => {
  const calls: any[] = [], choices = ['key:Tab', 'key:Enter'];
  const model = provider === 'openrouter-systemone' ? 'typesafe/jev-1.13' : 'fixture-decision';
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    res.setHeader('content-type', 'application/json');
    if (!body) { res.end(JSON.stringify({ data: [{ id: model, canonical_slug: model,
      architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] })); return; }
    calls.push({ path: req.url, body });
    const choice = choices[calls.length - 1];
    res.end(JSON.stringify({ model: body.model, answers: { next: { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(body.questions.next.criteria).map(id => [id, id === choice ? 1 : 0])) } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const out = await mkdtemp(join(tmpdir(), 'rawstep-systemone-chrome-')); cleanup.push(() => rm(out, { recursive: true, force: true }));
  const page = join(out, 'page.html');
  await writeFile(page, '<!doctype html><title>Before</title><button onclick="document.title=&quot;Completed&quot;">Start</button>');
  let launches = 0, closes = 0;
  const client = new DecisionClient({ provider: provider === 'openrouter-systemone' ? 'openrouter' : 'custom', baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`, modelId: model, apiKey: 'FAKE_HTTP_ONLY', capabilities: { maxChoices: 255 } });
  await client.prepare({ signal: AbortSignal.timeout(10000) });
  const finished = await runMockVoiceOverTask({ url: pathToFileURL(page).href, goal: 'Press Start', verify: { all: [{ titleIncludes: 'Completed' }] } }, {
    outDir: join(out, 'run'), warn: () => {}, policy: new SpeechDecisionPolicy(new SystemOneChoiceModel(client)), browserSessionFactory: async (url, browserOptions) => {
      launches++; const session = await createTestBrowserSession(url, browserOptions); const close = session.close;
      return { ...session, close: async () => { await close(); closes++; } };
    } });
  expect(finished.outcome?.status).toBe('success');
  expect(launches).toBe(1); expect(closes).toBe(1); expect(calls).toHaveLength(2);
  expect(calls.every(call => call.path === '/api/v1/systemone' && Array.isArray(call.body.state.speech))).toBe(true);
  expect(JSON.stringify(calls)).not.toMatch(/FAKE_HTTP_ONLY|titleIncludes|selector|domEvents|"verify"|image/);
  const trace = await readTrace(join(out, 'run'));
  expect(trace.outcome?.status).toBe('success'); expect(trace.endedAt).toBeTruthy();
  const evidence = trace.events.filter(event => event.type === 'policy.evidence');
  expect(evidence).toHaveLength(2);
  const details = evidence.map(event => (event.data as { evidence?: { model?: { runtime?: string }; prompt?: { version?: string } } })?.evidence);
  expect(details.every(detail => detail?.model?.runtime === (provider === 'openrouter-systemone' ? 'openrouter-systemone-http' : 'systemone-http') && detail?.prompt?.version === '1')).toBe(true);
  expect(await readFile(join(out, 'run', 'trace.json'), 'utf8')).not.toContain('FAKE_HTTP_ONLY');
});
