import { isLoopbackHostname } from '@rawstep/core/defaults';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isScreenshotRef } from '@rawstep/core/trace';
import { resolve, relative, isAbsolute, sep, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { BUILTIN_PROFILES } from '@rawstep/browser/profiles';
import { createBrowserSession } from '@rawstep/browser/browser';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { buildModel, discoverRequestSchema, machineSchema, modelKeyEnv, modelKindSchema, providerSchema, providersOf } from '@rawstep/project/config';
import { ProjectStore, readOptional } from '@rawstep/project/store';
import { ProjectError } from '@rawstep/project/errors';
import { backendCapabilities } from '@rawstep/project/plan';
import { discover } from '@rawstep/project/discover';
import { requireKey } from '@rawstep/project/run';
import type { ConfigView, DeleteTaskResult } from '../shared/config.js';
import { HttpError, koreanMessage, record } from './http.js';
import { ExperimentQueue, type Executor } from './queue.js';
import { RunViews } from './views.js';
import { suggestChecks } from './suggest.js';
import { inspectStartPage } from './structure.js';
import { checkBrowser, checkModel } from './checks.js';
import type { RunEventMessage } from '../shared/api.js';

/** Built UI: `dist/web` in a checkout, `dist/dashboard-web` inside the single `rawstep` package (whichever chunk this code was bundled into). */
function defaultWebDir(): string {
  const candidates = ['./dashboard-web', '../dashboard-web', '../web'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  return candidates.find(directory => existsSync(join(directory, 'index.html'))) ?? candidates[candidates.length - 1]!;
}

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
  const webDir = options.webDir ?? defaultWebDir();
  const server = createServer((req, res) => { void handle(req, res).catch(error => {
    if (res.headersSent) { res.end(); return; }
    const mapped = error instanceof ProjectError ? new HttpError(error.status, koreanMessage(error)) : error;
    const message = mapped instanceof HttpError ? mapped.message : error instanceof z.ZodError ? '입력 형식이나 설정이 잘못되었습니다.' : '요청을 처리하지 못했습니다. 프로젝트 파일과 설정을 확인하세요.';
    res.writeHead(mapped instanceof HttpError ? mapped.status : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: message }));
  }); });
  let url = '';
  async function state(): Promise<ConfigView> {
    const { config, revision } = await store.read();
    const credentialStatus = await store.credentialStatus(config);
    const keyboard = backendCapabilities(config, 'keyboard'), screenreader = backendCapabilities(config, 'screenreader');
    return { config, revision, credentialStatus, tasks: await store.taskFiles(config), environmentPresets: BUILTIN_PROFILES,
      capabilities: { keyboard: { keys: [...keyboard.keys], intents: [...keyboard.intents] }, screenreader: { keys: [...screenreader.keys], intents: [...screenreader.intents] } } };
  }
  const send = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  /** Reading a start page opens a browser, so only one page read (a suggestion or the element picker) runs at a time. */
  let readingPage = false;
  const exclusivePageRead = async <T>(work: () => Promise<T>): Promise<T> => {
    if (readingPage) throw new HttpError(409, '다른 페이지 읽기가 진행 중입니다. 끝난 뒤 다시 시도하세요.');
    readingPage = true;
    try { return await work(); } finally { readingPage = false; }
  };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host;
    if (!host || !isLoopbackHostname(new URL('http://' + host).hostname)) throw new HttpError(403, 'Loopback 요청만 허용합니다.');
    const origin = req.headers.origin;
    if (origin && !sameServerOrigin(origin, url) && origin !== options.allowedOrigin) throw new HttpError(403, '요청 Origin을 허용하지 않습니다.');
    const path = new URL(req.url ?? '/', url).pathname, method = req.method ?? 'GET';
    res.setHeader('x-content-type-options', 'nosniff');
    if (path === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: changed\ndata: {}\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res)); return;
    }
    if (path === '/api/state' && method === 'GET') return send(res, await state());
    if (path === '/api/capabilities' && method === 'POST') {
      const config = { machine: machineSchema.parse(record(await jsonBody(req)).machine) };
      return send(res, { keyboard: backendCapabilities(config, 'keyboard'), screenreader: backendCapabilities(config, 'screenreader') });
    }
    if (path === '/api/backend/check' && method === 'POST') {
      const machine = machineSchema.parse(record(await jsonBody(req)).machine);
      if (machine.backend === 'simulation') {
        const browser = await createBrowserSession('about:blank', { headless: true, executablePath: machine.browserExecutablePath || undefined });
        await browser.close(); return send(res, { message: 'Chromium 연결 확인 완료. 스크린리더 출력은 DOM 기반 모의 관찰입니다.' });
      }
      if ((machine.backend === 'voiceover' && process.platform !== 'darwin') || (machine.backend === 'nvda' && process.platform !== 'win32')) throw new HttpError(400, '선택한 네이티브 스크린리더의 운영체제에서 연결을 확인하세요.');
      const backend = new AtDriverBackend({ profile: machine.backend, url: machine.atEndpoint });
      try { const metadata = await backend.start({ signal: AbortSignal.timeout(5000) }); return send(res, { message: 'AT Driver 세션 연결과 프로필 협상 확인 완료. 실제 발화와 브라우저 행동은 별도 실행으로 확인하세요.', metadata }); }
      catch { throw new HttpError(502, 'AT Driver 연결을 확인하지 못했습니다. 주소와 서버·스크린리더 상태를 확인하세요.'); }
      finally { await backend.close(); }
    }
    if (path === '/api/browser/check' && method === 'POST') {
      // On request only: this starts a browser, so it shares the one-at-a-time lock of the other page reads.
      const machine = machineSchema.parse(record(await jsonBody(req)).machine);
      return send(res, await exclusivePageRead(() => checkBrowser(machine)));
    }
    if (path === '/api/models/check' && method === 'POST') {
      const body = z.union([
        z.object({ id: z.string() }).strict(),
        z.object({ kind: modelKindSchema, provider: providerSchema, modelId: z.string().trim().min(1).max(500), baseURL: z.url().optional(), apiKey: z.string().max(16384).optional(), inputs: z.array(z.enum(['text', 'image'])).min(1).max(2).optional() }).strict(),
      ]).parse(await jsonBody(req));
      if ('id' in body) {
        const model = (await store.read()).config.models.find(m => m.id === body.id);
        if (!model) throw new HttpError(404, '모델을 찾을 수 없습니다.');
        return send(res, await checkModel(model, await store.credential(model)));
      }
      if (!providersOf(body.kind).some(p => p.id === body.provider)) throw new ProjectError('invalid-provider', 'Not a provider of this kind.');
      if (body.provider === 'custom' && !body.baseURL) throw new ProjectError('invalid-base-url', 'A custom provider needs a server address.');
      const model = buildModel({ id: 'check', name: 'check', kind: body.kind, provider: body.provider, modelId: body.modelId, ...(body.baseURL ? { baseURL: body.baseURL } : {}), ...(body.inputs ? { inputs: body.inputs } : {}) });
      // A key typed for a custom server is used once and not stored; presets use the key saved for their provider.
      return send(res, await checkModel(model, body.apiKey ?? (body.provider === 'custom' ? undefined : await store.credential(body.provider))));
    }
    const removing = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (removing && method === 'DELETE') {
      const taskId = decodeURIComponent(removing[1]!), body = z.object({ revision: z.string() }).strict().parse(await jsonBody(req));
      if (queue.experiments.some(e => e.runs.some(r => r.taskId === taskId && (r.state === 'queued' || r.state === 'running')))) throw new HttpError(409, '이 작업의 실행이 진행 중이거나 대기 중입니다. 끝나거나 중지한 뒤 삭제하세요.');
      const removed = await store.deleteTask(taskId, body.revision);
      changed();
      return send(res, { view: await state(), file: removed.file, fileRemoved: removed.fileRemoved } satisfies DeleteTaskResult);
    }
    if (path === '/api/config' && method === 'PUT') {
      const body = record(await jsonBody(req));
      if (typeof body.revision !== 'string') throw new HttpError(400, '설정 버전이 필요합니다.');
      const task = body.taskWrite ? record(body.taskWrite) : undefined;
      await store.save(body.config, body.revision, task ? { file: String(task.file), task: task.task } : undefined);
      changed(); return send(res, await state());
    }
    if (path === '/api/credentials' && method === 'POST') {
      // A preset provider keeps its key under a fixed variable; only a custom model names its own.
      const body = z.union([z.object({ provider: providerSchema, value: z.string() }).strict(), z.object({ modelId: z.string(), value: z.string() }).strict()]).parse(await jsonBody(req));
      if ('provider' in body) {
        if (body.provider === 'custom') throw new HttpError(400, '사용자 지정 서버의 인증키는 모델 단위로 저장합니다.');
        await store.setCredential(body.provider, body.value);
      } else {
        const { config } = await store.read(), model = config.models.find(m => m.id === body.modelId);
        if (!model) throw new HttpError(404, '모델을 찾을 수 없습니다.');
        if (!modelKeyEnv(model)) throw new HttpError(400, '모델의 인증키 환경변수 이름이 필요합니다.');
        await store.setCredential(model, body.value);
      }
      return send(res, { configured: true });
    }
    if (path === '/api/credentials/reveal' && method === 'POST') {
      // The dashboard listens on loopback only and checks Host and Origin, so the saved key may be shown to the person editing it.
      const body = z.union([z.object({ provider: providerSchema }).strict(), z.object({ modelId: z.string() }).strict()]).parse(await jsonBody(req));
      if ('provider' in body) return send(res, { value: body.provider === 'custom' ? null : (await store.credential(body.provider)) ?? null });
      const { config } = await store.read(), model = config.models.find(m => m.id === body.modelId);
      if (!model) throw new HttpError(404, '모델을 찾을 수 없습니다.');
      return send(res, { value: (await store.credential(model)) ?? null });
    }
    if (path === '/api/discover' && method === 'POST') {
      const { apiKey, ...target } = discoverRequestSchema.parse(await jsonBody(req));
      // A key typed for a custom server is used once and not stored; presets use the key saved for their provider.
      return send(res, await discover(target, apiKey ?? (target.provider === 'custom' ? undefined : await store.credential(target.provider))));
    }
    if (path === '/api/suggest-checks' && method === 'POST') {
      const body = z.object({ url: z.string().min(1).max(2000), goal: z.string().trim().min(1).max(4000), modelId: z.string() }).strict().parse(await jsonBody(req));
      const { config } = await store.read();
      const model = config.models.find(m => m.id === body.modelId);
      if (!model || model.kind !== 'llm' || !model.roles.includes('analysis')) throw new HttpError(400, '사후 분석 역할의 LLM 모델을 선택하세요.');
      const apiKey = await requireKey(store, model);
      return send(res, await exclusivePageRead(async () => {
        try { return await suggestChecks({ url: body.url, goal: body.goal, projectDir: store.root, model, apiKey, machine: config.machine }); }
        catch (error) {
          throw new HttpError(400, error instanceof Error && error.message.startsWith('완료 확인 제안 실패') ? error.message : '시작 페이지를 열거나 읽지 못했습니다. URL과 브라우저 설정을 확인하세요.');
        }
      }));
    }
    if (path === '/api/page-elements' && method === 'POST') {
      const body = z.object({ url: z.string().min(1).max(2000) }).strict().parse(await jsonBody(req));
      const { config } = await store.read();
      return send(res, await exclusivePageRead(async () => {
        try {
          const read = await inspectStartPage({ url: body.url, projectDir: store.root, machine: config.machine });
          return { page: { title: read.title, url: read.url }, elements: read.elements };
        } catch { throw new HttpError(400, '시작 페이지를 열거나 읽지 못했습니다. URL과 브라우저 설정을 확인하세요.'); }
      }));
    }
    if (path === '/api/tasks/import' && method === 'POST') {
      const body = z.object({ file: z.string() }).strict().parse(await jsonBody(req));
      return send(res, await store.task(body.file));
    }
    if (path === '/api/plan' && method === 'POST') return send(res, (await queue.plan(await jsonBody(req))).rows);
    if (path === '/api/experiments' && method === 'GET') return send(res, queue.experiments);
    if (path === '/api/tasks-summary' && method === 'GET') return send(res, await views.taskSummaries());
    const findings = path.match(/^\/api\/tasks\/([^/]+)\/findings$/);
    if (findings && method === 'GET') return send(res, await views.findings(decodeURIComponent(findings[1]!)));
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
        const shot = record(event?.data).screenshot;
        // The path comes from the validated reference (blobs/<sha256>.png), never from the client.
        const blob = isScreenshotRef(shot) ? await readFile(await store.file(prefix + shot.blob, true)).catch(() => undefined) : undefined;
        const bytes = blob && createHash('sha256').update(blob).digest('hex') === (shot as { sha256: string }).sha256 ? blob : undefined;
        if (event?.redacted || !bytes) throw new HttpError(404, '스크린샷이 없거나 입력 보호를 위해 가려졌습니다.');
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(bytes);
      }
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'API를 찾을 수 없습니다.');
    if (method !== 'GET') throw new HttpError(405, 'GET 요청이 필요합니다.');
    const requested = resolve(webDir, '.' + decodeURIComponent(path));
    const inside = relative(resolve(webDir), requested);
    if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new HttpError(403, '잘못된 파일 경로');
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

/**
 * The page may be opened as localhost, 127.0.0.1 or [::1]; module scripts then send that origin.
 * Any loopback name on this server's port is this server, so only other ports and hosts are foreign.
 */
function sameServerOrigin(origin: string, serverUrl: string): boolean {
  try {
    const parsed = new URL(origin), server = new URL(serverUrl);
    return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) && parsed.port === server.port && parsed.origin === origin;
  } catch { return false; }
}
