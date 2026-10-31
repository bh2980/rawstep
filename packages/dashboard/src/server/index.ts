import { isLoopbackHostname } from '@rawstep/core/defaults';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { BUILTIN_PROFILES } from '@rawstep/browser/profiles';
import { createBrowserSession } from '@rawstep/browser/browser';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { AT_DRIVER_COMMAND_ENV, atBackendSchema, atEndpointOf, type AtBackend, machineSchema, modelKeyEnv, suggestionModel, providerSchema, providersOf, type Connection } from '@rawstep/project/config';
import { ProjectStore, readOptional } from '@rawstep/project/store';
import { ProjectError } from '@rawstep/project/errors';
import { backendCapabilities } from '@rawstep/project/plan';
import { discover } from '@rawstep/project/discover';
import { ensureAtDriver } from '@rawstep/project/atdriver';
import { requireKey } from '@rawstep/project/run';
import type { ConfigView, DeleteTaskResult } from '../shared/config.js';
import { HttpError, messageOf, record, statusOf } from './http.js';
import { ExperimentQueue, type Executor } from './queue.js';
import { RunViews } from './views.js';
import { DIAGNOSTIC_PATH } from './steps.js';
import { suggestChecks } from './suggest.js';
import { inspectStartPage } from './structure.js';
import { listProjectFiles } from './files.js';
import { checkBrowser, checkConnection, checkModel, signInAgent } from './checks.js';
import type { RunEventMessage } from '../shared/api.js';

/** Built UI: `dist/web` in a checkout, `dist/dashboard-web` inside the single `rawstep` package (whichever chunk this code was bundled into). */
function defaultWebDir(): string {
  const candidates = ['./dashboard-web', '../dashboard-web', '../web'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  return candidates.find(directory => existsSync(join(directory, 'index.html'))) ?? candidates[candidates.length - 1]!;
}

/** A saved connection by id, or one being set up: a provider, a custom address and a key typed for it. */
const connectionTarget = z.object({
  connectionId: z.string().optional(), provider: providerSchema.optional(),
  baseURL: z.url().optional(), apiKey: z.string().max(16384).optional(),
}).strict();
export type DashboardServerOptions = { projectDir?: string; port?: number; webDir?: string; allowedOrigin?: string; execute?: Executor };
async function jsonBody(req: IncomingMessage) {
  let length = 0; const chunks: Buffer[] = [];
  for await (const part of req) { const b = Buffer.from(part); length += b.length; if (length > 2000000) throw new HttpError(413, 'request-too-large'); chunks.push(b); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new HttpError(400, 'invalid-json'); }
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
    // A message code and its values, never a sentence: the dashboard words it in the reader's language.
    res.writeHead(statusOf(error), { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: messageOf(error) }));
  }); });
  let url = '';
  async function state(): Promise<ConfigView> {
    const { config, revision } = await store.read();
    const credentialStatus = await store.credentialStatus(config);
    const actions = (backend: AtBackend) => { const c = backendCapabilities(backend); return { keys: [...c.keys], intents: [...c.intents] }; };
    return { config, revision, credentialStatus, tasks: await store.taskFiles(config), environmentPresets: BUILTIN_PROFILES,
      capabilities: { simulation: actions('simulation'), voiceover: actions('voiceover'), nvda: actions('nvda') } };
  }
  const send = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function savedConnection(id: string): Promise<Connection> {
    const connection = (await store.read()).config.connections.find(c => c.id === id);
    if (!connection) throw new HttpError(404, 'connection-not-found');
    return connection;
  }
  /** A saved connection with its stored key, or one being set up with the key typed for it (presets fall back to the key saved for their provider). */
  async function targetConnection(body: z.infer<typeof connectionTarget>): Promise<{ connection: Connection; apiKey: string | undefined }> {
    if (body.connectionId) { const connection = await savedConnection(body.connectionId); return { connection, apiKey: await store.credential(connection) }; }
    if (!body.provider || !providersOf().some(p => p.id === body.provider)) throw new ProjectError('invalid-provider', 'Not a provider.');
    if (body.provider === 'custom' && !body.baseURL) throw new ProjectError('invalid-base-url', 'A custom provider needs a server address.');
    const connection: Connection = { id: 'check', name: 'check', provider: body.provider, ...(body.baseURL ? { baseURL: body.baseURL } : {}), timeoutMs: RAWSTEP_DEFAULTS.modelTimeoutMs };
    return { connection, apiKey: body.apiKey ?? (body.provider === 'custom' ? undefined : await store.credential(body.provider)) };
  }
  /** Reading a start page opens a browser, so only one page read (a suggestion or the element picker) runs at a time. */
  let readingPage = false;
  const exclusivePageRead = async <T>(work: () => Promise<T>): Promise<T> => {
    if (readingPage) throw new HttpError(409, 'page-read-busy');
    readingPage = true;
    try { return await work(); } finally { readingPage = false; }
  };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host;
    if (!host || !isLoopbackHostname(new URL('http://' + host).hostname)) throw new HttpError(403, 'loopback-only');
    const origin = req.headers.origin;
    if (origin && !sameServerOrigin(origin, url) && origin !== options.allowedOrigin) throw new HttpError(403, 'origin-not-allowed');
    const requestUrl = new URL(req.url ?? '/', url), path = requestUrl.pathname, method = req.method ?? 'GET';
    res.setHeader('x-content-type-options', 'nosniff');
    if (path === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: changed\ndata: {}\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res)); return;
    }
    if (path === '/api/state' && method === 'GET') return send(res, await state());
    if (path === '/api/backend/check' && method === 'POST') {
      const body = record(await jsonBody(req)), machine = machineSchema.parse(body.machine), backend = atBackendSchema.parse(body.backend);
      if (backend === 'simulation') {
        const browser = await createBrowserSession('about:blank', { headless: true, executablePath: machine.browserExecutablePath || undefined, ...(machine.browserEndpoint.trim() ? { cdpEndpoint: machine.browserEndpoint.trim() } : {}) });
        await browser.close(); return send(res, { message: { code: 'check-simulation-ok' } });
      }
      if ((backend === 'voiceover' && process.platform !== 'darwin') || (backend === 'nvda' && process.platform !== 'win32')) throw new HttpError(400, 'native-os-mismatch');
      // The check starts the server with the saved command when nothing answers yet, just as a run would, and stops it again.
      const url = atEndpointOf(machine, backend), driver = await ensureAtDriver({ endpoint: url, command: await store.localValue(AT_DRIVER_COMMAND_ENV), cwd: store.root, signal: AbortSignal.timeout(35000) });
      const driverBackend = new AtDriverBackend({ profile: backend, url });
      try { const metadata = await driverBackend.start({ signal: AbortSignal.timeout(5000) }); return send(res, { message: { code: driver.started ? 'check-at-driver-started' : 'check-at-driver-ok' }, metadata }); }
      catch { throw new HttpError(502, 'at-driver-session-failed'); }
      finally { await driverBackend.close(); await driver.stop(); }
    }
    if (path === '/api/machine/at-driver-command') {
      if (method === 'GET') return send(res, { command: (await store.localValue(AT_DRIVER_COMMAND_ENV)) ?? '' });
      if (method === 'PUT') {
        const body = z.object({ command: z.string().max(2000) }).strict().parse(await jsonBody(req));
        await store.setLocalValue(AT_DRIVER_COMMAND_ENV, body.command.trim());
        return send(res, { command: body.command.trim() });
      }
    }
    if (path === '/api/browser/check' && method === 'POST') {
      // On request only: this starts a browser, so it shares the one-at-a-time lock of the other page reads.
      const machine = machineSchema.parse(record(await jsonBody(req)).machine);
      return send(res, await exclusivePageRead(() => checkBrowser(machine)));
    }
    if (path === '/api/connections/check' && method === 'POST') {
      // A saved connection by id, or one being set up (a key typed for a custom server is used once and not stored). With a model ID the check asks about that model.
      const body = connectionTarget.extend({ modelId: z.string().trim().min(1).max(500).optional() }).strict().parse(await jsonBody(req));
      const { connection, apiKey } = await targetConnection(body);
      if (!body.modelId) return send(res, await checkConnection(connection, apiKey));
      return send(res, await checkModel({ ...connection, modelId: body.modelId }, apiKey));
    }
    if (path === '/api/connections/sign-in' && method === 'POST') {
      // Pressed by the person: the agent's own sign-in (it may reuse this computer's account or open a sign-in page).
      const { connection } = await targetConnection(connectionTarget.parse(await jsonBody(req)));
      return send(res, await signInAgent(connection));
    }
    if (path === '/api/files' && method === 'GET') return send(res, await listProjectFiles(store.root));
    if (path === '/api/connections/models' && method === 'POST') {
      const { connection, apiKey } = await targetConnection(connectionTarget.parse(await jsonBody(req)));
      return send(res, await discover(connection, apiKey));
    }
    const removing = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (removing && method === 'DELETE') {
      const taskId = decodeURIComponent(removing[1]!), body = z.object({ revision: z.string() }).strict().parse(await jsonBody(req));
      if (queue.experiments.some(e => e.runs.some(r => r.taskId === taskId && (r.state === 'queued' || r.state === 'running')))) throw new HttpError(409, 'task-run-active');
      const removed = await store.deleteTask(taskId, body.revision);
      changed();
      return send(res, { view: await state(), file: removed.file, fileRemoved: removed.fileRemoved } satisfies DeleteTaskResult);
    }
    if (path === '/api/config' && method === 'PUT') {
      const body = record(await jsonBody(req));
      if (typeof body.revision !== 'string') throw new HttpError(400, 'revision-required');
      const task = body.taskWrite ? record(body.taskWrite) : undefined;
      await store.save(body.config, body.revision, task ? { file: String(task.file), task: task.task } : undefined);
      changed(); return send(res, await state());
    }
    if (path === '/api/credentials' && method === 'POST') {
      // A preset provider keeps its key under a fixed variable; only a custom connection names its own.
      const body = z.union([z.object({ provider: providerSchema, value: z.string() }).strict(), z.object({ connectionId: z.string(), value: z.string() }).strict()]).parse(await jsonBody(req));
      if ('provider' in body) {
        if (body.provider === 'custom') throw new HttpError(400, 'custom-key-per-connection');
        await store.setCredential(body.provider, body.value);
      } else {
        const connection = await savedConnection(body.connectionId);
        if (!modelKeyEnv(connection)) throw new HttpError(400, 'connection-key-env-required');
        await store.setCredential(connection, body.value);
      }
      return send(res, { configured: true });
    }
    if (path === '/api/credentials/reveal' && method === 'POST') {
      // The dashboard listens on loopback only and checks Host and Origin, so the saved key may be shown to the person editing it.
      const body = z.union([z.object({ provider: providerSchema }).strict(), z.object({ connectionId: z.string() }).strict()]).parse(await jsonBody(req));
      if ('provider' in body) return send(res, { value: body.provider === 'custom' ? null : (await store.credential(body.provider)) ?? null });
      return send(res, { value: (await store.credential(await savedConnection(body.connectionId))) ?? null });
    }
    if (path === '/api/suggest-checks' && method === 'POST') {
      const body = z.object({ url: z.string().min(1).max(2000), goal: z.string().trim().min(1).max(4000) }).strict().parse(await jsonBody(req));
      const { config } = await store.read();
      // The project's suggestion model, otherwise its analysis model.
      const model = suggestionModel(config);
      if (!model) throw new HttpError(400, 'suggest-model-missing');
      const apiKey = await requireKey(store, model);
      return send(res, await exclusivePageRead(async () => {
        try { return await suggestChecks({ url: body.url, goal: body.goal, projectDir: store.root, model, apiKey, machine: config.machine }); }
        catch (error) {
          throw error instanceof HttpError ? error : new HttpError(400, 'start-page-unreadable');
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
        } catch { throw new HttpError(400, 'start-page-unreadable'); }
      }));
    }
    if (path === '/api/tasks/candidates' && method === 'GET') return send(res, await store.findTaskFiles((await store.read()).config));
    if (path === '/api/tasks/import' && method === 'POST') {
      const body = z.object({ file: z.string() }).strict().parse(await jsonBody(req));
      return send(res, await store.task(body.file));
    }
    if (path === '/api/plan' && method === 'POST') return send(res, (await queue.plan(await jsonBody(req))).rows);
    if (path === '/api/experiments' && method === 'GET') return send(res, queue.experiments);
    if (path === '/api/tasks-summary' && method === 'GET') return send(res, await views.taskSummaries());
    const findings = path.match(/^\/api\/tasks\/([^/]+)\/findings$/);
    if (findings && method === 'GET') return send(res, await views.findings(decodeURIComponent(findings[1]!), requestUrl.searchParams.get('batch') ?? undefined));
    if (path === '/api/experiments' && method === 'POST') return send(res, await queue.create(await jsonBody(req)), 201);
    if (path === '/api/runs/delete' && method === 'POST') {
      const body = z.object({ runs: z.array(z.object({ experiment: z.string().regex(/^[0-9a-f-]{36}$/), run: z.string().regex(/^[0-9a-f-]{36}$/) }).strict()).min(1).max(1000) }).strict().parse(await jsonBody(req));
      return send(res, { removed: await queue.deleteMany(body.runs) });
    }
    const match = path.match(/^\/api\/experiments\/([0-9a-f-]{36})(?:\/runs\/([0-9a-f-]{36}))?(?:\/(cancel|retry|events|steps|hints|trace|analysis|report|png)(?:\/([^/]+))?)?$/);
    if (match) {
      const [, experimentId, runId, operation, eventId] = match;
      if (!operation && method === 'DELETE') return send(res, { removed: await queue.deleteRuns(experimentId!, runId ? [runId] : undefined) });
      if (operation === 'cancel' && method === 'POST') return send(res, await queue.cancel(experimentId!, runId));
      if (!runId) throw new HttpError(404, 'run-id-required');
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
        return send(res, events);
      }
      if (operation === 'steps' && method === 'GET') return send(res, await views.steps(experimentId!, runId));
      if (operation === 'hints' && method === 'GET') return send(res, await views.hints(experimentId!, runId));
      if ((operation === 'trace' || operation === 'analysis') && method === 'GET') {
        const content = await readFile(await store.file(prefix + operation + '.json', true));
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="' + operation + '.json"' }); return res.end(content);
      }
      if (operation === 'report' && method === 'GET') {
        if (run.reportStatus !== 'complete') throw new HttpError(404, 'report-not-ready');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; sandbox" });
        return res.end(await readFile(await store.file(prefix + 'report.html', true)));
      }
      if (operation === 'png' && method === 'GET') {
        const raw = await readOptional(await store.file(prefix + 'trace.jsonl')) ?? '';
        const event = raw.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.id === decodeURIComponent(eventId ?? ''));
        const diagnostic = record(event?.data).path;
        // A diagnostic screenshot is a plain file whose path the runner wrote and the pattern pins, never a path from the client.
        const file = (event?.type === 'browser.screenshot' || event?.type === 'browser.start-page') && typeof diagnostic === 'string' && DIAGNOSTIC_PATH.test(diagnostic)
          ? await readFile(await store.file(prefix + diagnostic, true)).catch(() => undefined) : undefined;
        if (event?.redacted || !file) throw new HttpError(404, 'screenshot-missing');
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return res.end(file);
      }
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'api-not-found');
    if (method !== 'GET') throw new HttpError(405, 'get-required');
    const requested = resolve(webDir, '.' + decodeURIComponent(path));
    const inside = relative(resolve(webDir), requested);
    if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new HttpError(403, 'bad-file-path');
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
