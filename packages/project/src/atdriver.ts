import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { AtDriverBackend, checkVoiceOverPlace } from '@rawstep/screenreaders/at-driver';
import { atEndpointOf, type AtBackend, type MachineSettings } from './config.js';
import { ProjectError } from './errors.js';
import { nativeBackendProblem } from './plan.js';

export type AtDriverHandle = {
  /** Whether Rawstep started the server (and will stop it) or found one already running. */
  started: boolean;
  stop: () => Promise<void>;
};
export type AtDriverOptions = {
  /** The AT Driver WebSocket address, e.g. ws://localhost:4382/session. */
  endpoint: string;
  /** The shell command that starts the server; without one a server that is not running is an error. */
  command?: string | undefined;
  cwd?: string;
  signal?: AbortSignal;
  /** How long to wait for a started server to accept connections (default 30 s). */
  timeoutMs?: number;
};

const OUTPUT_TAIL = 2000;
const POLL_MS = 300;

/** Whether something accepts TCP connections at the endpoint's host and port. */
export function endpointAnswers(endpoint: string, timeoutMs = 1000): Promise<boolean> {
  const url = new URL(endpoint), port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
  return new Promise(resolve => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port });
    const done = (answer: boolean) => { socket.destroy(); resolve(answer); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  // The command runs in a shell; stop the whole group so the server it launched goes too.
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { child.kill('SIGTERM'); }
}

/**
 * Makes sure an AT Driver server answers at `endpoint` for one run. A server that already answers is used as it is. Otherwise the
 * configured command is started, Rawstep waits until the address accepts connections, and `stop` ends what it started. The screen
 * reader itself and the OS permissions it needs are still the person's to set up.
 */
export async function ensureAtDriver({ endpoint, command, cwd, signal, timeoutMs = 30000 }: AtDriverOptions): Promise<AtDriverHandle> {
  if (await endpointAnswers(endpoint)) return { started: false, stop: async () => {} };
  if (!command?.trim()) throw new ProjectError('at-driver-not-running', `No AT Driver server answers at ${endpoint}. Start it yourself, or set the command Rawstep should start it with.`);
  const child = spawn(command, { shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let output = '';
  const keep = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL); };
  child.stdout?.on('data', keep); child.stderr?.on('data', keep);
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  child.once('error', error => keep(Buffer.from(String(error))));
  const stop = async () => { kill(child); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); };
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      signal?.throwIfAborted();
      if (child.exitCode !== null) throw new ProjectError('at-driver-start-failed', `The AT Driver command exited (code ${child.exitCode}) before ${endpoint} answered.${output.trim() ? ` Last output: ${output.trim()}` : ''}`);
      if (await endpointAnswers(endpoint)) return { started: true, stop };
      if (Date.now() > deadline) throw new ProjectError('at-driver-start-failed', `The AT Driver command started, but nothing answered at ${endpoint} within ${Math.round(timeoutMs / 1000)} s.${output.trim() ? ` Last output: ${output.trim()}` : ''}`);
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  } catch (error) { await stop(); throw error; }
}

type NativeBackend = Exclude<AtBackend, 'simulation'>;
/** The steps of the setup check, replaceable so a caller can check without a server or a screen reader (tests). */
export type NativeCheckSteps = {
  ensure?: (options: AtDriverOptions) => Promise<AtDriverHandle>;
  /** Opens a session with the AT Driver server and returns what it said about itself. */
  session?: (options: { profile: NativeBackend; url: string }) => Promise<unknown>;
  /** VoiceOver only: asks where its cursor is, as a run does to get into each page. */
  cursor?: () => Promise<unknown>;
};
export type NativeCheck = {
  /** Whether the check started the AT Driver server with the saved command (it stopped it again). */
  started: boolean;
  /** What the AT Driver server said about itself, when a session opened. */
  metadata?: unknown;
  /**
   * What stands in the way of a run, in the order a run would meet it: `setup` (the wrong operating system or address: nothing else
   * was tried), `server` (nothing answers and no command starts one), `session` (the server would not open a session), `cursor`
   * (VoiceOver would not say where its cursor is). Empty when a run could start.
   */
  problems: { stage: 'setup' | 'server' | 'session' | 'cursor'; error: unknown }[];
};
/**
 * Checks that a native screen reader run could start on this computer, the way a run starts one: the reader fits this operating
 * system and its address is on this host, an AT Driver server answers (started with the saved command when nothing answers yet, and
 * stopped again), a session opens, and for VoiceOver its cursor can be read. The one check behind `rawstep doctor` and the dashboard's
 * check button, so neither passes what a run would fail on. It checks the connection, never real speech.
 */
export async function checkNativeScreenReader(options: { backend: NativeBackend; machine: MachineSettings; command?: string | undefined; cwd?: string; signal?: AbortSignal }, steps: NativeCheckSteps = {}): Promise<NativeCheck> {
  const { backend, machine } = options, setup = nativeBackendProblem(backend, machine);
  if (setup) return { started: false, problems: [{ stage: 'setup', error: setup }] };
  const url = atEndpointOf(machine, backend), problems: NativeCheck['problems'] = [];
  let started = false, metadata: unknown;
  try {
    const driver = await (steps.ensure ?? ensureAtDriver)({ endpoint: url, command: options.command, ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    started = driver.started;
    try {
      metadata = await (steps.session ?? (async target => { const reader = new AtDriverBackend(target); try { return await reader.start({ signal: AbortSignal.timeout(5000) }); } finally { await reader.close(); } }))({ profile: backend, url });
    } catch (error) { problems.push({ stage: 'session', error }); }
    finally { await driver.stop(); }
  } catch (error) { problems.push({ stage: 'server', error }); }
  // VoiceOver's cursor is asked through AppleScript and System Events, each with a macOS permission of its own: it is worth knowing
  // about even when the server is not up yet.
  if (backend === 'voiceover') {
    try { await (steps.cursor ?? (() => checkVoiceOverPlace(undefined, AbortSignal.timeout(30_000))))(); }
    catch (error) { problems.push({ stage: 'cursor', error }); }
  }
  return { started, ...(metadata !== undefined ? { metadata } : {}), problems };
}
