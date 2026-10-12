import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A coding-agent CLI (Claude Code, Codex, opencode, Grok, Gemini, ...) spoken to over the Agent Client Protocol: newline-delimited
 * JSON-RPC 2.0 on the child's stdio. Rawstep uses the agent as a plain model: every prompt gets a fresh session in an empty
 * temporary directory, the client offers no file system or terminal, and every permission request is refused. The agent's own
 * login (subscription) pays for the calls; no API key passes through Rawstep.
 */
export type AcpAgentSpec = { command: string; args: readonly string[] };
export type AcpModelOption = { value: string; name: string };
export type AcpAgentInfo = { name: string; version: string; images: boolean; models: AcpModelOption[]; currentModel?: string; efforts: string[] };
export type AcpPromptRequest = { text: string; images?: readonly string[]; modelId?: string; reasoningEffort?: string; signal?: AbortSignal };

export class AcpError extends Error {
  /** The JSON-RPC error code when the agent answered with an error. */
  code?: number;
  constructor(readonly reason: 'start-failed' | 'exited' | 'protocol' | 'agent-error' | 'sign-in' | 'no-images' | 'unknown-model' | 'stopped', message: string) { super(message); this.name = 'AcpError'; }
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };
type Session = { sessionId: string; configOptions?: { id: string; category?: string; options?: AcpModelOption[]; currentValue?: string }[] };
const PROTOCOL_VERSION = 1;
/** Starting may download an adapter (npx) and log in the agent; that is slower than one call and does not count against it. */
export const ACP_START_TIMEOUT_MS = 180_000;
/** How long removing a finished session may take before Rawstep moves on. */
const SESSION_CLOSE_TIMEOUT_MS = 5_000;

export class AcpAgent {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<AcpAgentInfo>;
  private readonly pending = new Map<number, Pending>();
  private readonly chunks = new Map<string, string[]>();
  private nextId = 0;
  private buffer = '';
  private failure?: AcpError;
  private cwd?: string;
  private sessionClose?: 'session/delete' | 'session/close';
  /** Set by `signIn`: the next handshake authenticates with it. */
  private signInWith?: string;

  constructor(readonly spec: AcpAgentSpec) {}

  /** Launches the agent and completes the handshake once; later calls share it. */
  start(signal?: AbortSignal): Promise<AcpAgentInfo> {
    this.starting ??= this.launch().catch(async error => { await this.close(); throw error; });
    if (!signal) return this.starting;
    return Promise.race([this.starting, new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })]);
  }

  /** One prompt in a new session; resolves with the agent's reply text. */
  async prompt(request: AcpPromptRequest): Promise<string> {
    const info = await this.start(request.signal);
    if (request.images?.length && !info.images) throw new AcpError('no-images', 'This agent does not take images.');
    const session = await this.request('session/new', { cwd: this.cwd, mcpServers: [] }, request.signal) as Session;
    try {
      if (request.modelId && request.modelId !== 'default') await this.choose(session, 'model', request.modelId, request.signal);
      // Agents that offer no thinking levels take none; one that does must offer the level asked for.
      if (request.reasoningEffort && session.configOptions?.some(o => o.category === 'thought_level')) await this.choose(session, 'thought_level', request.reasoningEffort, request.signal);
      this.chunks.set(session.sessionId, []);
      const prompt = [{ type: 'text', text: request.text }, ...(request.images ?? []).map(data => ({ type: 'image', mimeType: 'image/png', data }))];
      const cancel = () => this.notify('session/cancel', { sessionId: session.sessionId });
      request.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await this.request('session/prompt', { sessionId: session.sessionId, prompt }, request.signal) as { stopReason?: string };
        if (result?.stopReason !== 'end_turn') throw new AcpError('stopped', `The agent stopped without finishing (${String(result?.stopReason)}).`);
        return this.chunks.get(session.sessionId)!.join('');
      } finally { request.signal?.removeEventListener('abort', cancel); }
    } finally {
      this.chunks.delete(session.sessionId);
      await this.endSession(session.sessionId);
    }
  }

  /**
   * Sessions are saved in the agent's own history; each one is removed, and the removal is awaited so a caller that closes the
   * agent right after its only prompt does not kill the agent before it has deleted the session.
   */
  private async endSession(sessionId: string): Promise<void> {
    if (!this.sessionClose || this.failure) return;
    await this.request(this.sessionClose, { sessionId }, AbortSignal.timeout(SESSION_CLOSE_TIMEOUT_MS)).catch(() => undefined);
  }

  /**
   * Signs the agent in with one of its ACP sign-in methods. Only for a person's explicit request: it can reuse an account the
   * computer is signed in to, or open a sign-in page.
   */
  async signIn(methodId: string, signal?: AbortSignal): Promise<void> {
    await this.close();
    this.signInWith = methodId;
    try { await this.start(signal); } finally { this.signInWith = undefined; }
  }

  private async choose(session: Session, category: string, value: string, signal?: AbortSignal) {
    const option = session.configOptions?.find(o => o.category === category);
    if (!option?.options?.some(o => o.value === value)) throw new AcpError('unknown-model', category === 'model' ? 'The agent does not offer this model.' : `The agent does not offer the setting ${value}.`);
    if (option.currentValue !== value) await this.request('session/set_config_option', { sessionId: session.sessionId, configId: option.id, value }, signal);
  }

  /** Ends the agent; a later call starts it again. */
  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.fail(new AcpError('exited', 'The agent was closed.'));
    this.failure = undefined; this.starting = undefined; this.buffer = ''; this.chunks.clear();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
      kill(child);
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (this.cwd) { rmSync(this.cwd, { recursive: true, force: true }); this.cwd = undefined; }
  }

  private async launch(): Promise<AcpAgentInfo> {
    this.cwd = mkdtempSync(join(tmpdir(), 'rawstep-agent-'));
    const child = this.child = spawn(this.spec.command, [...this.spec.args], {
      cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      // npx and most agent launchers are .cmd shims on Windows.
      shell: process.platform === 'win32',
    });
    // Drain, never keep: agent logs can carry account details or page content.
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    // Events of a child that was already closed must not touch the next one.
    const current = (act: () => void) => () => { if (this.child === child) act(); };
    child.stdout.on('data', (chunk: string) => { if (this.child === child) this.consume(chunk); });
    child.on('error', current(() => this.fail(new AcpError('start-failed', `Could not start ${this.spec.command}; check that it is installed.`))));
    child.on('close', current(() => this.fail(new AcpError('exited', 'The agent exited.'))));
    child.stdin.on('error', current(() => this.fail(new AcpError('exited', 'The agent stopped reading.'))));
    const timeout = AbortSignal.timeout(ACP_START_TIMEOUT_MS);
    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'rawstep', version: '1' },
    }, timeout).catch(error => { throw timeout.aborted ? new AcpError('start-failed', 'The agent did not answer in time.') : error; }) as {
      protocolVersion?: number; agentInfo?: { name?: string; version?: string };
      agentCapabilities?: { promptCapabilities?: { image?: boolean }; sessionCapabilities?: { delete?: unknown; close?: unknown } };
    };
    if (init?.protocolVersion !== PROTOCOL_VERSION) throw new AcpError('protocol', `The agent speaks ACP version ${String(init?.protocolVersion)}, not ${PROTOCOL_VERSION}.`);
    if (this.signInWith) {
      await this.request('authenticate', { methodId: this.signInWith }, timeout).catch(() => { throw new AcpError('sign-in', 'Signing in did not finish.'); });
    }
    const sessions = init.agentCapabilities?.sessionCapabilities;
    this.sessionClose = sessions?.delete ? 'session/delete' : sessions?.close ? 'session/close' : undefined;
    // The model list comes with a session; read it once from a throwaway one.
    const probe = await this.request('session/new', { cwd: this.cwd, mcpServers: [] }, timeout).catch(error => {
      // ACP's auth_required error: the agent keeps its own sign-in and has none yet.
      throw error instanceof AcpError && error.code === -32000 ? new AcpError('sign-in', 'The agent needs a sign-in first.') : error;
    }) as Session;
    await this.endSession(probe.sessionId);
    const models = probe.configOptions?.find(o => o.category === 'model');
    const efforts = probe.configOptions?.find(o => o.category === 'thought_level')?.options?.map(o => o.value) ?? [];
    return {
      name: init.agentInfo?.name ?? this.spec.command, version: init.agentInfo?.version ?? 'unknown',
      images: init.agentCapabilities?.promptCapabilities?.image === true,
      models: (models?.options ?? []).map(({ value, name }) => ({ value, name })),
      ...(models?.currentValue ? { currentModel: models.currentValue } : {}), efforts,
    };
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(id); reject(signal!.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      const done = <T>(settle: (value: T) => void) => (value: T) => { signal?.removeEventListener('abort', abort); settle(value); };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown) { if (!this.failure) this.write({ jsonrpc: '2.0', method, params }); }
  private write(message: unknown) { this.child?.stdin.write(JSON.stringify(message) + '\n'); }

  private consume(chunk: string) {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message: { id?: number | string; method?: string; params?: any; result?: unknown; error?: { message?: string } };
      try { message = JSON.parse(line); } catch { this.fail(new AcpError('protocol', 'The agent wrote something that is not JSON-RPC.')); return; }
      if (message.method) this.handle(message as { id?: number | string; method: string; params?: any });
      else if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const waiting = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) waiting.reject(Object.assign(new AcpError('agent-error', 'The agent returned an error.'), { code: (message.error as { code?: number }).code }));
        else waiting.resolve(message.result);
      }
    }
  }

  /** Requests and notifications from the agent. Only reply text is kept; tool use, files and terminals are refused. */
  private handle(message: { id?: number | string; method: string; params?: any }) {
    if (message.method === 'session/update') {
      const update = message.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') this.chunks.get(message.params.sessionId)?.push(String(update.content.text));
      return;
    }
    if (message.id === undefined) return;
    if (message.method === 'session/request_permission') {
      const reject = (message.params?.options as { optionId: string; kind: string }[] | undefined)?.find(o => o.kind === 'reject_once') ?? message.params?.options?.find((o: { kind: string }) => o.kind === 'reject_always');
      this.write({ jsonrpc: '2.0', id: message.id, result: { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } } });
      return;
    }
    this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Rawstep offers no file system, terminal or other client methods.' } });
  }

  private fail(error: AcpError) {
    this.failure ??= error;
    for (const waiting of this.pending.values()) waiting.reject(this.failure);
    this.pending.clear();
  }
}

function kill(child: ChildProcessWithoutNullStreams) {
  if (child.pid === undefined) return;
  // npx starts the adapter as its own child, so the whole group goes.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}

/** The JSON object in an agent's reply: the whole text, a fenced block, or the outermost braces. */
export function parseAgentJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  for (const candidate of [trimmed, fenced, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  throw new AcpError('protocol', 'The agent reply holds no JSON object.');
}
