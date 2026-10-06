import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function dashboard() {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-credentials-')); dirs.push(dir);
  const store = new ProjectStore(dir), initial = await store.initialize();
  const custom = { id: 'local', name: 'Local', kind: 'decision' as const, provider: 'custom' as const, baseURL: 'http://127.0.0.1:8000/v1', apiKeyEnv: 'RAWSTEP_LOCAL_KEY', timeoutMs: 10000 };
  await store.save({ ...initial.config, connections: [custom] }, initial.revision);
  const app = await startDashboard({ projectDir: dir, port: 0 }); apps.push(app);
  const post = (path: string, body: unknown) => fetch(app.url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.url }, body: JSON.stringify(body) });
  return { post };
}

describe('saved API keys in the connection editor', () => {
  it('reveals a saved key for its provider or custom connection, and nothing when none is saved', async () => {
    const { post } = await dashboard();
    expect(await (await post('/api/credentials/reveal', { provider: 'openrouter' })).json()).toEqual({ value: null });
    expect((await post('/api/credentials', { provider: 'openrouter', value: 'sk-or-test' })).status).toBe(200);
    expect(await (await post('/api/credentials/reveal', { provider: 'openrouter' })).json()).toEqual({ value: 'sk-or-test' });
    expect((await post('/api/credentials', { connectionId: 'local', value: 'local-secret' })).status).toBe(200);
    expect(await (await post('/api/credentials/reveal', { connectionId: 'local' })).json()).toEqual({ value: 'local-secret' });
    expect((await post('/api/credentials/reveal', { connectionId: 'missing' })).status).toBe(404);
  });

  it('refuses requests from another origin', async () => {
    const { post } = await dashboard();
    const app = apps[0]!;
    const foreign = await fetch(app.url + '/api/credentials/reveal', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ provider: 'openrouter' }) });
    expect(foreign.status).toBe(403);
    void post;
  });
});
