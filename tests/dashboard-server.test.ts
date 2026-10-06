import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultCombo, defaultConfig, type ProjectConfig } from '@rawstep/project/config';
import { connection, comboWith, plannedWith } from './helpers/project-config.js';
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
  config.connections.push(connection('a'), connection('b'));
  // Two model combos that differ by model and instructions: the experiment matrix compares models and prompts by comparing combos.
  const other = comboWith('other', 'b', 'm-b', 'Other'); other.executors.keyboard!.instructions = 'Careful fixture instructions';
  config.combos = [comboWith('default', 'a', 'm-a', 'Default'), other];
  config.pageEnvironments.push({ id: 'narrow', name: 'Narrow', profile: 'narrow' });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json' }); return config;
}
const request: PlanRequest = { taskIds: ['task'], modes: ['keyboard'], comboIds: ['default', 'other'], pageEnvironmentIds: ['default'], repeats: 1 };
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
    expect(config.version).toBe(3);
    const post = (path: string, method: string, body: unknown) => fetch(app.url + path, { method, headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const stale = await post('/api/config', 'PUT', { config, revision: 'stale' });
    expect(stale.status).toBe(409); expect(((await stale.json()) as { error: string }).error).toContain('변경');
    const lost = await post('/api/connections/models', 'POST', { kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' });
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
      active++; maxActive = Math.max(active, maxActive); seen.push({ task: structuredClone(actualTask), prompt: run.snapshot.spec.prompt.instructions });
      await new Promise(r => setTimeout(r, 15)); signal.throwIfAborted();
      const trace = new TraceRecorder({ ...actualTask, id: actualTask.id ?? 'fixture' }, outDir); await trace.initialize(); trace.append('fixture.policy', { instructions: run.snapshot.spec.prompt.instructions }, { source: 'policy' });
      active--; return trace.finalize({ status: 'success', reason: 'test-double-only', steps: 1 });
    } }); apps.push(app);
    const response = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, pageEnvironmentIds: ['default', 'narrow'] }) });
    expect(response.status).toBe(201); const experiment = await response.json() as Experiment; expect(experiment.runs).toHaveLength(4);
    expect(experiment.runs.map(r => [r.comboId, r.pageEnvironmentId, r.modelName, r.snapshot.spec.model.id, r.snapshot.spec.model.modelId])).toEqual([['default', 'default', 'a · m-a', 'a', 'm-a'], ['default', 'narrow', 'a · m-a', 'a', 'm-a'], ['other', 'default', 'b · m-b', 'b', 'm-b'], ['other', 'narrow', 'b · m-b', 'b', 'm-b']]);
    expect(experiment.runs.map(r => r.snapshot.spec.prompt.instructions)).toEqual(['Keyboard fixture instructions.', 'Keyboard fixture instructions.', 'Careful fixture instructions', 'Careful fixture instructions']);
    const current = await store.read(); const emptied = structuredClone(current.config); emptied.actionSets[0]!.keyboard.keys = []; await store.save(emptied, current.revision);
    await waitFor(async () => { const durable = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment; return durable.runs.every(r => r.state === 'success' && !!r.endedAt); });
    expect(maxActive).toBe(1); expect(seen).toHaveLength(4); expect(JSON.stringify(seen)).toContain('private-value');
    const saved = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment;
    expect(JSON.stringify(saved)).not.toContain('private-value'); expect(saved.runs.every(r => r.permissions.keys.includes('Tab'))).toBe(true);
    expect(saved.runs.every(r => r.reportStatus === 'complete')).toBe(true);
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const restarted = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(restarted);
    expect(restarted.queue.experiments[0]!.runs.every(r => r.state === 'success')).toBe(true);
    const state = await (await fetch(restarted.url + '/api/state')).json() as ConfigView; expect(state.config.actionSets[0]!.keyboard.keys).toEqual([]);
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
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, comboIds: ['default'] }) });
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
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); const config = setup(); config.combos[0]!.executors.keyboard!.inputs = ['text']; config.combos.push(defaultCombo('bare', 'Bare'));
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(app);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://foreign.example' } })).status).toBe(403);
    // The same server opened as localhost sends that origin for module scripts; another loopback port is still foreign.
    const port = Number(new URL(app.url).port);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + port } })).status).toBe(200);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + (port === 65535 ? 1 : port + 1) } })).status).toBe(403);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://localhost:' + port } })).status).toBe(403);
    const plan = await app.queue.plan(request);
    expect(plan.rows.filter(r => r.comboId === 'default').every(r => !r.supported && r.reason!.includes('이미지') && r.modelName === 'a · m-a')).toBe(true);
    expect(plan.rows.filter(r => r.comboId === 'other').every(r => r.supported && r.modelName === 'b · m-b')).toBe(true);
    // A model combo without an executor for the mode is a row that says so and has no model name.
    const bare = (await app.queue.plan({ ...request, comboIds: ['bare'] })).rows[0]!;
    expect(bare).toMatchObject({ supported: false, comboId: 'bare', reason: expect.stringContaining('실행 모델이 없습니다') }); expect(bare).not.toHaveProperty('modelName');
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
      seen.push({ goal: actual.goal, input: actual.input, model: run.snapshot.spec.model.modelId, prompt: run.snapshot.spec.prompt.instructions });
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const e = await app.queue.create({ ...request, comboIds: ['other'] }); await waitFor(async () => !!e.runs[0]!.endedAt);
    const before = await store.read(); before.config.combos[1]!.executors.keyboard!.modelId = 'changed-model'; before.config.combos[1]!.executors.keyboard!.instructions = 'Changed instructions';
    await store.save(before.config, before.revision, { file: 'task.json', task: { ...task, goal: 'changed goal', input: { email: 'NEW_PRIVATE_INPUT' } } });
    const preview = await app.queue.previewRetry(e.id, e.runs[0]!.id); expect(preview.changedFields).toContain('goal'); expect(JSON.stringify(preview)).not.toContain('NEW_PRIVATE_INPUT');
    await expect(app.queue.retry(e.id, e.runs[0]!.id, 'stale')).rejects.toMatchObject({ status: 409 });
    const retried = await app.queue.retry(e.id, e.runs[0]!.id, preview.revision); await waitFor(async () => !!retried.runs[0]!.endedAt);
    expect(seen[1]).toEqual({ goal: task.goal, input: { email: 'NEW_PRIVATE_INPUT' }, model: 'm-b', prompt: 'Careful fixture instructions' });
    expect(JSON.stringify(retried)).not.toContain('NEW_PRIVATE_INPUT'); expect(retried.runs[0]!.retryOf?.run).toBe(e.runs[0]!.id);
    // The retry keeps the whole recorded spec (model, prompt, conditions, rules); only the task is renewed.
    const { task: _original, ...originalSpec } = e.runs[0]!.snapshot.spec, { task: _retried, ...retriedSpec } = retried.runs[0]!.snapshot.spec;
    expect(retriedSpec).toEqual(originalSpec); expect(retried.runs[0]!.snapshot.spec.conditions).toMatchObject({ combo: { id: 'other' }, actionSet: { id: 'basic' }, pageEnvironment: { id: 'default' } });
    expect(retried.request).toMatchObject({ taskIds: ['task'], modes: ['keyboard'], comboIds: ['other'], actionSetIds: ['basic'], pageEnvironmentIds: ['default'], atEnvironmentIds: ['simulation'], repeats: 1 });
  });
  it('stores keys by provider or custom connection, reports their status without values and marks runs whose key is missing', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections[0]!.apiKeyEnv = 'RAWSTEP_TEST_DASH_KEY';
    config.connections.push(connection('jev', { provider: 'typesafe' }));
    config.combos.push(comboWith('jev', 'jev', 'jev-latest'));
    config.connections.push(connection('writer', { kind: 'llm', provider: 'openai' }));
    config.project.analysis = { model: { connectionId: 'writer', modelId: 'gpt-fixture' }, instructions: '' };
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const post = (path: string, body: unknown) => fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const rowFor = async (comboId: string) => (await app.queue.plan({ ...request, comboIds: [comboId] })).rows[0]!;
    expect(await rowFor('jev')).toMatchObject({ supported: false, reason: expect.stringContaining('인증키') });
    vi.stubEnv('RAWSTEP_OPENAI_API_KEY', '');
    try {
      // A missing analysis key never blocks a run: the row can run and says the analysis falls back to rules.
      const warned = await rowFor('default');
      expect(warned).toMatchObject({ supported: true, modelName: 'a · m-a', warnings: [expect.stringContaining('인증키')] }); expect(warned).not.toHaveProperty('reason');
      expect((await post('/api/credentials', { provider: 'openai', value: 'sk-openai-secret' })).status).toBe(200);
      expect(await rowFor('default')).toMatchObject({ supported: true, modelName: 'a · m-a', warnings: [] });
    } finally { vi.unstubAllEnvs(); }
    expect((await post('/api/credentials', { provider: 'typesafe', value: 'sk-ts-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { connectionId: 'a', value: 'sk-a-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { provider: 'custom', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { connectionId: 'b', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { connectionId: 'ghost', value: 'x' })).status).toBe(404);
    const text = await (await fetch(app.url + '/api/state')).text(), view = JSON.parse(text) as ConfigView;
    expect(view.credentialStatus).toMatchObject({ 'provider:typesafe': true, 'connection:a': true });
    expect(text).not.toContain('sk-ts-secret'); expect(text).not.toContain('sk-a-secret');
    expect(await rowFor('jev')).toMatchObject({ supported: true });
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('RAWSTEP_TYPESAFE_API_KEY="sk-ts-secret"');
  });
  it('pins the project\'s analysis model and preserves success when analysis fails', async () => {
    let sent: { messages: { content: string }[] } | undefined;
    const server = createServer((req, res) => { void (async () => { let body = ''; for await (const part of req) body += part; sent = JSON.parse(body); res.writeHead(503); res.end('PRIVATE_PROVIDER_ERROR'); })(); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections.push(connection('analysis', { kind: 'llm', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port, timeoutMs: 1000 }));
    config.project.analysis = { model: { connectionId: 'analysis', modelId: 'analyzer' }, instructions: 'Global comparison focus' };
    await store.save(config, initial.revision, { file: 'task.json', task });
    try {
      const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
        const changed = await store.read(); changed.config.connections.find(c => c.id === 'analysis')!.baseURL = 'http://127.0.0.1:1'; await store.save(changed.config, changed.revision);
        const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
      } }); apps.push(app);
      const e = await app.queue.create({ ...request, comboIds: ['default'] }); await waitFor(async () => !!e.runs[0]!.endedAt);
      expect(e.runs[0]!.analysisModel).toMatchObject({ id: 'analysis', modelId: 'analyzer', kind: 'llm' });
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
  async function launch(scripts: (((trace: TraceRecorder) => Promise<{ status: 'success' | 'failure'; steps: number }>) | 'throw')[], tweak: (config: ProjectConfig) => void = () => {}) {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup(); tweak(config); await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const next = scripts.shift(); if (!next || next === 'throw') throw new Error('no trace');
      const trace = new TraceRecorder({ ...actual, id: 'fixture', mode: 'keyboard' }, out); await trace.initialize();
      return trace.finalize(await next(trace));
    } }); apps.push(app);
    const experiment = async (comboIds: string[], repeats = 1, modes: PlanRequest['modes'] = ['keyboard']) => {
      const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, comboIds, repeats, modes }) });
      const exp = await created.json() as Experiment;
      await waitFor(async () => exp.runs.every(r => app.queue.find(exp.id, r.id).reportStatus !== 'pending' && !!app.queue.find(exp.id, r.id).endedAt));
      return exp;
    };
    const get = (exp: Experiment, run: number, tail: string) => fetch(`${app.url}/api/experiments/${exp.id}/runs/${exp.runs[run]!.id}/${tail}`);
    return { app, experiment, get };
  }
  it('serves step views with screenshots, a missing trace as empty steps, and 404 for unknown runs', async () => {
    const { app, experiment, get } = await launch([script(['Tab', 'Enter'], 'success'), 'throw']);
    const ok = await experiment(['default']), broken = await experiment(['default']);
    const view = await (await get(ok, 0, 'steps')).json() as RunStepsView;
    expect(view).toMatchObject({ experimentId: ok.id, runId: ok.runs[0]!.id, live: false, modelKind: 'decision' });
    expect(Array.isArray(view.hints)).toBe(true);
    expect(view.steps.map(s => s.step)).toEqual([0, 1, 2]);
    expect(view.steps[1]).toMatchObject({ action: { kind: 'key', key: 'Tab' }, ok: true });
    expect(view.steps.every(s => /^[a-f0-9]{64}$/.test(s.screenshot!.sha256!))).toBe(true);
    const image = await get(ok, 0, 'png/' + encodeURIComponent(view.steps[2]!.screenshot!.eventId));
    expect(image.status).toBe(200); expect(createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex')).toBe(view.steps[2]!.screenshot!.sha256);
    expect(await (await get(broken, 0, 'steps')).json()).toMatchObject({ steps: [], live: false });
    expect((await fetch(`${app.url}/api/experiments/${ok.id}/runs/${randomUUID()}/steps`)).status).toBe(404);
    expect((await fetch(`${app.url}/api/experiments/${randomUUID()}/runs/${randomUUID()}/hints`)).status).toBe(404);
  });
  it('compares hints with the shortest goal-reaching run of the same task across experiments', async () => {
    const { experiment, get } = await launch([script(['Tab', 'Tab', 'Tab', 'Tab'], 'failure'), 'throw', script(['Tab', 'Enter'], 'success'), script(['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success'), script(['Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success')]);
    const failed = await experiment(['default']), missing = await experiment(['default']);
    const none = await (await get(failed, 0, 'hints')).json() as RunHintsView;
    expect(none.referenceRun).toBeUndefined(); expect(none.reference).toBeUndefined(); expect(none.steps).toBe(4);
    const noTrace = await get(missing, 0, 'hints');
    expect(noTrace.status).toBe(404); expect((await noTrace.json() as { error: string }).error).toMatch(/추적/);
    const short = await experiment(['default']), slow = await experiment(['other']), middle = await experiment(['other']);
    const hints = await (await get(slow, 0, 'hints')).json() as RunHintsView;
    expect(hints.referenceRun).toEqual({ experimentId: short.id, runId: short.runs[0]!.id });
    expect(hints.reference).toMatchObject({ runId: expect.any(String), steps: 2, goalReached: true });
    expect(hints.hints.map(h => h.kind)).toContain('slow-run');
    expect((await (await get(middle, 0, 'hints')).json() as RunHintsView).referenceRun!.runId).toBe(short.runs[0]!.id);
    // The reference run itself is compared with the next shortest goal-reaching run, never with itself.
    expect((await (await get(short, 0, 'hints')).json() as RunHintsView).referenceRun!.runId).toBe(middle.runs[0]!.id);
  });
  it('takes the reference run only from runs of the same mode and structure', async () => {
    const { experiment, get } = await launch([script(['Tab', 'Enter'], 'success'), script(['Tab', 'Enter'], 'success'), script(['Tab', 'Enter'], 'success'), script(['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success')], config => {
      config.connections.push(connection('planner-llm', { kind: 'llm' }));
      config.combos.push(plannedWith(comboWith('planned', 'a', 'm-a', 'Planned'), 'planner-llm'));
    });
    const keyboard = await experiment(['default']), spoken = await experiment(['default'], 1, ['screenreader']), planned = await experiment(['planned']), slow = await experiment(['other']);
    expect(planned.runs[0]).toMatchObject({ mode: 'keyboard', structure: 'planned' });
    // The shortest runs are a screen reader run and a planned run, yet the keyboard solo run is compared with the keyboard solo one.
    expect((await (await get(slow, 0, 'hints')).json() as RunHintsView).referenceRun).toEqual({ experimentId: keyboard.id, runId: keyboard.runs[0]!.id });
    // Alone in its mode, or alone with its structure, a run has no reference.
    expect((await (await get(spoken, 0, 'hints')).json() as RunHintsView).referenceRun).toBeUndefined();
    expect((await (await get(planned, 0, 'hints')).json() as RunHintsView).referenceRun).toBeUndefined();
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
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, comboIds: ['default'] }) });
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


describe('dashboard conditions in plans and runs', () => {
  const create = (config: ProjectConfig = setup(), files: Record<string, unknown> = {}) => async (execute?: boolean) => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize();
    for (const [file, content] of Object.entries(files)) await writeFile(join(dir, file), JSON.stringify(content));
    const saved = await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, ...(execute === false ? {} : { execute: async (_run, actual, out) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
    } }) }); apps.push(app);
    return { app, store, dir, revision: saved.revision };
  };
  it('plans one row per mode, repeat and combination of conditions, in a key that names every condition', async () => {
    const { app } = await create()();
    const asked: PlanRequest = { ...request, modes: ['keyboard', 'screenreader'], comboIds: ['default'], repeats: 2 };
    const rows = (await app.queue.plan(asked)).rows;
    expect(rows.map(r => [r.key, r.mode, r.repeat])).toEqual([
      ['task:keyboard:default:basic:default:simulation:1', 'keyboard', 1], ['task:keyboard:default:basic:default:simulation:2', 'keyboard', 2],
      ['task:screenreader:default:basic:default:simulation:1', 'screenreader', 1], ['task:screenreader:default:basic:default:simulation:2', 'screenreader', 2],
    ]);
    // Each mode brings its own actions from the action set.
    expect(rows[0]!.permissions.keys).toContain('Tab'); expect(rows[2]!.permissions.intents).toContain('next');
    const e = await app.queue.create({ ...asked, selected: [rows[1]!.key, rows[2]!.key] });
    expect(e.runs.map(r => [r.mode, r.repeat, r.snapshot.spec.mode])).toEqual([['keyboard', 2, 'keyboard'], ['screenreader', 1, 'screenreader']]);
    expect(e.runs.map(r => r.snapshot.spec.conditions)).toEqual([expect.objectContaining({ combo: expect.objectContaining({ id: 'default' }) }), expect.objectContaining({ atEnvironment: { id: 'simulation', name: expect.any(String), backend: 'simulation' } })]);
    expect(e.runs[1]!.snapshot.spec.prompt.instructions).toBe('Screen reader fixture instructions.');
    await waitFor(async () => e.runs.every(r => !!r.endedAt));
  });
  it('multiplies model combos by page environments and records the resolved environment in the run snapshot', async () => {
    const { app } = await create()();
    const asked = { ...request, pageEnvironmentIds: ['default', 'narrow'] };
    const rows = (await app.queue.plan(asked)).rows;
    expect(rows.map(r => [r.key, r.comboId, r.pageEnvironmentId, r.supported])).toEqual([
      ['task:keyboard:default:basic:default:simulation:1', 'default', 'default', true], ['task:keyboard:default:basic:narrow:simulation:1', 'default', 'narrow', true],
      ['task:keyboard:other:basic:default:simulation:1', 'other', 'default', true], ['task:keyboard:other:basic:narrow:simulation:1', 'other', 'narrow', true],
    ]);
    const e = await app.queue.create(asked);
    expect(e.runs.map(r => r.snapshot.spec.conditions)).toEqual(expect.arrayContaining([expect.objectContaining({ pageEnvironment: expect.objectContaining({ id: 'narrow', profile: 'narrow' }) })]));
    expect(e.runs[1]!.snapshot.spec.environment).toMatchObject({ viewport: { width: 320, height: 800 } });
    expect(e.runs[0]!.snapshot.spec.environment).not.toEqual(e.runs[1]!.snapshot.spec.environment);
    expect((await app.queue.plan({ ...asked, pageEnvironmentIds: ['missing'] })).rows).toEqual([]);
    await waitFor(async () => e.runs.every(r => !!r.endedAt));
  });
  it('expands presets into the conditions they name and falls back to the task\'s own for what they leave out', async () => {
    const config = setup(); config.actionSets.push({ ...config.actionSets[0]!, id: 'tab-only', name: 'Tab only', keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false } });
    config.presets = [{ id: 'careful', name: 'Careful', comboId: 'other', pageEnvironmentId: 'narrow', actionSetId: 'tab-only' }, { id: 'plain', name: 'Plain' }];
    config.tasks[0]!.comboId = 'other';
    const { app } = await create(config)();
    const { comboIds: _combos, pageEnvironmentIds: _environments, ...withoutConditions } = request;
    const rows = (await app.queue.plan({ ...withoutConditions, presetIds: ['careful', 'plain'] })).rows;
    expect(rows.map(r => [r.presetId, r.comboId, r.actionSetId, r.pageEnvironmentId, r.atEnvironmentId])).toEqual([['careful', 'other', 'tab-only', 'narrow', 'simulation'], ['plain', 'other', 'basic', 'default', 'simulation']]);
    expect(rows[0]!.permissions.keys).toEqual(['Tab']);
    // Without presets or lists a task runs under its own conditions.
    const own = (await app.queue.plan(withoutConditions)).rows;
    expect(own).toHaveLength(1); expect(own[0]).toMatchObject({ comboId: 'other', pageEnvironmentId: 'default', supported: true }); expect(own[0]).not.toHaveProperty('presetId');
    // A condition list narrows what a preset brings.
    expect((await app.queue.plan({ ...withoutConditions, presetIds: ['careful'], comboIds: ['default'] })).rows.map(r => [r.presetId, r.comboId, r.pageEnvironmentId])).toEqual([['careful', 'default', 'narrow']]);
  });
  it('gives screen reader runs of a planned combo the planner, with a warning on keyboard rows that do not use it', async () => {
    const config = setup();
    config.connections.push(connection('planner-llm', { kind: 'llm' }));
    config.combos[0] = plannedWith(config.combos[0]!, 'planner-llm', 'planner-fixture', 'Plan in small steps');
    const { app } = await create(config)();
    const spoken: PlanRequest = { ...request, modes: ['screenreader'], comboIds: ['default'] };
    expect((await app.queue.plan(spoken)).rows[0]).toMatchObject({ supported: true, structure: 'planned', plannerName: 'planner-llm · planner-fixture', warnings: [] });
    const screenReader = await app.queue.create(spoken), spec = screenReader.runs[0]!.snapshot.spec;
    expect(screenReader.runs[0]).toMatchObject({ plannerName: 'planner-llm · planner-fixture', structure: 'planned' });
    expect(spec).toMatchObject({ plannerInstructions: 'Plan in small steps', plannerModel: { id: 'planner-llm', modelId: 'planner-fixture', kind: 'llm' } });
    expect(spec.conditions).toMatchObject({ combo: { structure: 'planned', planner: 'planner-llm · planner-fixture' } });
    await waitFor(async () => !!screenReader.runs[0]!.endedAt);
    // Keyboard mode runs the planned combo without its planner and says so.
    const keyboard = { ...request, comboIds: ['default'] }, row = (await app.queue.plan(keyboard)).rows[0]!;
    expect(row).toMatchObject({ supported: true, structure: 'planned', warnings: [expect.stringContaining('계획 모델')] }); expect(row).not.toHaveProperty('plannerName');
    const made = await app.queue.create(keyboard), made0 = made.runs[0]!;
    expect(made0.snapshot.spec).not.toHaveProperty('plannerModel'); expect(made0.snapshot.spec).not.toHaveProperty('plannerInstructions'); expect(made0).not.toHaveProperty('plannerName');
    await waitFor(async () => !!made0.endedAt);
    // A solo combo in screen reader mode has no planner and no warning.
    expect((await app.queue.plan({ ...spoken, comboIds: ['other'] })).rows[0]).toMatchObject({ supported: true, structure: 'solo', warnings: [] });
  });
  it('applies the project run rules and a preset over them to the snapshot, and the analysis instructions of the project or the task', async () => {
    const config = setup();
    config.combos[0]!.executors.keyboard!.historyLimit = 5; config.project.analysis.instructions = 'project focus';
    config.runRules.maxStateVisits = 7; config.presets = [{ id: 'strict', name: 'Strict', runRules: { maxStateVisits: 3, maxReplans: 4 } }];
    config.tasks.push({ id: 'focused', name: 'Focused', file: 'focused.json', analysisInstructions: 'task focus' });
    const { app } = await create(config, { 'focused.json': task })();
    const e = await app.queue.create({ ...request, taskIds: ['task', 'focused'], comboIds: ['default'], presetIds: ['strict'] }), unset = await app.queue.create({ ...request, comboIds: ['default'] });
    const [plain, focused] = e.runs;
    expect(plain!.snapshot.spec.settings.runRules).toMatchObject({ maxStateVisits: 3, maxReplans: 4 });
    expect(focused!.snapshot.spec.settings.runRules).toMatchObject({ maxStateVisits: 3, maxReplans: 4 });
    expect(unset.runs[0]!.snapshot.spec.settings.runRules).toMatchObject({ maxStateVisits: 7 });
    expect(plain!.snapshot.spec.executor).toMatchObject({ historyLimit: 5 });
    expect(plain!.snapshot.spec.conditions).toMatchObject({ combo: { id: 'default' }, preset: { id: 'strict' }, runRules: { maxStateVisits: 3 } });
    expect(plain!.presetId).toBe('strict'); expect(plain!.snapshot.taskName).toBe('Fixture');
    expect(plain!.analysisInstructions).toBe('project focus'); expect(focused!.analysisInstructions).toBe('task focus');
    await waitFor(async () => [...e.runs, ...unset.runs].every(r => !!r.endedAt));
  });
  it('rejects tasks and presets pointing at unknown conditions and configs without unique ids', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    const fails = (code: string) => expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ status: 400, code });
    config.tasks[0]!.comboId = 'ghost'; await fails('task-combo-missing');
    config.tasks[0]!.comboId = 'default'; config.tasks[0]!.pageEnvironmentId = 'ghost'; await fails('task-page-environment-missing');
    config.tasks[0]!.pageEnvironmentId = 'default'; config.tasks[0]!.atEnvironmentId = 'ghost'; await fails('task-at-environment-missing');
    delete config.tasks[0]!.atEnvironmentId; config.presets = [{ id: 'p', name: 'P', actionSetId: 'ghost' }]; await fails('preset-action-set-missing');
    config.presets = []; config.combos.push(defaultCombo()); await fails('duplicate-id');
    expect(() => store.validateReferences({ ...setup(), pageEnvironments: [{ id: 'default', name: 'Default', profile: 'no-such-environment' }] })).toThrow();
  });
});
