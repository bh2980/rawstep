import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { buildModel, defaultConfig, defaultProfile, defaultModes, type ProjectConfig } from '@rawstep/project/config';
import { TraceRecorder } from '@rawstep/core/trace';
import type { Experiment, ConfigView, PlanRequest } from '../packages/dashboard/src/shared/config.js';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { RunEventMessage, RunHintsView, RunStepsView } from '../packages/dashboard/src/shared/api.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-dashboard-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  for (const id of ['a', 'b']) config.models.push({ id, kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', name: id, modelId: id, inputs: ['text', 'image'], capabilitySource: 'manual', maxChoices: 255, maxImages: 2, roles: ['decision'], timeoutMs: 10000 });
  const modes = defaultModes(); modes.keyboard.prompts.push({ id: 'careful', name: 'Careful', version: '2', instructions: 'Careful fixture instructions' });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json', modes }); return config;
}
const request: PlanRequest = { taskIds: ['task'], modelIds: ['a', 'b'], promptIds: ['baseline', 'careful'], profileIds: ['default'], repeats: 1, mode: 'keyboard' };
async function waitFor(work: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); }
describe('dashboard persistence', () => {
  it('detects changes to external task files before saving or executing', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize();
    const saved = await store.save(setup(), initial.revision, { file: 'task.json', task });
    await writeFile(join(dir, 'task.json'), JSON.stringify({ ...task, goal: 'Externally changed' }));
    await expect(store.save(saved.config, saved.revision)).rejects.toMatchObject({ status: 409 });
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    await expect(app.queue.create({ ...request, revision: saved.revision })).rejects.toMatchObject({ status: 409 });
  });
});
describe('dashboard API and sequential queue', () => {
  it('creates rawstep.config.json for a new project and answers project errors with their status and Korean text', async () => {
    const dir = await root(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const config = JSON.parse(await readFile(join(dir, 'rawstep.config.json'), 'utf8')) as ProjectConfig;
    expect(config.version).toBe(1);
    const post = (path: string, method: string, body: unknown) => fetch(app.url + path, { method, headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const stale = await post('/api/config', 'PUT', { config, revision: 'stale' });
    expect(stale.status).toBe(409); expect(((await stale.json()) as { error: string }).error).toContain('변경');
    const lost = await post('/api/discover', 'POST', { kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' });
    expect(lost.status).toBe(502); expect(((await lost.json()) as { error: string }).error).toContain('연결할 수 없습니다');
    const missing = await post('/api/tasks/import', 'POST', { file: 'nothing.json' });
    expect(missing.status).toBe(404);
    const outside = await post('/api/tasks/import', 'POST', { file: '../outside.json' });
    expect(outside.status).toBe(400); expect(((await outside.json()) as { error: string }).error).toContain('프로젝트 내부');
  });
  it('runs a two-by-two matrix, snapshots settings, saves real trace files and restores history', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    let active = 0, maxActive = 0; const seen: unknown[] = [];
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web'), execute: async (run, actualTask, outDir, _key, signal) => {
      active++; maxActive = Math.max(active, maxActive); seen.push({ task: structuredClone(actualTask), prompt: run.snapshot.prompt.instructions });
      await new Promise(r => setTimeout(r, 15)); signal.throwIfAborted();
      const trace = new TraceRecorder({ ...actualTask, id: actualTask.id ?? 'fixture' }, outDir); await trace.initialize(); trace.append('fixture.policy', { instructions: run.snapshot.prompt.instructions }, { source: 'policy' });
      active--; return trace.finalize({ status: 'success', reason: 'test-double-only', steps: 1 });
    } }); apps.push(app);
    const response = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(request) });
    expect(response.status).toBe(201); const experiment = await response.json() as Experiment; expect(experiment.runs).toHaveLength(4);
    const current = await store.read(); const emptied = structuredClone(current.config); emptied.profiles[0]!.permissions.keyboard.keys = []; await store.save(emptied, current.revision);
    await waitFor(async () => { const durable = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment; return durable.runs.every(r => r.state === 'success' && !!r.endedAt); });
    expect(maxActive).toBe(1); expect(seen).toHaveLength(4); expect(JSON.stringify(seen)).toContain('private-value');
    const saved = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment;
    expect(JSON.stringify(saved)).not.toContain('private-value'); expect(saved.runs.every(r => r.permissions.keys.includes('Tab'))).toBe(true);
    expect(saved.runs.every(r => r.reportStatus === 'complete')).toBe(true);
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const restarted = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(restarted);
    expect(restarted.queue.experiments[0]!.runs.every(r => r.state === 'success')).toBe(true);
    const state = await (await fetch(restarted.url + '/api/state')).json() as ConfigView; expect(state.config.profiles[0]!.permissions.keyboard.keys).toEqual([]);
    expect(await (await fetch(restarted.url)).text()).toContain('Rawstep');
  });
  it('serves blob-backed screenshots from the run directory and embeds them in the run report', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('dashboard-pixels')]);
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture', mode: 'keyboard' }, out); await trace.initialize();
      trace.append('keyboard.observation', { screenshot: { pngBase64: png.toString('base64'), viewport: { w: 2, h: 2 } } }, { source: 'runner' });
      return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, modelIds: ['a'], promptIds: ['baseline'] }) });
    const experiment = await created.json() as Experiment, run = experiment.runs[0]!;
    await waitFor(async () => app.queue.find(experiment.id, run.id).reportStatus === 'complete');
    const base = app.url + '/api/experiments/' + experiment.id + '/runs/' + run.id;
    const events = await (await fetch(base + '/events')).json() as { id: string; data: { screenshot: Record<string, unknown> } }[];
    const shot = events.find(e => e.data?.screenshot)!;
    expect(shot.data.screenshot).toMatchObject({ blob: expect.stringMatching(/^blobs\/[a-f0-9]{64}\.png$/), viewport: { w: 2, h: 2 } });
    expect(JSON.stringify(events)).not.toContain(png.toString('base64'));
    const image = await fetch(base + '/png/' + shot.id);
    expect(image.headers.get('content-type')).toBe('image/png'); expect(Buffer.from(await image.arrayBuffer()).equals(png)).toBe(true);
    expect((await fetch(base + '/png/event-999999')).status).toBe(404);
    const report = await (await fetch(base + '/report')).text();
    expect(report).toContain('data:image/png;base64,' + png.toString('base64')); expect(report).not.toContain('src="blobs/');
  });
  it('rejects foreign Origin and unsupported modes before queue acquisition', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); const config = setup(); config.models[0]!.inputs = ['text']; config.models[0]!.maxImages = 0;
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(app);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://foreign.example' } })).status).toBe(403);
    // The same server opened as localhost sends that origin for module scripts; another loopback port is still foreign.
    const port = Number(new URL(app.url).port);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + port } })).status).toBe(200);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + (port === 65535 ? 1 : port + 1) } })).status).toBe(403);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://localhost:' + port } })).status).toBe(403);
    const plan = await app.queue.plan(request);
    expect(plan.rows.filter(r => r.modelId === 'a').every(r => !r.supported && r.reason!.includes('이미지'))).toBe(true);
    await expect(app.queue.create(request)).rejects.toMatchObject({ status: 400 });
    expect(app.queue.experiments).toHaveLength(0);
  });
  it('cancels the active run and queued siblings without starting them', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    let calls = 0;
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web'), execute: async (_run, _task, _out, _key, signal) => {
      calls++; await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); throw new Error('Unreachable');
    } }); apps.push(app);
    const e = await app.queue.create(request); await waitFor(async () => calls === 1);
    await app.queue.cancel(e.id); await waitFor(async () => e.runs.every(r => r.state === 'cancelled'));
    expect(calls).toBe(1);
  });
  it('retries pinned public conditions with fresh inputs after config changes', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize();
    await store.save(setup(), initial.revision, { file: 'task.json', task });
    const seen: { goal: string; input: unknown; model: string; prompt: string }[] = [];
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
      seen.push({ goal: actual.goal, input: actual.input, model: run.snapshot.model.modelId, prompt: run.snapshot.prompt.instructions });
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const e = await app.queue.create({ ...request, modelIds: ['a'], promptIds: ['careful'] }); await waitFor(async () => !!e.runs[0]!.endedAt);
    const before = await store.read(); before.config.models[0]!.modelId = 'changed-model'; before.config.tasks[0]!.modes.keyboard.prompts[1]!.instructions = 'Changed instructions';
    await store.save(before.config, before.revision, { file: 'task.json', task: { ...task, goal: 'changed goal', input: { email: 'NEW_PRIVATE_INPUT' } } });
    const preview = await app.queue.previewRetry(e.id, e.runs[0]!.id); expect(preview.changedFields).toContain('goal'); expect(JSON.stringify(preview)).not.toContain('NEW_PRIVATE_INPUT');
    await expect(app.queue.retry(e.id, e.runs[0]!.id, 'stale')).rejects.toMatchObject({ status: 409 });
    const retried = await app.queue.retry(e.id, e.runs[0]!.id, preview.revision); await waitFor(async () => !!retried.runs[0]!.endedAt);
    expect(seen[1]).toEqual({ goal: task.goal, input: { email: 'NEW_PRIVATE_INPUT' }, model: 'a', prompt: 'Careful fixture instructions' });
    expect(JSON.stringify(retried)).not.toContain('NEW_PRIVATE_INPUT'); expect(retried.runs[0]!.retryOf?.run).toBe(e.runs[0]!.id);
  });
  it('stores keys by provider or custom model, reports their status without values and marks runs whose key is missing', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.models[0]!.apiKeyEnv = 'RAWSTEP_TEST_DASH_KEY';
    config.models.push(buildModel({ id: 'jev', name: 'jev', kind: 'decision', provider: 'typesafe', modelId: 'jev-latest', inputs: ['text', 'image'] }));
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const post = (path: string, body: unknown) => fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const keyless = await app.queue.plan({ ...request, modelIds: ['jev'], promptIds: ['baseline'] });
    expect(keyless.rows[0]).toMatchObject({ supported: false, reason: expect.stringContaining('인증키') });
    expect((await post('/api/credentials', { provider: 'typesafe', value: 'sk-ts-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { modelId: 'a', value: 'sk-a-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { provider: 'custom', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { modelId: 'b', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { modelId: 'ghost', value: 'x' })).status).toBe(404);
    expect((await post('/api/credentials', { connectionId: 'a', value: 'x' })).status).toBe(400);
    const text = await (await fetch(app.url + '/api/state')).text(), view = JSON.parse(text) as ConfigView;
    expect(view.credentialStatus).toMatchObject({ 'provider:typesafe': true, 'model:a': true });
    expect(text).not.toContain('sk-ts-secret'); expect(text).not.toContain('sk-a-secret');
    expect((await app.queue.plan({ ...request, modelIds: ['jev'], promptIds: ['baseline'] })).rows[0]).toMatchObject({ supported: true });
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('RAWSTEP_TYPESAFE_API_KEY="sk-ts-secret"');
  });
  it('pins the analysis model and preserves success when analysis fails', async () => {
    let sent: { messages: { content: string }[] } | undefined;
    const server = createServer((req, res) => { void (async () => { let body = ''; for await (const part of req) body += part; sent = JSON.parse(body); res.writeHead(503); res.end('PRIVATE_PROVIDER_ERROR'); })(); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.models.push({ ...config.models[0]!, id: 'analysis', kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port, modelId: 'analyzer', roles: ['analysis'], timeoutMs: 1000 });
    config.profiles[0]!.analysisInstructions = 'Global comparison focus';
    await store.save(config, initial.revision, { file: 'task.json', task });
    try {
      const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
        const changed = await store.read(); changed.config.models.find(m => m.id === 'analysis')!.baseURL = 'http://127.0.0.1:1'; await store.save(changed.config, changed.revision);
        const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
      } }); apps.push(app);
      const e = await app.queue.create({ ...request, modelIds: ['a'], promptIds: ['baseline'], analysisModelId: 'analysis' }); await waitFor(async () => !!e.runs[0]!.endedAt);
      expect(sent?.messages[0]!.content).toContain('Global comparison focus');
      expect(e.runs[0]!.state).toBe('success'); expect(e.runs[0]!.analysisStatus).toBe('failed'); expect(e.runs[0]!.reportStatus).toBe('complete'); expect(JSON.stringify(e)).not.toContain('PRIVATE_PROVIDER_ERROR');
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
});
describe('dashboard run views and live events', () => {
  const png = (label: string) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]).toString('base64');
  /** One recorded run: a key per step, each followed by a distinct screenshot, ending with the given outcome. */
  const script = (keys: string[], status: 'success' | 'failure') => async (trace: TraceRecorder) => {
    trace.append('keyboard.observation', { screenshot: { pngBase64: png('start') } }, { source: 'runner' });
    keys.forEach((key, i) => {
      trace.append('policy.decision', { step: i + 1, decision: { action: { kind: 'key', key } } }, { source: 'policy' });
      trace.append('action.result', { step: i + 1, ok: true, action: { kind: 'key', key } });
      trace.append('keyboard.observation', { screenshot: { pngBase64: png('step' + i) } }, { source: 'runner' });
    });
    return { status, steps: keys.length };
  };
  async function launch(scripts: (((trace: TraceRecorder) => Promise<{ status: 'success' | 'failure'; steps: number }>) | 'throw')[]) {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const next = scripts.shift(); if (!next || next === 'throw') throw new Error('no trace');
      const trace = new TraceRecorder({ ...actual, id: 'fixture', mode: 'keyboard' }, out); await trace.initialize();
      return trace.finalize(await next(trace));
    } }); apps.push(app);
    const experiment = async (modelIds: string[], repeats = 1) => {
      const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, modelIds, promptIds: ['baseline'], repeats }) });
      const exp = await created.json() as Experiment;
      await waitFor(async () => exp.runs.every(r => app.queue.find(exp.id, r.id).reportStatus !== 'pending' && !!app.queue.find(exp.id, r.id).endedAt));
      return exp;
    };
    const get = (exp: Experiment, run: number, tail: string) => fetch(`${app.url}/api/experiments/${exp.id}/runs/${exp.runs[run]!.id}/${tail}`);
    return { app, experiment, get };
  }
  it('serves step views with screenshots, a missing trace as empty steps, and 404 for unknown runs', async () => {
    const { app, experiment, get } = await launch([script(['Tab', 'Enter'], 'success'), 'throw']);
    const ok = await experiment(['a']), broken = await experiment(['a']);
    const view = await (await get(ok, 0, 'steps')).json() as RunStepsView;
    expect(view).toMatchObject({ experimentId: ok.id, runId: ok.runs[0]!.id, live: false, modelKind: 'decision' });
    expect(Array.isArray(view.hints)).toBe(true);
    expect(view.steps.map(s => s.step)).toEqual([0, 1, 2]);
    expect(view.steps[1]).toMatchObject({ action: { kind: 'key', key: 'Tab' }, ok: true });
    expect(view.steps.every(s => /^[a-f0-9]{64}$/.test(s.screenshot!.sha256))).toBe(true);
    const image = await get(ok, 0, 'png/' + encodeURIComponent(view.steps[2]!.screenshot!.eventId));
    expect(image.status).toBe(200); expect(createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex')).toBe(view.steps[2]!.screenshot!.sha256);
    expect(await (await get(broken, 0, 'steps')).json()).toMatchObject({ steps: [], live: false });
    expect((await fetch(`${app.url}/api/experiments/${ok.id}/runs/${randomUUID()}/steps`)).status).toBe(404);
    expect((await fetch(`${app.url}/api/experiments/${randomUUID()}/runs/${randomUUID()}/hints`)).status).toBe(404);
  });
  it('compares hints with the shortest goal-reaching run of the same task across experiments', async () => {
    const { experiment, get } = await launch([script(['Tab', 'Tab', 'Tab', 'Tab'], 'failure'), 'throw', script(['Tab', 'Enter'], 'success'), script(['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success'), script(['Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success')]);
    const failed = await experiment(['a']), missing = await experiment(['a']);
    const none = await (await get(failed, 0, 'hints')).json() as RunHintsView;
    expect(none.referenceRun).toBeUndefined(); expect(none.reference).toBeUndefined(); expect(none.steps).toBe(4);
    const noTrace = await get(missing, 0, 'hints');
    expect(noTrace.status).toBe(404); expect((await noTrace.json() as { error: string }).error).toMatch(/추적/);
    const short = await experiment(['a']), slow = await experiment(['b']), middle = await experiment(['b']);
    const hints = await (await get(slow, 0, 'hints')).json() as RunHintsView;
    expect(hints.referenceRun).toEqual({ experimentId: short.id, runId: short.runs[0]!.id });
    expect(hints.reference).toMatchObject({ runId: expect.any(String), steps: 2, goalReached: true });
    expect(hints.hints.map(h => h.kind)).toContain('slow-run');
    expect((await (await get(middle, 0, 'hints')).json() as RunHintsView).referenceRun!.runId).toBe(short.runs[0]!.id);
    // The reference run itself is compared with the next shortest goal-reaching run, never with itself.
    expect((await (await get(short, 0, 'hints')).json() as RunHintsView).referenceRun!.runId).toBe(middle.runs[0]!.id);
  });
  it('broadcasts throttled run-event messages while a run records', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out, _key, _signal, onEvent) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture', mode: 'keyboard' }, out, { onEvent }); await trace.initialize();
      for (let i = 0; i < 40; i++) trace.append('fixture.event', { i }, { source: 'runner' });
      await new Promise(r => setTimeout(r, 400)); trace.append('fixture.event', { late: true }, { source: 'runner' });
      return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const controller = new AbortController(), received: { at: number; message: RunEventMessage }[] = [];
    const stream = await fetch(app.url + '/api/events', { signal: controller.signal }), reader = stream.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
    void (async () => { try { for (;;) {
      const { done, value } = await reader.read(); if (done) return; buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (block.startsWith('event: run-event\n')) received.push({ at: Date.now(), message: JSON.parse(block.split('data: ')[1]!) as RunEventMessage });
      }
    } } catch { /* aborted */ } })();
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, modelIds: ['a'], promptIds: ['baseline'] }) });
    const experiment = await created.json() as Experiment, run = experiment.runs[0]!;
    await waitFor(async () => app.queue.find(experiment.id, run.id).reportStatus === 'complete');
    await new Promise(r => setTimeout(r, 600)); controller.abort();
    // 40 events arrive at once, then one 400 ms later: a leading message, the latest pending one, then the late one.
    expect(received.length).toBeGreaterThanOrEqual(2); expect(received.length).toBeLessThanOrEqual(4);
    expect(received.every(({ message }) => message.experimentId === experiment.id && message.runId === run.id && typeof message.type === 'string')).toBe(true);
    const seqs = received.map(r => r.message.seq); expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(Object.keys(received[0]!.message).sort()).toEqual(['experimentId', 'runId', 'seq', 'type']);
    for (let i = 1; i < received.length; i++) expect(received[i]!.at - received[i - 1]!.at).toBeGreaterThanOrEqual(200);
    expect(seqs.at(-1)).toBeGreaterThan(seqs[0]! + 30);
  });
});

describe('dashboard profiles in plans and runs', () => {
  it('plans one row per requested profile with that profile\'s permissions, or the task profile when omitted', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    const a = defaultProfile('a', 'A'), b = defaultProfile('b', 'B');
    a.permissions.keyboard.keys = ['Tab']; b.permissions.keyboard.keys = ['Tab', 'Enter'];
    config.profiles = [a, b]; config.tasks[0]!.profileId = 'b';
    const saved = await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const base = { ...request, modelIds: ['a'], promptIds: ['baseline'] };
    const both = (await app.queue.plan({ ...base, profileIds: ['a', 'b'], revision: saved.revision })).rows;
    expect(both.map(r => [r.profileId, r.permissions.keys, r.permissionSource])).toEqual([['a', ['Tab'], 'profile'], ['b', ['Tab', 'Enter'], 'profile']]);
    expect(new Set(both.map(r => r.key)).size).toBe(2); expect(both.every(r => r.key.includes(r.profileId))).toBe(true);
    const { profileIds: _omit, ...withoutProfiles } = base;
    const own = (await app.queue.plan(withoutProfiles)).rows;
    expect(own).toHaveLength(1); expect(own[0]).toMatchObject({ profileId: 'b', supported: true });
    const unknown = (await app.queue.plan({ ...base, profileIds: ['missing'] })).rows;
    expect(unknown[0]).toMatchObject({ supported: false, profileId: 'missing' });
  });
  it('applies a task policy override to the run snapshot and the profile\'s analysis instructions', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.profiles[0]!.policy.historyLimit = 5; config.profiles[0]!.analysisInstructions = 'profile focus';
    config.tasks[0]!.policy = { maxStateVisits: 2 };
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const e = await app.queue.create({ ...request, modelIds: ['a'], promptIds: ['baseline'] });
    const snapshot = e.runs[0]!.snapshot;
    expect(snapshot.globals.policy).toMatchObject({ historyLimit: 5, maxStateVisits: 2 });
    expect(snapshot.runProfile).toEqual({ id: 'default', name: 'Default' }); expect(e.runs[0]!.profileId).toBe('default');
    expect(e.runs[0]!.analysisInstructions).toBe('profile focus');
    await waitFor(async () => !!e.runs[0]!.endedAt);
  });
  it('rejects tasks pointing at an unknown profile and configs without unique profile ids', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.tasks[0]!.profileId = 'ghost';
    await expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ status: 400 });
    config.tasks[0]!.profileId = 'default'; config.profiles.push(defaultProfile());
    await expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ status: 400 });
    expect(() => store.validateReferences({ ...setup(), profiles: [{ ...defaultProfile(), environment: 'no-such-environment' }] })).toThrow();
  });
});
