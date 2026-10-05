import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { orcaBridgePath } from './paths.js';
import { StringDecoder } from 'node:string_decoder';
import type { BackendOperationOptions } from '@rawstep/core/contracts';

export const ORCA_NATIVE_PROTOCOL = 'rawstep-orca-native-v1' as const;
export class OrcaBridgeError extends Error {
  constructor(message: string, readonly code: string, readonly commandId?: number) {
    super(message); this.name = 'OrcaBridgeError';
  }
}
export interface OrcaBridgeOptions {
  /** Executable and arguments, spawned directly without a shell. Defaults to the bundled Python bridge. */
  bridgeCommand?: readonly [string, ...string[]];
  commandTimeoutMs?: number;
  startupTimeoutMs?: number;
  closeTimeoutMs?: number;
}
export interface OrcaCommandReceipt {
  commandId: number; sentAt: number; acknowledgedAt: number; result: unknown;
}
export interface OrcaTransportEvent {
  /** A command event records an attempt; it is not proof of native dispatch. */
  type: 'connected' | 'command' | 'response' | 'output' | 'ignoredSpeech' | 'error' | 'closed';
  sequence: number; timestamp: number; commandId?: number; method?: string;
  text?: string; raw?: unknown; error?: string;
}
type Pending = { sentAt: number; resolve: (value: OrcaCommandReceipt) => void; reject: (error: unknown) => void; cleanup: () => void };
export function validInterval(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) throw new Error(`${name} must be a positive finite timer interval`);
  return value;
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Local NDJSON child-process transport. This is deliberately not an AT Driver server/client. */
export class OrcaBridgeClient {
  private child?: ChildProcessWithoutNullStreams;
  private state: 'new' | 'open' | 'closing' | 'closed' = 'new';
  private failure?: OrcaBridgeError;
  private nextId = 1;
  private sequence = 0;
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: OrcaTransportEvent) => void>();
  private closePromise?: Promise<void>;
  private exited = false;
  private exitPromise: Promise<void> = Promise.resolve();
  readonly commandTimeoutMs: number;
  readonly startupTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  constructor(private readonly options: OrcaBridgeOptions, readonly sessionId: string) {
    this.commandTimeoutMs = validInterval(options.commandTimeoutMs ?? 5_000, 'commandTimeoutMs');
    this.startupTimeoutMs = validInterval(options.startupTimeoutMs ?? 15_000, 'startupTimeoutMs');
    this.closeTimeoutMs = validInterval(options.closeTimeoutMs ?? 1_000, 'closeTimeoutMs');
    if (options.bridgeCommand && (options.bridgeCommand.length === 0 || options.bridgeCommand.some(value => typeof value !== 'string' || value.includes('\0')) || !options.bridgeCommand[0])) {
      throw new Error('bridgeCommand must contain an executable and optional string arguments without NUL');
    }
  }
  subscribe(listener: (event: OrcaTransportEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(event: Omit<OrcaTransportEvent, 'sequence' | 'timestamp'>): void {
    const value = { ...event, sequence: ++this.sequence, timestamp: Date.now() };
    for (const listener of this.listeners) { try { listener(structuredClone(value)); } catch { /* Observer owns its errors. */ } }
  }
  async connect({ signal }: BackendOperationOptions = {}): Promise<void> {
    signal?.throwIfAborted();
    if (this.state !== 'new') throw new OrcaBridgeError('Orca bridge cannot be reconnected', 'invalid state');
    const [command, ...args] = this.options.bridgeCommand ?? ['/usr/bin/python3', orcaBridgePath()];
    try {
      const child = this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false });
      this.state = 'open';
      this.exitPromise = new Promise(resolve => child.once('close', () => { this.exited = true; resolve(); }));
      // Drain, but never store stderr: native libraries can log unrelated desktop contents or credentials.
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
      child.stdout.on('error', () => this.fail(new OrcaBridgeError('Orca bridge output pipe failed', 'connection closed')));
      child.stderr.on('error', () => { /* Diagnostics are deliberately not retained. */ });
      child.stdin.on('error', () => this.fail(new OrcaBridgeError('Orca bridge input pipe failed', 'connection closed')));
      child.on('error', () => this.fail(new OrcaBridgeError('Could not launch Orca bridge; check its executable and runtime dependencies', 'launch failed')));
      child.on('close', (code, signalName) => {
        if (this.state !== 'closing' && this.state !== 'closed') this.fail(new OrcaBridgeError(`Orca bridge exited (${signalName ?? code ?? 'unknown'})`, 'connection closed'));
        this.emit({ type: 'closed' });
      });
      // spawn has no readiness guarantee; only the session.start response establishes native readiness.
      signal?.throwIfAborted();
      this.emit({ type: 'connected' });
      signal?.throwIfAborted();
    } catch (error) { await this.close(); throw error; }
  }
  request(method: string, params: Record<string, unknown>, { signal }: BackendOperationOptions = {}, timeoutMs = this.commandTimeoutMs): Promise<OrcaCommandReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.failure || this.state !== 'open' || !this.child?.stdin.writable) return Promise.reject(this.failure ?? new OrcaBridgeError('Orca bridge is not open', 'connection closed'));
    const commandId = this.nextId++;
    const raw = { id: commandId, method, params };
    const sentAt = Date.now();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(commandId); };
      const abort = () => { cleanup(); reject(signal!.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new OrcaBridgeError(`Orca bridge command timed out: ${method}`, 'command timeout', commandId)); }, timeoutMs);
      this.pending.set(commandId, { sentAt, resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      this.emit({ type: 'command', commandId, method, raw });
      // A trace subscriber can synchronously abort or close the session before dispatch.
      if (signal?.aborted) { abort(); return; }
      if (this.state !== 'open' || this.failure || !this.pending.has(commandId)) {
        cleanup(); reject(this.failure ?? new OrcaBridgeError('Orca bridge closed before dispatch', 'connection closed', commandId)); return;
      }
      this.child!.stdin.write(`${JSON.stringify(raw)}\n`, error => {
        if (error) this.fail(new OrcaBridgeError('Orca bridge command could not be written', 'send error', commandId));
      });
    });
  }
  private consume(chunk: Buffer): void {
    if (this.failure || this.state === 'closed' || this.state === 'closing') return;
    this.buffer += this.decoder.write(chunk);
    // Bound both terminated and unterminated lines before parsing or retaining them.
    for (;;) {
      // Subscribers may synchronously close the backend while a multi-frame chunk is being processed.
      if (this.failure || this.state !== 'open') { this.buffer = ''; return; }
      const newline = this.buffer.indexOf('\n');
      if ((newline < 0 ? this.buffer.length : newline) > 1_048_576) { this.fail(new OrcaBridgeError('Orca bridge frame exceeded the size limit', 'protocol error')); return; }
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { this.fail(new OrcaBridgeError('Orca bridge emitted invalid NDJSON', 'protocol error')); return; }
      if (!record(frame)) { this.fail(new OrcaBridgeError('Orca bridge emitted a non-object frame', 'protocol error')); return; }
      if (frame.type === 'speech') {
        if (typeof frame.sessionId !== 'string' || typeof frame.text !== 'string' || frame.source !== 'orca-speech') { this.fail(new OrcaBridgeError('Orca bridge emitted invalid speech provenance', 'protocol error')); return; }
        if (frame.sessionId !== this.sessionId) { this.emit({ type: 'ignoredSpeech' }); continue; }
        this.emit({ type: 'output', text: frame.text, raw: { type: 'speech', sessionId: frame.sessionId, source: frame.source, text: frame.text } });
      } else if (frame.type === 'response' && Number.isSafeInteger(frame.id)) {
        const commandId = frame.id as number;
        const pending = this.pending.get(commandId);
        if (!pending) {
          this.fail(new OrcaBridgeError('Orca bridge returned an unexpected response ID', 'protocol error')); return;
        }
        pending.cleanup();
        if (Object.hasOwn(frame, 'error') === Object.hasOwn(frame, 'result')) {
          const error = new OrcaBridgeError('Orca bridge response must contain exactly one of result/error', 'protocol error', commandId);
          pending.reject(error); this.fail(error); return;
        }
        if (Object.hasOwn(frame, 'error')) {
          if (!record(frame.error) || typeof frame.error.code !== 'string' || typeof frame.error.message !== 'string') {
            const error = new OrcaBridgeError('Orca bridge emitted an invalid error response', 'protocol error', commandId);
            pending.reject(error); this.fail(error); return;
          }
          const error = new OrcaBridgeError(frame.error.message.slice(0, 2048), frame.error.code, commandId);
          this.emit({ type: 'response', commandId, error: error.message }); pending.reject(error);
        } else {
          this.emit({ type: 'response', commandId, raw: { result: frame.result } });
          pending.resolve({ commandId, sentAt: pending.sentAt, acknowledgedAt: Date.now(), result: frame.result });
        }
      } else { this.fail(new OrcaBridgeError('Orca bridge emitted an unsupported frame', 'protocol error')); return; }
    }
  }
  private fail(error: OrcaBridgeError): void {
    if (this.state === 'closing' || this.state === 'closed' || this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.emit({ type: 'error', error: error.message });
    void this.close().catch(() => { /* close is also awaited by the backend owner. */ });
  }
  close(): Promise<void> { return this.closePromise ??= this.closeOnce(); }
  private async closeOnce(): Promise<void> {
    this.state = 'closing';
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(this.failure ?? new OrcaBridgeError('Orca bridge closed', 'connection closed')); }
    const child = this.child;
    if (child) {
      if (!this.exited && child.stdin.writable) {
        // Graceful stop is independent of an aborted operation. Never replay the cancelled input.
        child.stdin.end(`${JSON.stringify({ id: this.nextId++, method: 'session.stop', params: { sessionId: this.sessionId } })}\n`);
      }
      await this.waitForExit(this.closeTimeoutMs);
      if (!this.exited) { this.terminate('SIGTERM'); await this.waitForExit(this.closeTimeoutMs); }
      if (!this.exited) { this.terminate('SIGKILL'); await this.waitForExit(this.closeTimeoutMs); }
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
    }
    this.buffer = ''; this.state = 'closed';
    if (child && !this.exited) throw new OrcaBridgeError('Orca bridge did not exit after forced termination', 'cleanup failed');
  }
  private terminate(signal: NodeJS.Signals): void {
    if (!this.child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  private async waitForExit(timeout: number): Promise<void> {
    if (this.exited) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.exitPromise, new Promise<void>(resolve => { timer = setTimeout(resolve, timeout); })]);
    clearTimeout(timer);
  }
}
