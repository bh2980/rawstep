import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultConfig, defaultModes, type ProjectConfig } from '@rawstep/project/config';
import { connection, profileWith } from './helpers/project-config.js';
import { TraceRecorder } from '@rawstep/core/trace';
import type { Experiment, PlanRequest } from '../packages/dashboard/src/shared/config.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
let afterRelease = () => {};
afterEach(async () => { afterRelease(); afterRelease = () => {}; await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const root = async () => { const dir = await mkdtemp(join(tmpdir(), 'rawstep-run-delete-')); dirs.push(dir); return dir; };
const exists = (path: string) => access(path).then(() => true, () => false);
const task = { url: 'https://example.com', goal: 'Complete fixture', verify: { all: [{ titleIncludes: 'Done' }] } };
const waitFor = async (work: () => boolean) => { for (let i = 0; i < 100; i++) { if (work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); };
function setup(): ProjectConfig {
  const config = defaultConfig();
  config.connections.push(connection('a')); config.profiles[0] = profileWith('default', 'a', 'm-a', 'Default');
  const modes = defaultModes(); modes.keyboard.prompts.push({ id: 'careful', name: 'Careful', version: '2', instructions: 'Careful fixture instructions' });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json', modes }); return config;
}
const request: PlanRequest = { taskIds: ['task'], promptIds: ['baseline', 'careful'], profileIds: ['default'], repeats: 1, mode: 'keyboard' };
const call = (url: string, method: string, path: string, body?: unknown) => fetch(url + path, { method, headers: { 'content-type': 'application/json', origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** A dashboard whose runs finish at once, or wait for `release()` when `hold` is set. */
async function start(hold = false) {
  const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize();
  await store.save(setup(), initial.revision, { file: 'task.json', task });
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const app = await startDashboard({ projectDir: dir, port: 0, execute: async (_run, actual, out) => {
    if (hold) await gate;
    const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize(); return trace.finalize({ status: 'success', steps: 0 });
  } }); apps.push(app);
  return { dir, app, release };
}
const finished = (experiment: Experiment) => waitFor(() => experiment.runs.every(r => !!r.endedAt));
const runDir = (dir: string, experiment: Experiment, index: number) => join(dir, '.rawstep/experiments', experiment.id, experiment.runs[index]!.id);

describe('deleting run records', () => {
  it('removes one run with its files and keeps the others, also on disk after a restart', async () => {
    const { dir, app } = await start(), experiment = await app.queue.create(request); await finished(experiment);
    const [first, second] = [experiment.runs[0]!.id, experiment.runs[1]!.id], firstDir = runDir(dir, experiment, 0), secondDir = runDir(dir, experiment, 1);
    expect(await exists(firstDir)).toBe(true);
    const response = await call(app.url, 'DELETE', `/api/experiments/${experiment.id}/runs/${first}`);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ removed: 1 });
    expect(await exists(firstDir)).toBe(false); expect(await exists(secondDir)).toBe(true);
    expect(experiment.runs.map(r => r.id)).toEqual([second]);
    expect((await call(app.url, 'GET', `/api/experiments/${experiment.id}/runs/${first}/steps`)).status).toBe(404);
    await app.close(); apps.pop();
    const again = await startDashboard({ projectDir: dir, port: 0 }); apps.push(again);
    expect(again.queue.experiments.map(e => e.runs.map(r => r.id))).toEqual([[second]]);
  });

  it('removes the experiment directory when its last run goes, or when the whole experiment is deleted', async () => {
    const { dir, app } = await start(), one = await app.queue.create(request); await finished(one);
    for (const id of one.runs.map(r => r.id)) expect((await call(app.url, 'DELETE', `/api/experiments/${one.id}/runs/${id}`)).status).toBe(200);
    expect(await exists(join(dir, '.rawstep/experiments', one.id))).toBe(false);
    expect(app.queue.experiments.find(e => e.id === one.id)).toBeUndefined();
    const two = await app.queue.create(request); await finished(two);
    const response = await call(app.url, 'DELETE', `/api/experiments/${two.id}`);
    expect(await response.json()).toEqual({ removed: 2 });
    expect(await exists(join(dir, '.rawstep/experiments', two.id))).toBe(false);
    expect(app.queue.experiments).toHaveLength(0);
    expect((await call(app.url, 'DELETE', `/api/experiments/${two.id}`)).status).toBe(404);
  });

  it('deletes runs of several experiments at once, and nothing when one of them is unknown', async () => {
    const { dir, app } = await start(), one = await app.queue.create(request); await finished(one);
    const two = await app.queue.create(request); await finished(two);
    const missing = await call(app.url, 'POST', '/api/runs/delete', { runs: [{ experiment: one.id, run: one.runs[0]!.id }, { experiment: two.id, run: '00000000-0000-0000-0000-000000000000' }] });
    expect(missing.status).toBe(404); expect(one.runs).toHaveLength(2);
    const response = await call(app.url, 'POST', '/api/runs/delete', { runs: [{ experiment: one.id, run: one.runs[0]!.id }, { experiment: two.id, run: two.runs[0]!.id }, { experiment: two.id, run: two.runs[1]!.id }] });
    expect(await response.json()).toEqual({ removed: 3 });
    expect(app.queue.experiments.map(e => e.id)).toEqual([one.id]); expect(one.runs).toHaveLength(1);
    expect(await exists(join(dir, '.rawstep/experiments', two.id))).toBe(false);
    expect((await call(app.url, 'POST', '/api/runs/delete', { runs: [] })).status).toBe(400);
  });

  it('refuses while a targeted run is running or queued, and removes nothing', async () => {
    const { dir, app, release } = await start(true), experiment = await app.queue.create(request);
    afterRelease = release;
    await waitFor(() => experiment.runs[0]!.state === 'running');
    expect(experiment.runs[1]!.state).toBe('queued');
    for (const [method, path, body] of [
      ['DELETE', `/api/experiments/${experiment.id}`],
      ['DELETE', `/api/experiments/${experiment.id}/runs/${experiment.runs[0]!.id}`],
      ['DELETE', `/api/experiments/${experiment.id}/runs/${experiment.runs[1]!.id}`],
      ['POST', '/api/runs/delete', { runs: [{ experiment: experiment.id, run: experiment.runs[1]!.id }] }],
    ] as const) {
      const response = await call(app.url, method, path, body);
      expect(response.status).toBe(409); expect(((await response.json()) as { error: string }).error).toContain('진행 중');
    }
    expect(experiment.runs).toHaveLength(2); expect(await exists(join(dir, '.rawstep/experiments', experiment.id, 'experiment.json'))).toBe(true);
    release(); await finished(experiment);
    expect((await call(app.url, 'DELETE', `/api/experiments/${experiment.id}`)).status).toBe(200);
  });
});
