import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyTask, type VerificationContext } from '@rawstep/browser/verify';
import type { BrowserSession } from '@rawstep/browser/browser';
import type { ObserverEvent } from '@rawstep/browser/observer';
import type { Task, VerifyRule } from '@rawstep/core/contracts';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ExperimentQueue } from '../packages/dashboard/src/server/queue.js';
import { ProjectStore } from '@rawstep/project/store';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function temp(prefix: string) { const dir = await mkdtemp(join(tmpdir(), prefix)); dirs.push(dir); return dir; }

describe('focused rule uses the focus record that still holds', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const ev = (kind: ObserverEvent['kind'], step: number, extra: Partial<ObserverEvent> = {}): ObserverEvent => ({ kind, step, at, frame: 'main', ...extra });
  const task = (...all: VerifyRule[]): Task => ({ url: 'https://example.test', goal: 'Verify focus', verify: { all } });
  const run = (timeline: readonly ObserverEvent[]) => verifyTask(task({ focused: { role: 'button' } }), {} as BrowserSession, { timeline } as VerificationContext).then(result => result.rules![0]!);
  const focus = ev('focus', 1, { role: 'button', name: 'Save' });
  it('ends focus on a later cross-document navigation', async () => {
    expect((await run([focus, ev('navigation', 2, { sameDocument: false, url: 'https://example.test/next' })])).passed).toBe(false);
  });
  it('keeps focus across a same-document navigation', async () => {
    expect((await run([focus, ev('navigation', 2, { sameDocument: true, url: 'https://example.test/#x' })])).passed).toBe(true);
  });
  it('ends focus on a page-blur that is not regained', async () => {
    expect((await run([focus, ev('page-blur', 2)])).passed).toBe(false);
  });
  it('keeps focus when page-blur is followed by page-focus', async () => {
    expect((await run([focus, ev('page-blur', 2), ev('page-focus', 3)])).passed).toBe(true);
  });
});

describe('dashboard static file containment', () => {
  const get = (base: string, path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const url = new URL(base);
    // http.request does not normalize the path, so encoded traversal reaches the server as written.
    const req = httpRequest({ host: url.hostname, port: url.port, path, method: 'GET' }, res => {
      const chunks: Buffer[] = []; res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
  it('serves files under webDir and refuses encoded traversal, including sibling-prefix directories', async () => {
    const base = await temp('rawstep-static-'), webDir = join(base, 'web'), sibling = join(base, 'web-private');
    await mkdir(join(webDir, 'assets'), { recursive: true }); await mkdir(sibling);
    await writeFile(join(webDir, 'index.html'), '<html>INDEX</html>');
    await writeFile(join(webDir, 'assets', 'x.js'), 'console.log("ASSET_MARKER")');
    await writeFile(join(base, 'secret.txt'), 'PARENT_SECRET');
    await writeFile(join(sibling, 'secret.txt'), 'SIBLING_SECRET');
    const project = await temp('rawstep-static-project-');
    const app = await startDashboard({ projectDir: project, port: 0, webDir }); apps.push(app);
    const asset = await get(app.url, '/assets/x.js');
    expect(asset.status).toBe(200); expect(asset.body).toContain('ASSET_MARKER');
    for (const path of ['/%2e%2e%2fsecret.txt', '/..%2fsecret.txt', '/%2e%2e%2fweb-private%2fsecret.txt', '/assets%2f..%2f..%2fsecret.txt']) {
      const response = await get(app.url, path);
      expect(response.status, path).toBe(403);
      expect(response.body, path).not.toMatch(/PARENT_SECRET|SIBLING_SECRET/);
    }
  });
});

describe('ExperimentQueue.initialize crash recovery', () => {
  it('skips a UUID experiment directory that has no experiment.json', async () => {
    const dir = await temp('rawstep-queue-'), store = new ProjectStore(dir); await store.initialize();
    const orphan = randomUUID();
    await mkdir(join(dir, '.rawstep', 'experiments', orphan), { recursive: true });
    const queue = new ExperimentQueue(store);
    await expect(queue.initialize()).resolves.toBeUndefined();
    expect(queue.experiments).toEqual([]);
    await queue.close();
  });
});

