import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserSession } from '@rawstep/browser/browser';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { hydrateScreenshots, readTrace } from '@rawstep/core/trace';
import { analyzeSavedTrace, readAnalysis } from '@rawstep/reports/analyze';
import { writeReport } from '@rawstep/reports/report';
import { HINTS_SCHEMA_VERSION, writeHints, type HintFinding, type HintReport } from '@rawstep/reports/hints';
import { ProjectError } from '@rawstep/project/errors';
import { atEndpointOf, credentialRequirements } from '@rawstep/project/config';
import { ProjectStore, initProject } from '@rawstep/project/store';
import { projectAnalyzer, runTask, type RunTaskResult } from '@rawstep/project/run';
import { CLI_USAGE, CliUsageError, parseCliArguments, type CliArguments } from './args.js';

export { CLI_USAGE, CliUsageError, parseCliArguments } from './args.js';

/** Injectable boundaries let CLI checks run without a browser, a model or a native screen reader. */
export interface CliDependencies {
  startDashboard?: (options: { projectDir: string; port: number }) => Promise<{ url: string; close(): Promise<void> }>;
  runTask?: typeof runTask;
  /** Launches and closes a browser; rejects when none can start. */
  launchBrowser?: (options: { executablePath?: string }) => Promise<void>;
  /** Opens and closes an AT Driver session; rejects when the endpoint does not answer. */
  checkNativeBackend?: (options: { profile: 'voiceover' | 'nvda'; url: string }) => Promise<unknown>;
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Defaults to process; injectable so embedders can scope cancellation. */
  signals?: {
    on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
    off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  };
}

/** The version of the package this code ships in: the nearest package.json above it, in a checkout and in the bundled `rawstep` package. */
async function packageVersion(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++, directory = dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) return (JSON.parse(await readFile(manifest, 'utf8')) as { version: string }).version;
  }
  throw new Error('Cannot locate the package manifest to read the version from.');
}

export async function runCli(argv: string[] = process.argv.slice(2), dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? (text => process.stdout.write(text));
  const stderr = dependencies.stderr ?? (text => process.stderr.write(text));
  const cwd = dependencies.cwd ?? process.cwd();
  try {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { stdout(CLI_USAGE); return 0; }
    if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
      stdout(`${await packageVersion()}\n`); return 0;
    }
    const args = parseCliArguments(argv);
    const projectDir = resolve(cwd, String(args.options.project ?? '.'));
    switch (args.command) {
      case 'init': {
        const path = await initProject(projectDir);
        stdout(`Created ${path}\n\nNext:\n  npx rawstep ui                     add a model and a task\n  npx rawstep run <task>             run a task\n\nCommit rawstep.config.json. Keep .env.local (API keys) and .rawstep/ (run output) out of git.\n`);
        return 0;
      }
      case 'ui': return await ui(args, projectDir, dependencies, stdout);
      case 'run': return await run(args, projectDir, cwd, dependencies, stdout, stderr);
      case 'doctor': return await doctor(projectDir, dependencies, stdout);
      case 'hints': {
        const input = resolve(cwd, args.positionals[0]!);
        const { path, report } = await writeHints(input, args.options.reference ? { reference: resolve(cwd, String(args.options.reference)) } : {});
        stdout(`Hints: ${report.hints.length} · goal reached: ${report.goalReached ? 'yes' : 'no'} · steps ${report.steps}${report.reference ? ` · reference ${report.reference.steps} steps` : ''}\n`
          + report.hints.map(hint => `step ${hint.steps.join(',')} · ${hint.kind} · ${hint.certainty} · ${hint.summary}\n`).join('') + `Wrote ${path}\n`);
        return 0;
      }
      case 'analyze': {
        const input = resolve(cwd, args.positionals[0]!), outDir = args.options.out ? resolve(cwd, String(args.options.out)) : await traceDirectory(input);
        const analyzer = args.options.profile ? (await projectAnalyzer(projectDir, { profile: String(args.options.profile) })).analyzer : undefined;
        const analysis = await analyzeSavedTrace(input, { analyzer, outDir });
        stdout(`Analysis: ${analysis.status}\nSaved: ${resolve(outDir, 'analysis.json')}\n`);
        stdout(`Hints saved: ${(await writeHints(input)).path}\n`);
        return analysis.status === 'completed' ? 0 : 1;
      }
      case 'report': {
        const input = resolve(cwd, args.positionals[0]!), directory = await traceDirectory(input);
        const outDir = args.options.out ? resolve(cwd, String(args.options.out)) : directory;
        // Reports may land anywhere, so embed the screenshots that traces keep as blobs next to trace.json.
        const trace = await hydrateScreenshots(await readTrace(input), directory);
        const analysis = args.options.analysis ? await readAnalysis(resolve(cwd, String(args.options.analysis)), trace) : undefined;
        const hints = await readHints(directory);
        const paths = await writeReport(trace, analysis, outDir, hints ? { hints } : {});
        stdout(`Report: ${paths.htmlPath}\nData: ${paths.jsonPath}\n`);
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof CliUsageError) { stderr(`${error.message}\n`); return 2; }
    stderr(`${errorDetails(error)}\n`);
    return 1;
  }
}

async function ui(args: CliArguments, projectDir: string, dependencies: CliDependencies, stdout: (text: string) => void): Promise<number> {
  const startDashboard = dependencies.startDashboard ?? (await import('@rawstep/dashboard')).startDashboard;
  const app = await startDashboard({ projectDir, port: Number(args.options.port ?? 4318) });
  stdout('Rawstep dashboard: ' + app.url + '\n');
  const signals = dependencies.signals ?? process;
  await new Promise<void>((accept, reject) => {
    const stop = () => { signals.off('SIGINT', stop); signals.off('SIGTERM', stop); void app.close().then(accept, reject); };
    signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
  });
  return 0;
}

async function run(args: CliArguments, projectDir: string, cwd: string, dependencies: CliDependencies, stdout: (text: string) => void, stderr: (text: string) => void): Promise<number> {
  const { options } = args, task = args.positionals[0]!, repeat = options.repeat === undefined ? 1 : Number(options.repeat);
  const mode = options.mode === 'screenreader' ? 'screenreader' : 'keyboard';
  if (!options.json) stderr(`Running ${task} in ${mode} mode${repeat > 1 ? `, ${repeat} times` : ''}...\n`);
  let cancelledBy: 'SIGINT' | 'SIGTERM' | undefined, result: RunTaskResult;
  try {
    result = await withRunSignals(dependencies.signals ?? process, stderr, signal => (dependencies.runTask ?? runTask)(task, {
      projectDir, mode, repeat, signal,
      ...(options.profile ? { profile: String(options.profile) } : {}),
      ...(options.out ? { outDir: resolve(cwd, String(options.out)) } : {}),
    }), received => { cancelledBy = received; });
  } catch (error) {
    // A cancelled run is neither a result nor a usage problem: report it and exit with the signal's conventional code.
    if (cancelledBy) { stderr(`${errorDetails(error)}\n`); return cancelledBy === 'SIGTERM' ? 143 : 130; }
    throw error;
  }
  stdout(options.json ? JSON.stringify(result, null, 2) + '\n' : formatRunResult(result));
  return 0;
}

const outcomeText = (outcome: RunTaskResult['runs'][number]['outcome']) => !outcome ? 'no outcome recorded'
  : outcome.status === 'success' ? 'goal reached' : outcome.status === 'failure' ? `goal not reached${outcome.reason ? ` (${outcome.reason})` : ''}`
  : outcome.status === 'aborted' ? 'aborted' : `inconclusive${outcome.reason ? ` (${outcome.reason})` : ''}`;
const elementText = (finding: HintFinding) => finding.target ? `${finding.target.role}${finding.target.name ? ` "${finding.target.name}"` : ''}` : '(no element)';

/** One block per run, then the findings gathered across runs: Page findings first, then Model. */
export function formatRunResult(result: RunTaskResult): string {
  const lines: string[] = [];
  result.runs.forEach((run, index) => {
    lines.push(`Run ${index + 1} of ${result.runs.length}: ${outcomeText(run.outcome)} · ${run.hints.steps} steps`);
    for (const hint of run.hints.hints.filter(h => h.source === 'run')) lines.push(`  ${hint.summary}`);
    lines.push(`  ${run.outDir}`);
  });
  lines.push('');
  const groups: [string, HintFinding['source']][] = [['Page', 'page'], ['Model', 'model']];
  if (!result.findings.length) lines.push('No page or model findings.');
  for (const [title, source] of groups) {
    const findings = result.findings.filter(f => f.source === source);
    if (!findings.length) continue;
    lines.push(title);
    for (const f of findings) lines.push(`  ${elementText(f)} · ${f.kind} · ${f.runs} of ${f.totalRuns} runs`);
  }
  lines.push('', `Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>`);
  return lines.join('\n') + '\n';
}

/** Whether a Node version (`22.11.0`) meets the package's `>=22.12.0`: the minor version counts, not only the major. */
export function nodeSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

async function doctor(projectDir: string, dependencies: CliDependencies, stdout: (text: string) => void): Promise<number> {
  let failed = false;
  const report = (ok: boolean | undefined, label: string, detail: string) => { if (ok === false) failed = true; stdout(`${ok === undefined ? 'skip' : ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}\n`); };
  report(nodeSupported(process.versions.node), 'Node', `${process.version} (needs >= 22.12)`);
  const store = new ProjectStore(projectDir);
  let read: Awaited<ReturnType<ProjectStore['read']>> | undefined;
  try {
    read = await store.read();
    const c = read.config;
    report(true, 'Config', `${store.path} (${c.connections.length} connections, ${c.tasks.length} tasks, ${c.profiles.length} profiles)`);
  } catch (error) { report(false, 'Config', errorDetails(error)); }
  const executablePath = read?.config.machine.browserExecutablePath || undefined;
  try {
    await (dependencies.launchBrowser ?? (async options => { const session = await createBrowserSession('about:blank', { headless: true, executablePath: options.executablePath }); await session.close(); }))({ ...(executablePath ? { executablePath } : {}) });
    report(true, 'Browser', executablePath ? `launched ${executablePath}` : 'launched');
  } catch (error) { report(false, 'Browser', `${errorDetails(error)}. Install one with \`npx playwright install chromium\` or set machine.browserExecutablePath in the config.`); }
  if (read) {
    for (const key of credentialRequirements(read.config)) {
      const label = `Key ${key.label}`;
      if (!key.env) { report(!key.required, label, key.required ? 'no environment variable is named for it' : 'no API key needed'); continue; }
      const present = !!await store.credential(key.connection);
      report(present || !key.required, label, present ? `${key.env} is set` : key.required ? `${key.env} is missing. Add ${key.env}=... to .env.local or export it` : `${key.env} is not set (optional for this server)`);
    }
    const { backend } = read.config.machine, atEndpoint = atEndpointOf(read.config.machine);
    if (backend === 'simulation') report(undefined, 'Screen reader', 'machine.backend is simulation; no native screen reader to check');
    else {
      try {
        await (dependencies.checkNativeBackend ?? (async options => { const b = new AtDriverBackend(options); try { return await b.start({ signal: AbortSignal.timeout(5000) }); } finally { await b.close(); } }))({ profile: backend, url: atEndpoint });
        report(true, 'Screen reader', `${backend} AT Driver answered at ${atEndpoint}. This checks the protocol connection only; verify real speech on the target host`);
      } catch (error) { report(false, 'Screen reader', `${backend} AT Driver at ${atEndpoint}: ${errorDetails(error)}. Start the AT Driver server and the screen reader, then run doctor again`); }
    }
  }
  return failed ? 1 : 0;
}

async function withRunSignals<T>(
  signals: NonNullable<CliDependencies['signals']>,
  stderr: (text: string) => void,
  operation: (signal: AbortSignal) => Promise<T>,
  onSignal: (signal: 'SIGINT' | 'SIGTERM') => void,
): Promise<T> {
  const controller = new AbortController();
  const cancel = (signal: 'SIGINT' | 'SIGTERM') => () => {
    if (controller.signal.aborted) return;
    onSignal(signal);
    controller.abort(signal);
    stderr(`Received ${signal}; stopping, keeping the traces written so far.\n`);
  };
  const interrupt = cancel('SIGINT'), terminate = cancel('SIGTERM');
  signals.on('SIGINT', interrupt); signals.on('SIGTERM', terminate);
  try { return await operation(controller.signal); }
  finally { signals.off('SIGINT', interrupt); signals.off('SIGTERM', terminate); }
}

function errorDetails(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && !seen.has(current) && messages.length < 5) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    const code = !(current instanceof ProjectError) && typeof current === 'object' && current !== null && typeof (current as { code?: unknown }).code === 'string' ? (current as { code: string }).code : undefined;
    const detail = code && !message.includes(code) ? `${message} (${code})` : message;
    if (!messages.includes(detail)) messages.push(detail);
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join('; caused by: ');
}

/** A hints.json next to the trace is optional report input; absent or unreadable means no hints section. */
async function readHints(directory: string): Promise<HintReport | undefined> {
  try { const value: unknown = JSON.parse(await readFile(resolve(directory, 'hints.json'), 'utf8')); return isObject(value) && value.schemaVersion === HINTS_SCHEMA_VERSION && Array.isArray(value.hints) ? value as HintReport : undefined; }
  catch { return undefined; }
}
async function traceDirectory(path: string): Promise<string> { return (await stat(path)).isDirectory() ? path : dirname(path); }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
