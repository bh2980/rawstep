import { randomUUID } from 'node:crypto';
import type { Backend, BackendAction, BackendOperationOptions, BackendRunContext, BackendSession, BackendSpeechObservation } from '@rawstep/core/contracts';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { RawstepError } from '@rawstep/core/errors';
import { orcaAssumptions, orcaCapabilities, mapOrcaAction } from './profile.js';
import { ORCA_NATIVE_PROTOCOL, OrcaBridgeClient, OrcaBridgeError, record, validInterval, type OrcaBridgeOptions, type OrcaCommandReceipt, type OrcaTransportEvent } from './transport.js';

export * from './profile.js';
export * from './transport.js';

export interface OrcaBackendOptions extends OrcaBridgeOptions {
  quietMs?: number; maxWaitMs?: number;
  /** Optional existing X11 target window. Native runtime must reject keys if another window is active. */
  targetWindowId?: number;
}
export interface OrcaMetadata {
  backend: 'orca-native'; profile: 'orca'; protocol: typeof ORCA_NATIVE_PROTOCOL; sessionId: string;
  capabilities: typeof orcaCapabilities;
  environment: {
    atName: 'Orca'; atVersion: string; platformName: 'linux'; platformVersion: string;
    locale: string; keyboardLayout: string; screenReaderSettings: 'unknown';
  };
  capture: { source: 'orca-speech'; kind: 'speech-pipeline-text'; stage: 'speech-dispatcher-submission'; audioVerified: false };
  target: { windowId: number; windowClass: string; processId: number; browserSessionAssociation: 'caller-responsibility' };
  assumptions: readonly string[];
  collection: { quietMs: number; maxWaitMs: number; attribution: 'temporal-only'; speechCompletionSignal: false };
}
export interface OrcaOutput {
  sequence: number; receivedAt: string; text: string; raw: unknown;
  /** Receipt-time collection window, not causal command attribution. */
  windowId?: string;
}
export interface OrcaObservation extends BackendSpeechObservation {
  kind: 'screenreader'; collectionStartedAt: string; reason: 'quiet' | 'deadline';
  outputs: OrcaOutput[]; speech: string[]; commandIds: number[];
  attribution: 'temporal-only'; speechComplete: 'unknown';
}
export interface OrcaReceipt { windowId: string; commandIds: number[]; acknowledgedAt: number; commands: OrcaCommandReceipt[] }
export type OrcaEvent = (OrcaTransportEvent & { windowId?: string }) | {
  type: 'windowOpened' | 'windowClosed'; timestamp: number; windowId: string; observation?: OrcaObservation;
};
type Window = { id: string; startedAt: number; acknowledgedAt: number; commandIds: number[] };

/** Real Orca speech-pipeline adapter over a local process, not AT Driver compatibility or AX-to-text simulation. */
export class OrcaBackend implements Backend {
  readonly observationKind = 'screenreader' as const;
  readonly evidenceProvenance = 'native' as const;
  readonly capabilities = orcaCapabilities;
  readonly cleanupTimeoutMs = RAWSTEP_DEFAULTS.cleanupTimeoutMs.nativeBackend;
  private readonly sessionId = randomUUID();
  private targetWindowId?: number;
  private readonly client: OrcaBridgeClient;
  private readonly quietMs: number;
  private readonly maxWaitMs: number;
  private readonly unsubscribe: () => void;
  private listeners = new Set<(event: OrcaEvent) => void>();
  private state: 'new' | 'starting' | 'ready' | 'closed' = 'new';
  private busy = false;
  private observationInProgress = false;
  private failure?: OrcaBridgeError;
  private window?: Window;
  private nextWindow = 1;
  private outputs: OrcaOutput[] = [];
  private outputCharacters = 0;
  private lastOutputAt = 0;
  private wake?: () => void;
  private closePromise?: Promise<void>;

  constructor(private readonly options: OrcaBackendOptions = {}) {
    if (options.targetWindowId !== undefined && (!Number.isSafeInteger(options.targetWindowId) || options.targetWindowId <= 1)) throw new Error('targetWindowId must be a valid X11 window ID greater than one');
    this.quietMs = validInterval(options.quietMs ?? 500, 'quietMs');
    this.maxWaitMs = validInterval(options.maxWaitMs ?? 3_000, 'maxWaitMs');
    this.client = new OrcaBridgeClient(options, this.sessionId);
    this.unsubscribe = this.client.subscribe(event => {
      if (event.type === 'command' && this.window && event.commandId !== undefined) this.window.commandIds.push(event.commandId);
      if (event.type === 'output' && typeof event.text === 'string') {
        // No silent truncation: incomplete evidence must fail the run explicitly.
        if (this.outputs.length >= 10_000 || this.outputCharacters + event.text.length > 8_388_608) {
          this.failure ??= new OrcaBridgeError('Orca speech collection exceeded the bounded buffer', 'output overflow');
          this.emit({ type: 'error', sequence: event.sequence, timestamp: event.timestamp, error: this.failure.message });
          this.wake?.(); void this.close().catch(() => {}); return;
        }
        this.outputCharacters += event.text.length;
        this.lastOutputAt = event.timestamp;
        this.outputs.push({ sequence: event.sequence, receivedAt: new Date(event.timestamp).toISOString(), text: event.text, raw: event.raw, ...(this.window ? { windowId: this.window.id } : {}) });
      }
      if (event.type === 'error' || (event.type === 'closed' && this.state !== 'closed')) this.failure ??= new OrcaBridgeError(event.error ?? 'Orca bridge closed', 'connection closed');
      this.emit({ ...event, ...(this.window ? { windowId: this.window.id } : {}) });
      this.wake?.();
    });
  }
  subscribe(listener: (event: OrcaEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(event: OrcaEvent): void {
    for (const listener of this.listeners) { try { listener(structuredClone(event)); } catch { /* Observer owns its errors. */ } }
  }
  private beginWindow(): Window {
    if (!this.window) {
      const now = Date.now();
      this.window = { id: `orca-window-${this.nextWindow++}`, startedAt: now, acknowledgedAt: now, commandIds: [] };
      this.emit({ type: 'windowOpened', timestamp: now, windowId: this.window.id });
    }
    return this.window;
  }
  private assertReady(): void {
    if (this.failure) throw this.failure;
    if (this.state !== 'ready') throw new OrcaBridgeError('Orca backend is not ready', 'invalid state');
  }
  async start(options: BackendOperationOptions = {}): Promise<OrcaMetadata> {
    options.signal?.throwIfAborted();
    if (this.state !== 'new') throw new OrcaBridgeError('Orca backend has already started or closed', 'invalid state');
    this.state = 'starting';
    const window = this.beginWindow();
    try {
      await this.client.connect(options);
      const receipt = await this.client.request('session.start', { protocol: ORCA_NATIVE_PROTOCOL, sessionId: this.sessionId, ...(this.options.targetWindowId !== undefined ? { targetWindowId: this.options.targetWindowId } : {}) }, options, this.client.startupTimeoutMs);
      options.signal?.throwIfAborted();
      const result = receipt.result;
      if (!record(result) || result.protocol !== ORCA_NATIVE_PROTOCOL || result.sessionId !== this.sessionId || result.atName !== 'Orca' || result.platformName !== 'linux' || result.speechSource !== 'orca-speech' || result.captureStage !== 'speech-dispatcher-submission' || result.audioVerified !== false || typeof result.atVersion !== 'string' || !result.atVersion.trim()) {
        throw new OrcaBridgeError('Invalid Orca startup handshake; native speech capture was not established', 'protocol error', receipt.commandId);
      }
      if (!Number.isSafeInteger(result.targetWindowId) || (result.targetWindowId as number) <= 1 || !Number.isSafeInteger(result.targetProcessId) || (result.targetProcessId as number) <= 0 || typeof result.targetClass !== 'string' || !result.targetClass.trim() || result.targetClass.length > 128 || (this.options.targetWindowId !== undefined && result.targetWindowId !== this.options.targetWindowId)) {
        throw new OrcaBridgeError('Invalid Orca target handshake; the requested browser window was not verified', 'protocol error', receipt.commandId);
      }
      if (this.failure) throw this.failure;
      if (this.state !== 'starting') throw new OrcaBridgeError('Orca backend closed during startup', 'connection closed');
      const value = (key: string) => typeof result[key] === 'string' && result[key] ? result[key] as string : 'unknown';
      window.acknowledgedAt = receipt.acknowledgedAt;
      this.state = 'ready';
      this.targetWindowId = result.targetWindowId as number;
      return {
        backend: 'orca-native', profile: 'orca', protocol: ORCA_NATIVE_PROTOCOL, sessionId: this.sessionId,
        capabilities: this.capabilities,
        environment: { atName: 'Orca', atVersion: result.atVersion, platformName: 'linux', platformVersion: value('platformVersion'), locale: value('locale'), keyboardLayout: value('keyboardLayout'), screenReaderSettings: 'unknown' },
        capture: { source: 'orca-speech', kind: 'speech-pipeline-text', stage: 'speech-dispatcher-submission', audioVerified: false }, assumptions: orcaAssumptions,
        target: { windowId: result.targetWindowId as number, windowClass: result.targetClass, processId: result.targetProcessId as number, browserSessionAssociation: 'caller-responsibility' },
        collection: { quietMs: this.quietMs, maxWaitMs: this.maxWaitMs, attribution: 'temporal-only', speechCompletionSignal: false },
      };
    } catch (error) { await this.close(); throw error; }
  }
  /** Orca speech and input follow one exact visible Linux window, paired by a trusted session factory. */
  preflight(context: BackendRunContext): void {
    if (context.platform !== 'linux' || context.headless || !context.customBrowserSession || !Number.isSafeInteger(this.targetWindowId) || this.targetWindowId! < 2) throw new RawstepError('backend-precondition', 'Native Orca requires a visible Linux browser, exact native target and explicit prepaired browserSessionFactory.');
  }
  attachSession(session: BackendSession): void {
    if (session.nativeTargetWindowId !== this.targetWindowId) throw new RawstepError('backend-precondition', 'Native browser window does not match the Orca speech/input target.');
  }
  async execute(action: BackendAction, options: BackendOperationOptions = {}): Promise<OrcaReceipt> {
    options.signal?.throwIfAborted(); this.assertReady();
    if (this.busy || this.observationInProgress) throw new OrcaBridgeError('Concurrent Orca execution/observation is not supported', 'invalid state');
    const presses = mapOrcaAction(action);
    this.busy = true;
    const window = this.beginWindow();
    const commands: OrcaCommandReceipt[] = [];
    try {
      for (const keys of presses) {
        options.signal?.throwIfAborted();
        const receipt = await this.client.request('input.pressKeys', { sessionId: this.sessionId, keys }, options);
        options.signal?.throwIfAborted();
        if (!record(receipt.result) || Object.keys(receipt.result).length !== 0) throw new OrcaBridgeError('Invalid native keyboard acknowledgement', 'protocol error', receipt.commandId);
        commands.push(receipt); window.acknowledgedAt = receipt.acknowledgedAt;
      }
      options.signal?.throwIfAborted(); this.assertReady();
      return { windowId: window.id, commandIds: commands.map(command => command.commandId), acknowledgedAt: window.acknowledgedAt, commands };
    } catch (error) {
      // An unacknowledged keypress can still execute. Never permit later actions to race it.
      await this.close(); throw error;
    } finally { this.busy = false; }
  }
  async observe({ signal }: BackendOperationOptions = {}): Promise<OrcaObservation> {
    signal?.throwIfAborted(); this.assertReady();
    if (this.busy || this.observationInProgress) throw new OrcaBridgeError('Concurrent Orca execution/observation is not supported', 'invalid state');
    this.observationInProgress = true;
    const window = this.beginWindow();
    const collectionStartedAt = Date.now();
    const deadline = collectionStartedAt + this.maxWaitMs;
    try {
      const reason = await new Promise<'quiet' | 'deadline'>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (reason?: 'quiet' | 'deadline', error?: unknown) => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort); this.wake = undefined;
          if (reason) resolve(reason); else reject(error);
        };
        const abort = () => finish(undefined, signal!.reason);
        const check = () => {
          clearTimeout(timer);
          if (signal?.aborted) { abort(); return; }
          if (this.failure || this.state === 'closed') { finish(undefined, this.failure ?? new OrcaBridgeError('Orca backend closed', 'connection closed')); return; }
          const now = Date.now();
          const quietAt = Math.max(collectionStartedAt, window.acknowledgedAt, this.lastOutputAt) + this.quietMs;
          if (now >= deadline) { finish('deadline'); return; }
          if (now >= quietAt) { finish('quiet'); return; }
          timer = setTimeout(check, Math.min(quietAt, deadline) - now);
        };
        signal?.addEventListener('abort', abort, { once: true }); this.wake = check; check();
      });
      signal?.throwIfAborted(); this.assertReady();
      const outputs = this.outputs.splice(0); this.outputCharacters = 0;
      const observation: OrcaObservation = {
        kind: 'screenreader', windowId: window.id, startedAt: new Date(window.startedAt).toISOString(), endedAt: new Date().toISOString(),
        collectionStartedAt: new Date(collectionStartedAt).toISOString(), reason, outputs, speech: outputs.map(output => output.text),
        commandIds: [...window.commandIds], attribution: 'temporal-only', speechComplete: 'unknown',
      };
      this.window = undefined;
      this.emit({ type: 'windowClosed', timestamp: Date.parse(observation.endedAt), windowId: observation.windowId, observation });
      signal?.throwIfAborted();
      return observation;
    } catch (error) { await this.close(); throw error; }
    finally { this.observationInProgress = false; }
  }
  close(): Promise<void> {
    if (!this.closePromise) {
      this.state = 'closed'; this.wake?.();
      this.closePromise = this.client.close().finally(() => { this.unsubscribe(); this.outputs = []; this.outputCharacters = 0; });
    }
    return this.closePromise;
  }
}

export { orcaBridgePath } from './paths.js';
