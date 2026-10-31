import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultProfile, defaultConfig, type LlmPlannerChoice, type ProjectConfig } from '@rawstep/project/config';
import { connection, profileWith } from './helpers/project-config.js';
import { TraceRecorder } from '@rawstep/core/trace';
import type { Experiment, ConfigView, PlanRequest } from '../packages/dashboard/src/shared/config.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { RunEventMessage, RunHintsView, RunStepsView } from '../packages/dashboard/src/shared/api.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-dashboard-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  config.connections.push(connection('a'), connection('b'));
  // Two run profiles that differ by planner model and planner instructions (each also in a narrow page): the experiment matrix compares them.
  const other = profileWith('other', 'b', 'planner-b', 'Other', 'Careful planner instructions');
  const first = profileWith('default', 'a', 'planner-a', 'Default');
  config.profiles = [first, other, { ...first, id: 'default-narrow', name: 'Default narrow', page: 'narrow' }, { ...other, id: 'other-narrow', name: 'Other narrow', page: 'narrow' }];
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json' }); return config;
}
const request: PlanRequest = { taskIds: ['task'], profileIds: ['default', 'other'], repeats: 1 };
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
  it('creates rawstep.config.json for a new project and answers project errors with their status and message code', async () => {
    const dir = await root(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const config = JSON.parse(await readFile(join(dir, 'rawstep.config.json'), 'utf8')) as ProjectConfig;
    expect(config.version).toBe(7);
    const post = (path: string, method: string, body: unknown) => fetch(app.url + path, { method, headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const stale = await post('/api/config', 'PUT', { config, revision: 'stale' });
    expect(stale.status).toBe(409); expect(((await stale.json()) as { error: object }).error).toEqual({ code: 'config-conflict' });
    const lost = await post('/api/connections/models', 'POST', { provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' });
    expect(lost.status).toBe(502); expect(((await lost.json()) as { error: object }).error).toEqual({ code: 'model-unreachable' });
    const missing = await post('/api/tasks/import', 'POST', { file: 'nothing.json' });
    expect(missing.status).toBe(404);
    const outside = await post('/api/tasks/import', 'POST', { file: '../outside.json' });
    expect(outside.status).toBe(400); expect(((await outside.json()) as { error: object }).error).toEqual({ code: 'path-outside-project' });
  });
  it('runs a two-by-two matrix, snapshots settings, saves real trace files and restores history', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    let active = 0, maxActive = 0; const seen: unknown[] = [];
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web'), execute: async (run, actualTask, outDir, signal) => {
      active++; maxActive = Math.max(active, maxActive); seen.push({ task: structuredClone(actualTask), instructions: run.snapshot.spec.plannerInstructions });
      await new Promise(r => setTimeout(r, 15)); signal.throwIfAborted();
      const trace = new TraceRecorder({ ...actualTask, id: actualTask.id ?? 'fixture' }, outDir); await trace.initialize(); trace.append('fixture.policy', { instructions: run.snapshot.spec.plannerInstructions }, { source: 'policy' });
      active--; return trace.finalize({ status: 'success', reason: 'test-double-only', steps: 1 });
    } }); apps.push(app);
    const response = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, profileIds: ['default', 'default-narrow', 'other', 'other-narrow'] }) });
    expect(response.status).toBe(201); const experiment = await response.json() as Experiment; expect(experiment.runs).toHaveLength(4);
    expect(experiment.runs.map(r => [r.profileId, r.plannerName, r.snapshot.spec.plannerModel!.id, r.snapshot.spec.plannerModel!.modelId])).toEqual([['default', 'a · planner-a', 'a', 'planner-a'], ['default-narrow', 'a · planner-a', 'a', 'planner-a'], ['other', 'b · planner-b', 'b', 'planner-b'], ['other-narrow', 'b · planner-b', 'b', 'planner-b']]);
    expect(experiment.runs.map(r => r.snapshot.spec.plannerInstructions)).toEqual(['', '', 'Careful planner instructions', 'Careful planner instructions']);
    const current = await store.read(); const emptied = structuredClone(current.config); emptied.profiles[0]!.actions.intents = ['next']; await store.save(emptied, current.revision);
    await waitFor(async () => { const durable = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment; return durable.runs.every(r => r.state === 'success' && !!r.endedAt); });
    expect(maxActive).toBe(1); expect(seen).toHaveLength(4); expect(JSON.stringify(seen)).toContain('private-value');
    const saved = JSON.parse(await readFile(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'), 'utf8')) as Experiment;
    expect(JSON.stringify(saved)).not.toContain('private-value'); expect(saved.runs.every(r => r.permissions.intents.includes('activate'))).toBe(true);
    expect(saved.runs.every(r => r.reportStatus === 'complete')).toBe(true);
    await app.close(); apps.splice(apps.indexOf(app), 1);
    const restarted = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(restarted);
    expect(restarted.queue.experiments[0]!.runs.every(r => r.state === 'success')).toBe(true);
    const state = await (await fetch(restarted.url + '/api/state')).json() as ConfigView; expect(state.config.profiles[0]!.actions.intents).toEqual(['next']);
    expect(await (await fetch(restarted.url)).text()).toContain('Rawstep');
  });
  it('serves the diagnostic screenshots a run saved, and only those its trace names under diagnostics/', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('dashboard-pixels')]);
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
      await mkdir(join(out, 'diagnostics'), { recursive: true }); await writeFile(join(out, 'diagnostics', 'step-0.png'), png);
      trace.append('browser.screenshot', { step: 0, path: 'diagnostics/step-0.png', policyVisible: false }, { source: 'browser-diagnostic' });
      trace.append('browser.screenshot', { step: 0, path: '../task.json', policyVisible: false }, { source: 'browser-diagnostic' });
      return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, profileIds: ['default'] }) });
    const experiment = await created.json() as Experiment, run = experiment.runs[0]!;
    await waitFor(async () => app.queue.find(experiment.id, run.id).reportStatus === 'complete');
    const base = app.url + '/api/experiments/' + experiment.id + '/runs/' + run.id;
    const events = await (await fetch(base + '/events')).json() as { id: string; type: string; data: { path?: string } }[];
    const [shot, escape] = events.filter(e => e.type === 'browser.screenshot');
    const image = await fetch(base + '/png/' + shot!.id);
    expect(image.headers.get('content-type')).toBe('image/png'); expect(Buffer.from(await image.arrayBuffer()).equals(png)).toBe(true);
    expect((await fetch(base + '/png/' + escape!.id)).status).toBe(404);
    expect((await fetch(base + '/png/event-999999')).status).toBe(404);
    expect((await fetch(base + '/stop-reason')).status).toBe(404);
  });
  it('rejects foreign Origin and unsupported profiles before queue acquisition', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); const config = setup();
    config.profiles.push(defaultProfile('bare', 'Bare'));
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web') }); apps.push(app);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://foreign.example' } })).status).toBe(403);
    // The same server opened as localhost sends that origin for module scripts; another loopback port is still foreign.
    const port = Number(new URL(app.url).port);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + port } })).status).toBe(200);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'http://localhost:' + (port === 65535 ? 1 : port + 1) } })).status).toBe(403);
    expect((await fetch(app.url + '/api/state', { headers: { origin: 'https://localhost:' + port } })).status).toBe(403);
    const plan = await app.queue.plan(request);
    expect(plan.rows.map(r => [r.profileId, r.supported, r.plannerName])).toEqual([['default', true, 'a · planner-a'], ['other', true, 'b · planner-b']]);
    // A run profile without a planner is a row that says so and has no planner name.
    const bare = (await app.queue.plan({ ...request, profileIds: ['bare'] })).rows[0]!;
    expect(bare).toMatchObject({ supported: false, profileId: 'bare', reason: { code: 'planner-model-invalid' } }); expect(bare).not.toHaveProperty('plannerName');
    await expect(app.queue.create({ ...request, profileIds: ['default', 'bare'] })).rejects.toMatchObject({ status: 400 });
    expect(app.queue.experiments).toHaveLength(0);
  });
  it('cancels the active run and queued siblings without starting them', async () => {
    const dir = await root(), store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(setup(), initial.revision, { file: 'task.json', task });
    let calls = 0;
    const app = await startDashboard({ projectDir: dir, port: 0, webDir: join(process.cwd(), 'packages/dashboard/dist/web'), execute: async (_run, _task, _out, signal) => {
      calls++; await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); throw new Error('Unreachable');
    } }); apps.push(app);
    const e = await app.queue.create(request); await waitFor(async () => calls === 1);
    await app.queue.cancel(e.id); await waitFor(async () => e.runs.every(r => r.state === 'cancelled'));
    expect(calls).toBe(1);
  });
  it('retries pinned public conditions with fresh inputs after config changes', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize();
    await store.save(setup(), initial.revision, { file: 'task.json', task });
    const seen: { goal: string; input: unknown; model: string; instructions: string }[] = [];
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
      seen.push({ goal: actual.goal, input: actual.input, model: run.snapshot.spec.plannerModel!.modelId, instructions: run.snapshot.spec.plannerInstructions! });
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
    } }); apps.push(app);
    const e = await app.queue.create({ ...request, profileIds: ['other'] }); await waitFor(async () => !!e.runs[0]!.endedAt);
    const before = await store.read(); Object.assign(before.config.profiles[1]!.planner as LlmPlannerChoice, { modelId: 'changed-model', instructions: 'Changed instructions' });
    await store.save(before.config, before.revision, { file: 'task.json', task: { ...task, goal: 'changed goal', input: { email: 'NEW_PRIVATE_INPUT' } } });
    const preview = await app.queue.previewRetry(e.id, e.runs[0]!.id); expect(preview.changedFields).toContain('goal'); expect(JSON.stringify(preview)).not.toContain('NEW_PRIVATE_INPUT');
    await expect(app.queue.retry(e.id, e.runs[0]!.id, 'stale')).rejects.toMatchObject({ status: 409 });
    const retried = await app.queue.retry(e.id, e.runs[0]!.id, preview.revision); await waitFor(async () => !!retried.runs[0]!.endedAt);
    expect(seen[1]).toEqual({ goal: task.goal, input: { email: 'NEW_PRIVATE_INPUT' }, model: 'planner-b', instructions: 'Careful planner instructions' });
    expect(JSON.stringify(retried)).not.toContain('NEW_PRIVATE_INPUT'); expect(retried.runs[0]!.retryOf?.run).toBe(e.runs[0]!.id);
    // The retry keeps the whole recorded spec (planner, instructions, conditions, rules); only the task is renewed.
    const { task: _original, ...originalSpec } = e.runs[0]!.snapshot.spec, { task: _retried, ...retriedSpec } = retried.runs[0]!.snapshot.spec;
    expect(retriedSpec).toEqual(originalSpec); expect(retried.runs[0]!.snapshot.spec.conditions).toMatchObject({ profile: { id: 'other', name: 'Other' }, combo: { id: 'other' } });
    expect(retried.request).toMatchObject({ taskIds: ['task'], profileIds: ['other'], repeats: 1 });
  });
  it('stores keys by provider or custom connection, reports their status without values and marks runs whose key is missing', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections[0]!.apiKeyEnv = 'RAWSTEP_TEST_DASH_KEY';
    config.connections.push(connection('router', { provider: 'openrouter' }));
    config.profiles.push(profileWith('router', 'router', 'router-planner'));
    config.connections.push(connection('writer', { provider: 'openai' }));
    config.project.analysis = { model: { connectionId: 'writer', modelId: 'gpt-fixture' }, instructions: '' };
    await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const post = (path: string, body: unknown) => fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
    const rowFor = async (profileId: string) => (await app.queue.plan({ ...request, profileIds: [profileId] })).rows[0]!;
    expect(await rowFor('router')).toMatchObject({ supported: false, reason: { code: 'missing-planner-credential' } });
    vi.stubEnv('RAWSTEP_OPENAI_API_KEY', '');
    try {
      // A missing analysis key never blocks a run: the row can run and says the analysis falls back to rules.
      const warned = await rowFor('default');
      expect(warned).toMatchObject({ supported: true, plannerName: 'a · planner-a', warnings: [{ code: 'analysis-key-missing' }] }); expect(warned).not.toHaveProperty('reason');
      expect((await post('/api/credentials', { provider: 'openai', value: 'sk-openai-secret' })).status).toBe(200);
      expect(await rowFor('default')).toMatchObject({ supported: true, plannerName: 'a · planner-a', warnings: [] });
    } finally { vi.unstubAllEnvs(); }
    expect((await post('/api/credentials', { provider: 'openrouter', value: 'sk-or-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { connectionId: 'a', value: 'sk-a-secret' })).status).toBe(200);
    expect((await post('/api/credentials', { provider: 'custom', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { connectionId: 'b', value: 'x' })).status).toBe(400);
    expect((await post('/api/credentials', { connectionId: 'ghost', value: 'x' })).status).toBe(404);
    const text = await (await fetch(app.url + '/api/state')).text(), view = JSON.parse(text) as ConfigView;
    expect(view.credentialStatus).toMatchObject({ 'provider:openrouter': true, 'connection:a': true });
    expect(text).not.toContain('sk-or-secret'); expect(text).not.toContain('sk-a-secret');
    expect(await rowFor('router')).toMatchObject({ supported: true });
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('RAWSTEP_OPENROUTER_API_KEY="sk-or-secret"');
  });
  it('pins the project\'s analysis model and preserves success when analysis fails', async () => {
    let sent: { messages: { content: string }[] } | undefined;
    const server = createServer((req, res) => { void (async () => { let body = ''; for await (const part of req) body += part; sent = JSON.parse(body); res.writeHead(503); res.end('PRIVATE_PROVIDER_ERROR'); })(); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections.push(connection('analysis', { baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port, timeoutMs: 1000 }));
    config.project.analysis = { model: { connectionId: 'analysis', modelId: 'analyzer' }, instructions: 'Global comparison focus' };
    await store.save(config, initial.revision, { file: 'task.json', task });
    try {
      const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
        const changed = await store.read(); changed.config.connections.find(c => c.id === 'analysis')!.baseURL = 'http://127.0.0.1:1'; await store.save(changed.config, changed.revision);
        const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
      } }); apps.push(app);
      const e = await app.queue.create({ ...request, profileIds: ['default'] }); await waitFor(async () => !!e.runs[0]!.endedAt);
      expect(e.runs[0]!.analysisModel).toMatchObject({ id: 'analysis', modelId: 'analyzer' });
      expect(sent?.messages[0]!.content).toContain('Global comparison focus');
      expect(e.runs[0]!.state).toBe('success'); expect(e.runs[0]!.analysisStatus).toBe('failed'); expect(e.runs[0]!.reportStatus).toBe('complete'); expect(JSON.stringify(e)).not.toContain('PRIVATE_PROVIDER_ERROR');
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
});
describe('dashboard run views and live events', () => {
  const png = (label: string) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]);
  /** One recorded run: a key per step, each followed by a distinct diagnostic screenshot, ending with the given outcome. */
  const script = (keys: string[], status: 'success' | 'failure') => async (trace: TraceRecorder, out: string) => {
    await mkdir(join(out, 'diagnostics'), { recursive: true });
    const shot = async (step: number) => { await writeFile(join(out, 'diagnostics', `step-${step}.png`), png('step' + step)); trace.append('browser.screenshot', { step, path: `diagnostics/step-${step}.png`, policyVisible: false }, { source: 'browser-diagnostic' }); };
    await shot(0);
    for (const [i, key] of keys.entries()) {
      trace.append('policy.decision', { step: i + 1, decision: { action: { kind: 'key', key } } }, { source: 'policy' });
      trace.append('action.result', { step: i + 1, ok: true, action: { kind: 'key', key } });
      await shot(i + 1);
    }
    return { status, steps: keys.length };
  };
  async function launch(scripts: (((trace: TraceRecorder, out: string) => Promise<{ status: 'success' | 'failure'; steps: number }>) | 'throw')[], tweak: (config: ProjectConfig) => void = () => {}) {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup(); tweak(config); await store.save(config, initial.revision, { file: 'task.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
      const next = scripts.shift(); if (!next || next === 'throw') throw new Error('no trace');
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
      return trace.finalize(await next(trace, out));
    } }); apps.push(app);
    const experiment = async (profileIds: string[], repeats = 1) => {
      const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, profileIds, repeats }) });
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
    expect(view).toMatchObject({ experimentId: ok.id, runId: ok.runs[0]!.id, live: false, });
    expect(Array.isArray(view.hints)).toBe(true);
    expect(view.steps.map(s => s.step)).toEqual([0, 1, 2]);
    expect(view.steps[1]).toMatchObject({ action: { kind: 'key', key: 'Tab' }, ok: true });
    expect(view.steps.every(s => typeof s.screenshot?.eventId === 'string')).toBe(true);
    const image = await get(ok, 0, 'png/' + encodeURIComponent(view.steps[2]!.screenshot!.eventId));
    expect(image.status).toBe(200); expect(Buffer.from(await image.arrayBuffer()).equals(png('step2'))).toBe(true);
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
    expect(noTrace.status).toBe(404); expect((await noTrace.json() as { error: object }).error).toEqual({ code: 'trace-missing' });
    const short = await experiment(['default']), slow = await experiment(['other']), middle = await experiment(['other']);
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
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out, _signal, onEvent) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out, { onEvent }); await trace.initialize();
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
    const created = await fetch(app.url + '/api/experiments', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify({ ...request, profileIds: ['default'] }) });
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
  it('plans one row per repeat and run profile, in a key that names each of them', async () => {
    const config = setup(); config.profiles.push({ ...profileWith('reader', 'a', 'planner-a', 'Reader'), actions: { keys: ['Tab'], intents: ['next'], typeText: false, replaceText: false } });
    const { app } = await create(config)();
    const asked: PlanRequest = { ...request, profileIds: ['default', 'reader'], repeats: 2 };
    const rows = (await app.queue.plan(asked)).rows;
    expect(rows.map(r => [r.key, r.repeat])).toEqual([['task:default:1', 1], ['task:default:2', 2], ['task:reader:1', 1], ['task:reader:2', 2]]);
    expect(rows[0]).not.toHaveProperty('mode'); expect(rows[0]).not.toHaveProperty('structure');
    // Each profile brings its own actions.
    expect(rows[0]!.permissions.intents).toEqual(['next', 'previous', 'activate']); expect(rows[2]!.permissions).toMatchObject({ keys: ['Tab'], intents: ['next'] });
    const e = await app.queue.create({ ...asked, selected: [rows[1]!.key, rows[2]!.key] });
    expect(e.runs.map(r => [r.profileId, r.repeat])).toEqual([['default', 2], ['reader', 1]]); expect(e.runs[0]!.snapshot.spec).not.toHaveProperty('mode');
    expect(e.runs.map(r => r.snapshot.spec.conditions)).toEqual([expect.objectContaining({ profile: expect.objectContaining({ id: 'default' }) }), expect.objectContaining({ profile: expect.objectContaining({ id: 'reader' }), atEnvironment: expect.objectContaining({ backend: 'simulation' }) })]);
    expect(e.runs[1]!.snapshot.spec).toMatchObject({ plannerModel: { id: 'a', modelId: 'planner-a' }, plannerInstructions: '' });
    await waitFor(async () => e.runs.every(r => !!r.endedAt));
  });
  it('multiplies run profiles by page environments and records the resolved environment in the run snapshot', async () => {
    const { app } = await create()();
    const asked = { ...request, profileIds: ['default', 'default-narrow', 'other', 'other-narrow'] };
    const rows = (await app.queue.plan(asked)).rows;
    expect(rows.map(r => [r.key, r.profileId, r.supported])).toEqual([
      ['task:default:1', 'default', true], ['task:default-narrow:1', 'default-narrow', true],
      ['task:other:1', 'other', true], ['task:other-narrow:1', 'other-narrow', true],
    ]);
    const e = await app.queue.create(asked);
    expect(e.runs.map(r => r.snapshot.spec.conditions)).toEqual(expect.arrayContaining([expect.objectContaining({ pageEnvironment: expect.objectContaining({ profile: 'narrow' }) })]));
    expect(e.runs[1]!.snapshot.spec.environment).toMatchObject({ viewport: { width: 320, height: 800 } });
    expect(e.runs[0]!.snapshot.spec.environment).not.toEqual(e.runs[1]!.snapshot.spec.environment);
    expect((await app.queue.plan({ ...asked, profileIds: ['missing'] })).rows).toEqual([]);
    await waitFor(async () => e.runs.every(r => !!r.endedAt));
  });
  it('plans the profiles a request lists, and refuses a request that lists none: tasks name no profile', async () => {
    const config = setup(); config.profiles[1]!.actions = { keys: ['Tab'], intents: [], typeText: false, replaceText: false };
    const { app } = await create(config)();
    const { profileIds: _profiles, ...withoutProfiles } = request;
    const rows = (await app.queue.plan({ ...withoutProfiles, profileIds: ['other', 'default-narrow'] })).rows;
    expect(rows.map(r => r.profileId)).toEqual(['other', 'default-narrow']);
    expect(rows[0]!.permissions.keys).toEqual(['Tab']);
    await expect(app.queue.plan(withoutProfiles as never)).rejects.toThrow();
    await expect(app.queue.plan({ ...request, profileIds: [] })).rejects.toThrow();
    await expect(app.queue.plan({ ...request, modes: ['keyboard'] } as never)).rejects.toThrow();
    expect(app.queue.experiments).toHaveLength(0);
  });
  it('gives runs the profile\'s planner, and refuses a profile without one', async () => {
    const config = setup();
    config.profiles[0] = profileWith('default', 'a', 'planner-fixture', 'Default', 'Plan in small steps');
    config.profiles.push(defaultProfile('reader', 'Reader'));
    const { app } = await create(config)();
    const planned: PlanRequest = { ...request, profileIds: ['default'] };
    expect((await app.queue.plan(planned)).rows[0]).toMatchObject({ supported: true, plannerName: 'a · planner-fixture', warnings: [] });
    const made = await app.queue.create(planned), spec = made.runs[0]!.snapshot.spec;
    expect(made.runs[0]).toMatchObject({ plannerName: 'a · planner-fixture' });
    expect(spec).toMatchObject({ plannerInstructions: 'Plan in small steps', plannerModel: { id: 'a', modelId: 'planner-fixture' } });
    expect(spec.conditions).toMatchObject({ combo: { planner: 'a · planner-fixture' } }); expect((spec.conditions as { combo: object }).combo).not.toHaveProperty('structure');
    await waitFor(async () => !!made.runs[0]!.endedAt);
    // A run always plans, so a profile without a planner is not supported.
    expect((await app.queue.plan({ ...planned, profileIds: ['reader'] })).rows[0]).toMatchObject({ supported: false, reason: { code: 'planner-model-invalid' } });
  });
  it('applies the profile\'s run rules, with the experiment\'s over them, to the snapshot, and the analysis instructions of the project or the task', async () => {
    const config = setup();
    config.project.analysis.instructions = 'project focus';
    config.profiles[0]!.runRules = { ...config.profiles[0]!.runRules, maxUnchangedTransitions: 3, maxPlannerCalls: 4 }; config.profiles[1]!.runRules = { ...config.profiles[1]!.runRules, maxUnchangedTransitions: 7 };
    config.tasks.push({ id: 'focused', name: 'Focused', file: 'focused.json', analysisInstructions: 'task focus' });
    const { app } = await create(config, { 'focused.json': task })();
    const e = await app.queue.create({ ...request, taskIds: ['task', 'focused'], profileIds: ['default'] }), other = await app.queue.create({ ...request, profileIds: ['other'] });
    const over = await app.queue.create({ ...request, profileIds: ['default'], runRules: { maxUnchangedTransitions: 9, repetitionGuard: false } });
    const [plain, focused] = e.runs;
    expect(plain!.snapshot.spec.settings.runRules).toMatchObject({ maxUnchangedTransitions: 3, maxPlannerCalls: 4, repetitionGuard: true });
    expect(focused!.snapshot.spec.settings.runRules).toMatchObject({ maxUnchangedTransitions: 3, maxPlannerCalls: 4 });
    expect(other.runs[0]!.snapshot.spec.settings.runRules).toMatchObject({ maxUnchangedTransitions: 7 });
    expect(over.runs[0]!.snapshot.spec.settings.runRules).toMatchObject({ maxUnchangedTransitions: 9, maxPlannerCalls: 4, repetitionGuard: false });
    expect(plain!.snapshot.spec.conditions).toMatchObject({ profile: { id: 'default' }, combo: { id: 'default' } });
    expect(plain!.profileId).toBe('default'); expect(plain!.snapshot.taskName).toBe('Fixture');
    expect(plain!.analysisInstructions).toBe('project focus'); expect(focused!.analysisInstructions).toBe('task focus');
    await waitFor(async () => [...e.runs, ...other.runs, ...over.runs].every(r => !!r.endedAt));
  });
  it('rejects configs without unique ids and profiles with unknown environments, and tasks that name a profile', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    const fails = (code: string) => expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ status: 400, code });
    config.profiles.push(defaultProfile()); await fails('duplicate-id');
    await expect(store.save({ ...setup(), tasks: [{ id: 'task', name: 'Fixture', file: 'task.json', profileId: 'default' }] } as never, initial.revision, { file: 'task.json', task })).rejects.toThrow();
    expect(() => store.validateReferences({ ...setup(), profiles: [{ ...defaultProfile(), page: 'no-such-environment' }] })).toThrow();
  });
});
