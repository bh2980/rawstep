import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TraceRecorder } from '@rawstep/core/trace';
import { BatchQueue, type Experiment } from '@rawstep/project/batch';
import { lockBrowserProfile, type RunExecutor } from '@rawstep/project/execution';
import { runSuite, runTask } from '@rawstep/project/run';
import { resolveTask } from '@rawstep/core/contracts';
import { ProjectStore, initProject } from '@rawstep/project/store';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function project() { const dir = await mkdtemp(join(tmpdir(), 'rawstep-batch-')); dirs.push(dir); await initProject(dir); return { dir, store: new ProjectStore(dir) }; }
/** The pid of a process that has just exited: no process has it now. */
const deadPid = () => new Promise<number>(resolve => { const child = spawn(process.execPath, ['-e', '0']); child.on('exit', () => resolve(child.pid!)); });
/** A batch as another process would have written it, with one run in the given state. */
async function writeBatch(dir: string, owner: Experiment['owner'], state: 'running' | 'queued' | 'success' = 'running'): Promise<string> {
  const id = randomUUID();
  const experiment = { id, createdAt: new Date().toISOString(), stopped: false, request: { taskIds: ['demo'], profileIds: ['written-plan'], repeats: 1 }, ...(owner ? { owner } : {}),
    runs: [{ key: 'demo:written-plan:1', taskId: 'demo', repeat: 1, profileId: 'written-plan', supported: true, warnings: [], permissions: { intents: [], keys: [], typeText: true, replaceText: false },
      id: randomUUID(), state, analysisStatus: 'pending', reportStatus: 'pending', snapshot: { taskName: 'Demo', spec: {} } }] };
  await mkdir(join(dir, '.rawstep', 'experiments', id), { recursive: true });
  await writeFile(join(dir, '.rawstep', 'experiments', id, 'experiment.json'), JSON.stringify(experiment));
  return id;
}
const recorded: RunExecutor = async (spec, { outDir }) => {
  const trace = new TraceRecorder({ ...spec.task, id: spec.task.id ?? 'fixture' }, outDir); await trace.initialize();
  trace.append('simulation.observation', { speech: ['start'] }, { source: 'runner' });
  return trace.finalize({ status: 'success', steps: 1 });
};

describe('batches shared by the CLI and the dashboard', () => {
  it('leaves a batch alone while the process running it lives, and marks it interrupted once that process is gone', async () => {
    const { dir, store } = await project();
    const live = await writeBatch(dir, { pid: process.ppid, host: hostname(), via: 'cli' });
    const gone = await writeBatch(dir, { pid: await deadPid(), host: hostname(), via: 'cli' });
    const old = await writeBatch(dir, undefined);
    const queue = new BatchQueue(store); await queue.initialize();
    const state = (id: string) => queue.experiments.find(e => e.id === id)!.runs[0]!.state;
    expect(state(live)).toBe('running');
    expect(state(gone)).toBe('interrupted'); expect(state(old)).toBe('interrupted');
    expect(JSON.parse(await readFile(join(dir, '.rawstep', 'experiments', gone, 'experiment.json'), 'utf8')).runs[0].error).toBe('run-restarted');
    await expect(queue.cancel(live)).rejects.toMatchObject({ code: 'batch-running-elsewhere', status: 409 });
    await queue.close();
  });

  it('picks up batches another process writes or removes after it started', async () => {
    const { dir, store } = await project();
    let changes = 0;
    const queue = new BatchQueue(store, { onChange: () => changes++ }); await queue.initialize();
    expect(queue.experiments).toEqual([]);
    const id = await writeBatch(dir, { pid: process.ppid, host: hostname(), via: 'cli' }, 'success');
    expect(await queue.refresh()).toBe(true); expect(queue.experiments.map(e => e.id)).toEqual([id]); expect(changes).toBe(1);
    expect(await queue.refresh()).toBe(false);
    await rm(join(dir, '.rawstep', 'experiments', id), { recursive: true });
    expect(await queue.refresh()).toBe(true); expect(queue.experiments).toEqual([]);
    await queue.close();
  });

  it('runs a suite of the tasks with a tag under each profile and groups the runs, and names the tags there are when none match', async () => {
    const { dir, store } = await project();
    const { config, revision } = await store.read();
    config.tasks[0]!.tags = ['shop'];
    config.profiles[1] = { ...config.profiles[1]!, planner: { planFile: 'rawstep/demo/plan.json' } };
    await store.save(config, revision);
    const result = await runSuite({ projectDir: dir, tags: ['shop'], profiles: ['written-plan', 'item-by-item'], repeat: 2, parallel: 2 }, { execute: recorded });
    expect(result.groups.map(g => [g.taskId, g.profileId, g.runs.length])).toEqual([['demo', 'written-plan', 2], ['demo', 'item-by-item', 2]]);
    expect(result.runs).toHaveLength(4);
    expect(JSON.parse(await readFile(join(result.batch.dir, 'experiment.json'), 'utf8')).owner).toMatchObject({ via: 'cli' });
    await expect(runSuite({ projectDir: dir, tags: ['nope'] }, { execute: recorded })).rejects.toMatchObject({ code: 'no-tasks', message: expect.stringContaining('Tags in this project: shop') });
  });

  it('lets one run at a time keep the browser profile, and takes over a lock whose process is gone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-lock-')); dirs.push(dir);
    const profile = join(dir, '.rawstep', 'browser-profile');
    const release = await lockBrowserProfile(profile);
    await expect(lockBrowserProfile(profile)).rejects.toMatchObject({ code: 'browser-profile-busy' });
    await release();
    // Another live process holding it.
    await writeFile(profile + '.lock', JSON.stringify({ pid: process.ppid, host: hostname() }));
    await expect(lockBrowserProfile(profile)).rejects.toMatchObject({ code: 'browser-profile-busy' });
    await writeFile(profile + '.lock', JSON.stringify({ pid: await deadPid(), host: hostname() }));
    const taken = await lockBrowserProfile(profile);
    expect(JSON.parse(await readFile(profile + '.lock', 'utf8')).pid).toBe(process.pid);
    await taken();
    await expect(readFile(profile + '.lock')).rejects.toThrow();
  });

  it('runs each task with its usual profiles when no profile is named, and every task with the named ones otherwise', async () => {
    const { dir, store } = await project();
    const { config, revision } = await store.read();
    config.profiles[1] = { ...config.profiles[1]!, planner: { planFile: 'rawstep/demo/plan.json' } };
    await writeFile(join(dir, 'again.json'), (await readFile(join(dir, config.tasks[0]!.file), 'utf8')).replace('"page.html"', '"rawstep/demo/page.html"'));
    config.tasks.push({ id: 'again', name: 'Again', file: 'again.json', profiles: ['item-by-item', 'written-plan'] });
    await store.save(config, revision);
    const usual = await runSuite({ projectDir: dir }, { execute: recorded });
    expect(usual.groups.map(g => [g.taskId, g.profileId])).toEqual([['demo', 'written-plan'], ['again', 'item-by-item'], ['again', 'written-plan']]);
    const named = await runSuite({ projectDir: dir, profiles: ['item-by-item'] }, { execute: recorded });
    expect(named.groups.map(g => [g.taskId, g.profileId])).toEqual([['demo', 'item-by-item'], ['again', 'item-by-item']]);
    expect((await runTask('again', { projectDir: dir }, { execute: recorded })).runs.map(r => r.profileId)).toEqual(['item-by-item']);
    const broken = await store.read();
    broken.config.tasks[1]!.profiles = ['ghost'];
    await expect(store.save(broken.config, broken.revision)).rejects.toThrow(/does not exist \(ghost\)/);
  });

  it('takes what a site needs of the browser from the task, and keeps runs that share the kept profile to one at a time', async () => {
    expect(resolveTask({ url: 'https://shop.example/', goal: 'Buy', verify: { all: [{ urlIncludes: 'done' }] }, browser: { mode: 'connect', copySignIn: true } }).browser).toEqual({ mode: 'connect', copySignIn: true });
    expect(() => resolveTask({ url: 'https://shop.example/', goal: 'Buy', verify: { all: [{ urlIncludes: 'done' }] }, browser: { mode: 'launch', copySignIn: true } })).toThrow(/copySignIn needs mode "connect"/);
    expect(() => resolveTask({ url: 'https://shop.example/', goal: 'Buy', verify: { all: [{ urlIncludes: 'done' }] }, browser: { mode: 'remote' } })).toThrow(/browser.mode/);
    const { dir, store } = await project();
    const demo = JSON.parse(await readFile(join(dir, 'rawstep', 'demo', 'task.json'), 'utf8'));
    await writeFile(join(dir, 'checked.json'), JSON.stringify({ ...demo, url: '../rawstep/demo/page.html', browser: { mode: 'launch', personCheck: true } }));
    await writeFile(join(dir, 'connected.json'), JSON.stringify({ ...demo, url: '../rawstep/demo/page.html', browser: { mode: 'connect' } }));
    const { config, revision } = await store.read();
    config.tasks.push({ id: 'checked', name: 'Checked', file: 'checked.json' });
    await store.save(config, revision);
    let checked = 0, most = 0, all = 0, mostAll = 0;
    const execute: RunExecutor = async (spec, run) => {
      const keeps = !!spec.task.browser?.personCheck; all++; mostAll = Math.max(mostAll, all); if (keeps) { checked++; most = Math.max(most, checked); }
      await new Promise(resolve => setTimeout(resolve, 30));
      all--; if (keeps) checked--;
      return recorded(spec, run);
    };
    await runSuite({ projectDir: dir, repeat: 3, parallel: 3 }, { execute });
    expect(most).toBe(1); expect(mostAll).toBeGreaterThan(1);
    const later = await store.read();
    later.config.tasks.push({ id: 'connected', name: 'Connected', file: 'connected.json' });
    await store.save(later.config, later.revision);
    await expect(runTask('connected', { projectDir: dir }, { execute: recorded })).rejects.toMatchObject({ code: 'browser-endpoint-missing' });
  });
});
