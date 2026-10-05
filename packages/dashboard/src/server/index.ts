import { isLoopbackHostname } from '@rawstep/core/defaults';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isScreenshotRef } from '@rawstep/core/trace';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BUILTIN_PROFILES } from '@rawstep/browser/profiles';
import { createBrowserSession } from '@rawstep/browser/browser';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { configSchema, connectionSchema, type ConfigView } from '../shared/config.js';
import { ProjectStore, HttpError, readOptional } from './store.js';
import { ExperimentQueue, type Executor } from './queue.js';
import { backendCapabilities } from './execution.js';
import { discover, record } from './models.js';
import { RunViews } from './views.js';
import type { RunEventMessage } from '../shared/api.js';

export type DashboardServerOptions = { projectDir?: string; port?: number; webDir?: string; allowedOrigin?: string; execute?: Executor };
async function jsonBody(req: IncomingMessage) {
  let length = 0; const chunks: Buffer[] = [];
  for await (const part of req) { const b = Buffer.from(part); length += b.length; if (length > 2000000) throw new HttpError(413, '요청 크기 제한 초과'); chunks.push(b); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new HttpError(400, 'JSON 형식이 잘못되었습니다.'); }
}
export async function startDashboard(options: DashboardServerOptions = {}) {
  const store = new ProjectStore(resolve(options.projectDir ?? process.cwd())); await store.initialize();
  const listeners = new Set<ServerResponse>();
  const changed = () => { for (const res of listeners) res.write('event: changed\ndata: {}\n\n'); };
  // At most one run-event per run every 250 ms (leading edge, then the latest pending message); the UI refetches /steps on each.
  const throttles = new Map<string, { pending?: RunEventMessage; timer: NodeJS.Timeout }>();
  const emit = (message: RunEventMessage) => { for (const res of listeners) res.write('event: run-event\ndata: ' + JSON.stringify(message) + '\n\n'); };
  const tick = (runId: string) => {
    const entry = throttles.get(runId); if (!entry) return;
    if (!entry.pending) { throttles.delete(runId); return; }
    emit(entry.pending); entry.pending = undefined; entry.timer = setTimeout(() => tick(runId), 250); entry.timer.unref();
  };
  const runEvent = (experimentId: string, runId: string, event: { seq: number; type: string }) => {
    const message = { experimentId, runId, seq: event.seq, type: event.type }, entry = throttles.get(runId);
    if (entry) { entry.pending = message; return; }
    emit(message); const timer = setTimeout(() => tick(runId), 250); timer.unref(); throttles.set(runId, { timer });
  };
  const queue = new ExperimentQueue(store, changed, options.execute, runEvent); await queue.initialize();
  const views = new RunViews(store, queue);
  const webDir = options.webDir ?? fileURLToPath(new URL('../web', import.meta.url));
  const server = createServer((req, res) => { void handle(req, res).catch(error => {
    if (res.headersSent) { res.end(); return; }
    const message = error instanceof HttpError ? error.message : error instanceof z.ZodError ? '입력 형식이나 설정이 잘못되었습니다.' : '요청을 처리하지 못했습니다. 프로젝트 파일과 설정을 확인하세요.';
    res.writeHead(error instanceof HttpError ? error.status : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: message }));
  }); });
  let url = '';
  async function state(): Promise<ConfigView> {
    const { config, revision } = await store.read();
    const credentialStatus = Object.fromEntries(await Promise.all(config.connections.map(async c => [c.id, !!await store.credential(c.apiKeyEnv)])));
    const keyboard = backendCapabilities(config, 'keyboard'), screenreader = backendCapabilities(config, 'screenreader');
    return { config, revision, credentialStatus, tasks: await store.tasks(config), profiles: BUILTIN_PROFILES,
      capabilities: { keyboard: { keys: [...keyboard.keys], intents: [...keyboard.intents] }, screenreader: { keys: [...screenreader.keys], intents: [...screenreader.intents] } } };
  }
  const send = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host;
    if (!host || !isLoopbackHostname(new URL('http://' + host).hostname)) throw new HttpError(403, 'Loopback 요청만 허용합니다.');
    const origin = req.headers.origin;
    if (origin && origin !== new URL(url).origin && origin !== options.allowedOrigin) throw new HttpError(403, '요청 Origin을 허용하지 않습니다.');
    const path = new URL(req.url ?? '/', url).pathname, method = req.method ?? 'GET';
    res.setHeader('x-content-type-options', 'nosniff');
    if (path === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: changed\ndata: {}\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res)); return;
    }
    if (path === '/api/state' && method === 'GET') return send(res, await state());
    if (path === '/api/capabilities' && method === 'POST') {
      const globals = configSchema.shape.globals.parse(record(await jsonBody(req)).globals);
      const config = { ...(await store.read()).config, globals };
      return send(res, { keyboard: backendCapabilities(config, 'keyboard'), screenreader: backendCapabilities(config, 'screenreader') });
    }
    if (path === '/api/backend/check' && method === 'POST') {
      const globals = configSchema.shape.globals.parse(record(await jsonBody(req)).globals);
      if (globals.backend === 'simulation') {
        const browser = await createBrowserSession('about:blank', { headless: true, executablePath: globals.browserExecutablePath || undefined });
        await browser.close(); return send(res, { message: 'Chromium 연결 확인 완료. 스크린리더 출력은 DOM 기반 모의 관찰입니다.' });
      }
      if ((globals.backend === 'voiceover' && process.platform !== 'darwin') || (globals.backend === 'nvda' && process.platform !== 'win32')) throw new HttpError(400, '선택한 네이티브 스크린리더의 운영체제에서 연결을 확인하세요.');
      const backend = new AtDriverBackend({ profile: globals.backend, url: globals.atEndpoint });
      try { const metadata = await backend.start({ signal: AbortSignal.timeout(5000) }); return send(res, { message: 'AT Driver 세션 연결과 프로필 협상 확인 완료. 실제 발화와 브라우저 행동은 별도 실행으로 확인하세요.', metadata }); }
      catch { throw new HttpError(502, 'AT Driver 연결을 확인하지 못했습니다. 주소와 서버·스크린리더 상태를 확인하세요.'); }
      finally { await backend.close(); }
    }
    if (path === '/api/config' && method === 'PUT') {
      const body = record(await jsonBody(req));
      if (typeof body.revision !== 'string') throw new HttpError(400, '설정 버전이 필요합니다.');
      const task = body.taskWrite ? record(body.taskWrite) : undefined;
      await store.save(body.config, body.revision, task ? { file: String(task.file), task: task.task } : undefined);
      changed(); return send(res, await state());
    }
    if (path === '/api/credentials' && method === 'POST') {
      const body = z.object({ connectionId: z.string(), value: z.string() }).strict().parse(await jsonBody(req));
      const { config } = await store.read(), connection = config.connections.find(c => c.id === body.connectionId);
      if (!connection?.apiKeyEnv) throw new HttpError(400, '연결의 인증키 환경변수 이름이 필요합니다.');
      await store.setCredential(connection.apiKeyEnv, body.value); return send(res, { configured: true });
    }
    if (path === '/api/discover' && method === 'POST') {
      const body = z.object({ connection: connectionSchema }).strict().parse(await jsonBody(req));
      return send(res, await discover(body.connection, await store.credential(body.connection.apiKeyEnv)));
    }
    if (path === '/api/tasks/import' && method === 'POST') {
      const body = z.object({ file: z.string() }).strict().parse(await jsonBody(req));
      return send(res, await store.task(body.file));
    }
    if (path === '/api/plan' && method === 'POST') return send(res, (await queue.plan(await jsonBody(req))).rows);
    if (path === '/api/experiments' && method === 'GET') return send(res, queue.experiments);
    if (path === '/api/overview' && method === 'GET') return send(res, await views.overview());
    if (path === '/api/experiments' && method === 'POST') return send(res, await queue.create(await jsonBody(req)), 201);
    const match = path.match(/^\/api\/experiments\/([0-9a-f-]{36})(?:\/runs\/([0-9a-f-]{36}))?(?:\/(cancel|retry|events|steps|hints|trace|analysis|stop-reason|report|png)(?:\/([^/]+))?)?$/);
    if (match) {
      const [, experimentId, runId, operation, eventId] = match;
      if (operation === 'cancel' && method === 'POST') return send(res, await queue.cancel(experimentId!, runId));
      if (!runId) throw new HttpError(404, '실행 ID가 필요합니다.');
      const run = queue.find(experimentId!, runId);
      if (operation === 'retry' && method === 'GET') return send(res, await queue.previewRetry(experimentId!, runId));
      if (operation === 'retry' && method === 'POST') {
        const body = z.object({ revision: z.string() }).strict().parse(await jsonBody(req));
        return send(res, await queue.retry(experimentId!, runId, body.revision), 201);
      }
      const prefix = '.rawstep/experiments/' + experimentId + '/' + runId + '/';
      if (operation === 'events' && method === 'GET') {
        const raw = await readOptional(await store.file(prefix + 'trace.jsonl')) ?? '';
        const events = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
        return send(res, events.map(event => JSON.parse(JSON.stringify(event, (key, value) => key === 'pngBase64' ? '[PNG: open screenshot]' : value))));
      }
      if (operation === 'steps' && method === 'GET') return send(res, await views.steps(experimentId!, runId));
      if (operation === 'hints' && method === 'GET') return send(res, await views.hints(experimentId!, runId));
      if ((operation === 'trace' || operation === 'analysis' || operation === 'stop-reason') && method === 'GET') {
        const content = await readFile(await store.file(prefix + operation + '.json', true));
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="' + operation + '.json"' }); return res.end(content);
      }
      if (operation === 'report' && method === 'GET') {
        if (run.reportStatus !== 'complete') throw new HttpError(404, '보고서가 아직 준비되지 않았습니다.');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; sandbox" });
        return res.end(await readFile(await store.file(prefix + 'report.html', true)));
      }
      if (operation === 'png' && method === 'GET') {
        const raw = await readOptional(await store.file(prefix + 'trace.jsonl')) ?? '';
        const event = raw.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.id === decodeURIComponent(eventId ?? ''));
        const shot = record(event?.data).screenshot, png = record(shot).pngBase64;
        // Schema 2.2 keeps a blob reference; the path comes from the validated reference (blobs/<sha256>.png), never from the client.
        const blob = isScreenshotRef(shot) ? await readFile(await store.file(prefix + shot.blob, true)).catch(() => undefined) : undefined;
        const bytes = blob && createHash('sha256').update(blob).digest('hex') === (shot as { sha256: string }).sha256 ? blob : typeof png === 'string' ? Buffer.from(png, 'base64') : undefined;
        if (event?.redacted || !bytes) throw new HttpError(404, '스크린샷이 없거나 입력 보호를 위해 가려졌습니다.');
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(bytes);
      }
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'API를 찾을 수 없습니다.');
    if (method !== 'GET') throw new HttpError(405, 'GET 요청이 필요합니다.');
    const requested = resolve(webDir, '.' + decodeURIComponent(path));
    if (requested !== resolve(webDir) && !requested.startsWith(resolve(webDir) + '/')) throw new HttpError(403, '잘못된 파일 경로');
    let file = requested;
    try { if (!(await stat(file)).isFile()) file = join(webDir, 'index.html'); } catch { file = join(webDir, 'index.html'); }
    const content = await readFile(file), types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(content);
  }
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(options.port ?? 4318, '127.0.0.1', accept); });
  const address = server.address(); url = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : options.port);
  let lastRevision = (await store.read()).revision;
  const timer = setInterval(() => {
    void store.read().then(s => { if (s.revision !== lastRevision) { lastRevision = s.revision; changed(); } }).catch(() => {});
  }, 1500);
  timer.unref();
  return { url, store, queue, async close() {
    clearInterval(timer); for (const entry of throttles.values()) clearTimeout(entry.timer); throttles.clear(); await queue.close(); for (const res of listeners) res.end(); listeners.clear();
    await new Promise<void>((accept, reject) => server.close(e => e ? reject(e) : accept())); server.closeAllConnections();
  } };
}
