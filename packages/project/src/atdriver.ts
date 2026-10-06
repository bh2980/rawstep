import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { ProjectError } from './errors.js';

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
