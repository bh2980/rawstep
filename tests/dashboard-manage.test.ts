import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { buildModel, defaultConfig, defaultModes, type ProjectConfig } from '@rawstep/project/config';
import type { BrowserCheck, ModelCheck } from '../packages/dashboard/src/shared/api.js';
import type { ConfigView, DeleteTaskResult } from '../packages/dashboard/src/shared/config.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [], servers: Server[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); })));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const root = async () => { const dir = await mkdtemp(join(tmpdir(), 'rawstep-manage-')); dirs.push(dir); return dir; };
const exists = (path: string) => access(path).then(() => true, () => false);
const task = { url: 'https://example.com', goal: 'Reach the thanks page', verify: { all: [{ urlIncludes: '/thanks' }] } };

/** A project with one task in tasks/ and one linked from elsewhere in the project. */
async function project(): Promise<{ dir: string; config: ProjectConfig; revision: string }> {
  const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = defaultConfig();
  await mkdir(join(dir, 'e2e'), { recursive: true });
  config.tasks.push({ id: 'owned', name: 'Owned', file: 'tasks/owned.json', modes: defaultModes() }, { id: 'linked', name: 'Linked', file: 'e2e/linked.json', modes: defaultModes() });
  await writeFile(join(dir, 'e2e/linked.json'), JSON.stringify(task));
  const saved = await store.save(config, initial.revision, { file: 'tasks/owned.json', task });
  return { dir, config: saved.config, revision: saved.revision };
}
const call = (url: string, method: string, path: string, body?: unknown) => fetch(url + path, { method, headers: { 'content-type': 'application/json', origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe('deleting a task', () => {
  it('removes the task and its file under tasks/, keeps run records, and says what it did', async () => {
    const { dir, revision } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    await mkdir(join(dir, '.rawstep/experiments/e1/r1'), { recursive: true }); await writeFile(join(dir, '.rawstep/experiments/e1/r1/trace.json'), '{}');
    const response = await call(app.url, 'DELETE', '/api/tasks/owned', { revision });
    expect(response.status).toBe(200);
    const result = await response.json() as DeleteTaskResult;
    expect(result).toMatchObject({ file: 'tasks/owned.json', fileRemoved: true });
    expect(result.view.config.tasks.map(item => item.id)).toEqual(['linked']);
    expect(await exists(join(dir, 'tasks/owned.json'))).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).tasks.map((item: { id: string }) => item.id)).toEqual(['linked']);
    expect(await exists(join(dir, '.rawstep/experiments/e1/r1/trace.json'))).toBe(true);
  });

  it('only unregisters a task linked from elsewhere in the project: that file is the person\'s own', async () => {
    const { dir, revision } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const result = await (await call(app.url, 'DELETE', '/api/tasks/linked', { revision })).json() as DeleteTaskResult;
    expect(result).toMatchObject({ file: 'e2e/linked.json', fileRemoved: false });
    expect(await exists(join(dir, 'e2e/linked.json'))).toBe(true);
  });

  it('refuses a stale revision, an unknown task and a task with a run in progress', async () => {
    const { dir, revision } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const stale = await call(app.url, 'DELETE', '/api/tasks/owned', { revision: 'stale' });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toContain('변경');
    expect(await exists(join(dir, 'tasks/owned.json'))).toBe(true);
    const unknown = await call(app.url, 'DELETE', '/api/tasks/ghost', { revision });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toContain('작업');
    expect((await call(app.url, 'DELETE', '/api/tasks/owned', {})).status).toBe(400);
    // A queued run of the task blocks deleting it.
    app.queue.experiments.push({ id: 'e', createdAt: new Date().toISOString(), stopped: false, request: { taskIds: ['owned'], modelIds: [], promptIds: [], repeats: 1, mode: 'keyboard' }, runs: [{ id: 'r', taskId: 'owned', state: 'queued' } as never] });
    const busy = await call(app.url, 'DELETE', '/api/tasks/owned', { revision });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: string }).error).toContain('진행 중');
    expect((await (await fetch(app.url + '/api/state')).json() as ConfigView).config.tasks).toHaveLength(2);
  });
});

/** A small model server: a list that answers with the given status and models. */
async function modelServer(status: number, models: string[]): Promise<{ url: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    requests.push(req); res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? JSON.stringify({ data: models.map(id => ({ id })) }) : JSON.stringify({ error: 'provider-secret-text' }));
  });
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('bind failed');
  return { url: `http://127.0.0.1:${address.port}/v1`, requests };
}

describe('checking a model', () => {
  const body = (baseURL: string, modelId: string, extra: Record<string, unknown> = {}) => ({ kind: 'llm', provider: 'custom', modelId, baseURL, ...extra });

  it('asks the model list once and answers ready, or says why not, by kind', async () => {
    const { dir } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const ok = await modelServer(200, ['alpha', 'beta']);
    const ready = await (await call(app.url, 'POST', '/api/models/check', body(ok.url, 'alpha'))).json() as ModelCheck;
    expect(ready).toMatchObject({ ok: true, kind: 'ready', via: 'model-list' });
    expect(ok.requests).toHaveLength(1);
    expect(ok.requests[0]!.url).toBe('/v1/models');
    expect(await (await call(app.url, 'POST', '/api/models/check', body(ok.url, 'gamma'))).json()).toMatchObject({ ok: false, kind: 'model-not-listed' });
    const empty = await modelServer(200, []);
    expect(await (await call(app.url, 'POST', '/api/models/check', body(empty.url, 'alpha'))).json()).toMatchObject({ ok: true, kind: 'unverified' });
    const refused = await modelServer(401, []);
    const rejected = await (await call(app.url, 'POST', '/api/models/check', body(refused.url, 'alpha'))).text();
    expect(JSON.parse(rejected)).toMatchObject({ ok: false, kind: 'rejected' });
    expect(rejected).not.toContain('provider-secret-text');
    expect(await (await call(app.url, 'POST', '/api/models/check', body('http://127.0.0.1:1/v1', 'alpha'))).json()).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(await (await call(app.url, 'POST', '/api/models/check', body('http://example.com/v1', 'alpha'))).json()).toMatchObject({ ok: false, kind: 'invalid-address' });
  });

  it('needs the key of a keyed provider before it asks anyone, and never stores a key typed for a custom server', async () => {
    const { dir } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const missing = await (await call(app.url, 'POST', '/api/models/check', { kind: 'llm', provider: 'anthropic', modelId: 'claude' })).json() as ModelCheck;
    expect(missing).toMatchObject({ ok: false, kind: 'missing-key', via: 'none' });
    const server = await modelServer(200, ['alpha']);
    await call(app.url, 'POST', '/api/models/check', body(server.url, 'alpha', { apiKey: 'typed-key-123' }));
    expect(server.requests[0]!.headers.authorization).toBe('Bearer typed-key-123');
    expect(await exists(join(dir, '.env.local'))).toBe(false);
  });

  it('checks a registered model by its id with the key stored for it', async () => {
    const { dir } = await project(), store = new ProjectStore(dir), server = await modelServer(200, ['alpha']);
    const current = await store.read(), config = structuredClone(current.config);
    config.models.push(buildModel({ id: 'm1', name: 'M1', kind: 'llm', provider: 'custom', modelId: 'alpha', baseURL: server.url, apiKeyEnv: 'RAWSTEP_MANAGE_TEST_KEY' }));
    await store.save(config, current.revision);
    await store.setCredential(config.models[0]!, 'stored-key-456');
    const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    expect(await (await call(app.url, 'POST', '/api/models/check', { id: 'm1' })).json()).toMatchObject({ ok: true, kind: 'ready' });
    expect(server.requests[0]!.headers.authorization).toBe('Bearer stored-key-456');
    expect((await call(app.url, 'POST', '/api/models/check', { id: 'ghost' })).status).toBe(404);
    expect((await call(app.url, 'POST', '/api/models/check', { kind: 'llm', provider: 'typesafe', modelId: 'x' })).status).toBe(400);
    expect((await call(app.url, 'POST', '/api/models/check', { kind: 'llm', provider: 'custom', modelId: 'x' })).status).toBe(400);
  });
});

describe('checking the browser', () => {
  it('reports a browser that cannot start by kind without launching one or quoting the error', async () => {
    const { dir } = await project(), app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
    const response = await call(app.url, 'POST', '/api/browser/check', { machine: { browserExecutablePath: join(dir, 'no-such-browser') } });
    expect(response.status).toBe(200);
    const text = await response.text(), check = JSON.parse(text) as BrowserCheck;
    expect(check).toEqual({ ok: false, kind: 'launch-failed', source: 'custom' });
    expect(text).not.toContain('no-such-browser');
    expect((await call(app.url, 'POST', '/api/browser/check', { machine: { backend: 'bogus' } })).status).toBe(400);
  });
});
