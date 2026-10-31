import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserConnectError, createBrowserSession } from '@rawstep/browser/browser';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { discover } from '@rawstep/project/discover';
import { readTrace } from '@rawstep/core/trace';
import { findRawstepError } from '@rawstep/core/errors';
import { analyzeSavedTrace, readAnalysis } from '@rawstep/reports/analyze';
import { writeReport } from '@rawstep/reports/report';
import { HINTS_SCHEMA_VERSION, writeHints, type HintFinding, type HintReport } from '@rawstep/reports/hints';
import { isStuck, isWrongGuess, runEnding, type RunEnding, type UnmeasuredBy } from '@rawstep/reports/endings';
import { ProjectError } from '@rawstep/project/errors';
import { agentOf, atEndpointOf, CONFIG_FILE, credentialRequirements, isFilePlanner, PROVIDERS, type ProviderId } from '@rawstep/project/config';
import { ProjectStore, findAgentCli, initProject } from '@rawstep/project/store';
import { projectAnalyzer, runTask, type RunTaskResult } from '@rawstep/project/run';
import { CLI_USAGE, CliUsageError, parseCliArguments, parseRunRules, type CliArguments } from './args.js';

export { CLI_USAGE, CliUsageError, parseCliArguments } from './args.js';

/** Injectable boundaries let CLI checks run without a browser, a model or a native screen reader. */
export interface CliDependencies {
  startDashboard?: (options: { projectDir: string; port: number }) => Promise<{ url: string; close(): Promise<void> }>;
  runTask?: typeof runTask;
  /** Launches and closes a browser; rejects when none can start. */
  launchBrowser?: (options: { executablePath?: string; cdpEndpoint?: string }) => Promise<void>;
  /** Opens and closes an AT Driver session; rejects when the endpoint does not answer. */
  checkNativeBackend?: (options: { profile: 'voiceover' | 'nvda'; url: string }) => Promise<unknown>;
  /** Test seam: whether a coding-agent CLI is installed and signed in. */
  /** Starts a coding-agent CLI over ACP and reads its models; rejects when it is missing or needs a sign-in. */
  checkAgent?: (connection: { provider: string }) => Promise<unknown>;
  /** Test seam: the coding-agent CLI `init` finds on PATH. */
  findAgent?: () => Promise<ProviderId | undefined>;
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
        const path = await initProject(projectDir), next = await nextSteps(dependencies);
        stdout(`Created ${path} and a demo task in rawstep/demo/.\n\nNext:\n`
          + `  npx rawstep run demo               the demo task on a plan written beforehand (no model, no key)\n`
          + `  npx rawstep ui                     see the result and add your own tasks\n\n${next}`
          + `Commit rawstep.config.json and rawstep/. Keep .env.local (API keys) and .rawstep/ (run output) out of git.\n`);
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
        const analyzer = args.options.llm ? (await projectAnalyzer(projectDir)).analyzer : undefined;
        const analysis = await analyzeSavedTrace(input, { analyzer, outDir });
        stdout(`Analysis: ${analysis.status}\nSaved: ${resolve(outDir, 'analysis.json')}\n`);
        stdout(`Hints saved: ${(await writeHints(input)).path}\n`);
        return analysis.status === 'completed' ? 0 : 1;
      }
      case 'report': {
        const input = resolve(cwd, args.positionals[0]!), directory = await traceDirectory(input);
        const outDir = args.options.out ? resolve(cwd, String(args.options.out)) : directory;
        const trace = await readTrace(input);
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

/**
 * How the "Item by item" profile gets a planner: Rawstep never connects a model for the person, because a connection sends what the
 * user hears to a provider on their account. A coding-agent CLI found on this computer is named as the shortest way.
 */
async function nextSteps(dependencies: CliDependencies): Promise<string> {
  const agent = await (dependencies.findAgent ?? findAgentCli)();
  return `For a first-time screen reader user planned by a model, the "Item by item" profile needs one: in \`npx rawstep ui\`, Settings > AI connections.\n`
    + (agent ? `${PROVIDERS[agent].label} is installed on this computer: it plans on its own sign-in, with no API key.\n\n` : `A coding-agent CLI you are signed in to (Claude Code, Codex, opencode, Grok) needs no API key.\n\n`);
}

async function ui(args: CliArguments, projectDir: string, dependencies: CliDependencies, stdout: (text: string) => void): Promise<number> {
  const startDashboard = dependencies.startDashboard ?? (await import('@rawstep/dashboard')).startDashboard;
  // A first `rawstep ui` in an empty folder starts with the same demo as `rawstep init`, so there is a task to run at once.
  if (!existsSync(join(projectDir, CONFIG_FILE))) stdout(`Created ${await initProject(projectDir)} with a demo task.\n${await nextSteps(dependencies)}`);
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
  if (!options.json) stderr(`Running ${task}${repeat > 1 ? `, ${repeat} times` : ''}...\n`);
  let cancelledBy: 'SIGINT' | 'SIGTERM' | undefined, result: RunTaskResult;
  try {
    result = await withRunSignals(dependencies.signals ?? process, stderr, signal => (dependencies.runTask ?? runTask)(task, {
      projectDir, repeat, signal,
      ...(options.profile ? { profile: String(options.profile) } : {}),
      ...(options.rule ? { runRules: parseRunRules(options.rule as string[]) } : {}),
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

const ENDING_TEXT: Record<RunEnding, string> = { reached: 'reached the goal', 'gave-up': 'gave up', mistaken: 'said it was done, but the goal was not reached', unmeasured: 'not measured' };
const BY_TEXT: Record<UnmeasuredBy, string> = { 'planner-calls': 'planner-call limit', 'max-steps': 'max steps', timeout: 'time limit', 'repetition-guard': 'repetition guard', 'model-uncertain': 'the model was unsure', other: 'stopped early' };
/** "gave up", "not measured (max steps)": how a run ended, in the terms of the question Rawstep answers. */
export function endingText(outcome: RunTaskResult['runs'][number]['outcome']): string {
  if (!outcome) return 'no outcome recorded';
  if (outcome.status === 'aborted') return 'aborted';
  if (outcome.reason === 'error' || outcome.reason === 'trace-persistence-error') return 'ended on an error (says nothing about the page)';
  const ended = runEnding(outcome, stopOf(outcome))!;
  return ended.by ? `${ENDING_TEXT[ended.ending]} (${BY_TEXT[ended.by]})` : ENDING_TEXT[ended.ending];
}
/** Who stopped a run that stopped itself, as the trace recorded it. */
const stopOf = (outcome: Record<string, unknown>) => typeof outcome.policyStopSource === 'string' ? outcome.policyStopSource : undefined;
const elementText = (target: HintFinding['target']) => target ? `${target.role}${target.name ? ` "${target.name}"` : ''}` : '(no element)';
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/** Hints shown in their own lines of a run's block rather than as summaries. */
const STRUCTURED: readonly string[] = ['early-stop', 'goal-word-stretch'];
/** Hints that say the planner wrote a new plan, counted per run by why. */
const PLAN_KINDS: readonly string[] = ['replan', 'task-limit'];
const PLAN_REASONS: Record<string, string> = { failures: 'actions kept failing', 'no-change': 'actions changed nothing', oscillation: 'going back and forth' };
const planReason = (hint: { kind: string; detail: Record<string, unknown> }) => hint.kind === 'task-limit' ? 'a task ran out of actions'
  : PLAN_REASONS[String(hint.detail.trigger)] ?? String(hint.detail.trigger);
const countBy = (values: string[]) => values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>());

/**
 * One block per run (how it ended, why a user gave up and on what, the cost), then across the runs: could a first-time user do it,
 * what reaching the goal cost, where pressing something did not respond as expected, and the other findings, Page before Model.
 */
export function formatRunResult(result: RunTaskResult): string {
  const lines: string[] = [];
  const c = result.conditions as { profile?: { name?: string }; combo?: { name?: string; planner?: string; planFile?: string }; pageEnvironment?: { profile?: unknown }; atEnvironment?: { backend?: string } };
  if (c.combo) {
    lines.push(`Conditions: ${c.profile?.name ?? c.combo.name} (planner ${c.combo.planner ?? (c.combo.planFile ? `plan file ${c.combo.planFile}` : '?')})`,
      `  page ${typeof c.pageEnvironment?.profile === 'string' ? c.pageEnvironment.profile : 'custom'} · screen reader ${c.atEnvironment?.backend ?? '?'}`);
    for (const warning of result.warnings) lines.push(`  note: ${warning}`);
    lines.push('');
  }
  result.runs.forEach((run, index) => {
    const hints = run.hints.hints, find = (kind: string) => hints.find(hint => hint.kind === kind);
    lines.push(`Run ${index + 1} of ${result.runs.length}: ${endingText(run.outcome)} · ${run.hints.steps} moves`);
    // A run that broke says why on its first line: without it the person has nothing to fix.
    if (run.outcome?.error) lines.push(`  Error${run.outcome.stage ? ` (${run.outcome.stage})` : ''}: ${String(run.outcome.error).split('\n')[0]}`);
    const giveUp = find('early-stop')?.detail.giveUp as { reason?: unknown; tried?: unknown } | undefined;
    if (giveUp && run.outcome?.policyStopSource === 'user-gave-up') {
      lines.push(`  Why: "${String(giveUp.reason ?? '')}"`);
      for (const id of Array.isArray(giveUp.tried) ? giveUp.tried : []) {
        const broke = hints.find(hint => hint.kind === 'expectation-broken' && (hint.detail.assumption as { id?: unknown } | undefined)?.id === id);
        const text = (broke?.detail.assumption as { text?: unknown } | undefined)?.text;
        lines.push(`  Rests on ${String(id)}${typeof text === 'string' ? ` "${text}"` : ''}${broke ? ` · broke at step ${broke.steps[0]}${isStuck(broke) ? ` after pressing ${elementText(broke.target)}` : ''}` : ''}`);
      }
    }
    const stretch = find('goal-word-stretch')?.detail.moves, guesses = hints.filter(hint => hint.kind === 'expectation-broken' && isWrongGuess(hint)).length;
    const costs = [typeof stretch === 'number' ? `longest without a goal word: ${stretch} moves` : undefined, hints.some(hint => hint.kind === 'expectation-broken') || guesses ? `wrong guesses about where something is: ${guesses}` : undefined].filter(Boolean);
    if (costs.length) lines.push(`  ${costs.join(' · ')}`);
    // New plans are counted by why, not listed one by one: how often the user had to rethink is the cost.
    const replans = hints.filter(h => PLAN_KINDS.includes(h.kind));
    if (replans.length) lines.push(`  new plans: ${replans.length} (${[...countBy(replans.map(h => planReason(h)))].map(([why, n]) => `${why} ${n}`).join(', ')})`);
    for (const hint of hints.filter(h => h.source === 'run' && !STRUCTURED.includes(h.kind) && !PLAN_KINDS.includes(h.kind))) lines.push(`  ${hint.summary}`);
    lines.push(`  ${run.outDir}`);
  });
  lines.push('');
  // Across the runs, never judged: counts only.
  const endings = result.runs.map(run => run.outcome && run.outcome.reason !== 'error' && run.outcome.reason !== 'trace-persistence-error' && run.outcome.status !== 'aborted' ? runEnding(run.outcome, stopOf(run.outcome)) : undefined);
  const counted = endings.filter((ended): ended is NonNullable<typeof ended> => !!ended), count = (ending: RunEnding) => counted.filter(ended => ended.ending === ending).length;
  const others = (['gave-up', 'mistaken', 'unmeasured'] as const).filter(ending => count(ending)).map(ending => `${ENDING_TEXT[ending]} ${count(ending)}`);
  const broken = result.runs.length - counted.length;
  lines.push(counted.length ? `Could a first-time user do it? reached the goal in ${count('reached')} of ${counted.length} runs${others.length ? ` · ${others.join(' · ')}` : ''}${broken ? ` · ${broken} more ended on an error (not counted)` : ''}`
    : `Could a first-time user do it? not known: ${broken === 1 ? 'the run' : `all ${broken} runs`} ended before the user could try (see the error above)`);
  const reachedSteps = result.runs.filter((run, index) => endings[index]?.ending === 'reached').map(run => run.hints.steps);
  if (reachedSteps.length) lines.push(`Cost of reaching it: ${median(reachedSteps)} moves${reachedSteps.length > 1 ? ` (${Math.min(...reachedSteps)}–${Math.max(...reachedSteps)})` : ''}`);
  const stuck = result.findings.filter(f => f.kind === 'expectation-broken' && f.target).map(f => ({ f, hits: f.occurrences.filter(isStuck) })).filter(item => item.hits.length);
  if (stuck.length) {
    lines.push('', 'Stuck: pressed, and it did not respond as the user expected');
    for (const { f, hits } of stuck) {
      const runs = new Set(hits.map(o => o.runId)).size, gaveUp = new Set(hits.filter(o => o.detail.gaveUpOn === true).map(o => o.runId)).size;
      const expected = (hits[0]!.detail.assumption as { text?: unknown } | undefined)?.text;
      lines.push(`  ${elementText(f.target)} · ${runs} of ${f.totalRuns} runs${gaveUp ? ` · ${gaveUp} give-up${gaveUp > 1 ? 's' : ''} rest on it` : ''}${typeof expected === 'string' ? `\n    expected: ${expected}` : ''}`);
    }
  }
  const groups: [string, HintFinding['source']][] = [['Page', 'page'], ['Model', 'model']];
  // How each run ended is said above; an early stop is not listed again as a finding.
  const rest = result.findings.filter(f => f.kind !== 'expectation-broken' && f.kind !== 'early-stop');
  if (!stuck.length && !rest.length) lines.push('', 'No findings.');
  for (const [title, source] of groups) {
    const findings = rest.filter(f => f.source === source);
    if (!findings.length) continue;
    lines.push('', title);
    for (const f of findings) lines.push(`  ${elementText(f.target)} · ${f.kind} · ${f.runs} of ${f.totalRuns} runs`);
  }
  lines.push('', 'Stuck places are the user model\'s judgement: whether the page or the expectation is wrong is for you to decide.', `Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>`);
  return lines.join('\n') + '\n';
}

/** Whether a Node version (`22.11.0`) meets the package's `>=22.12.0`: the minor version counts, not only the major. */
export function nodeSupported(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

async function doctor(projectDir: string, dependencies: CliDependencies, stdout: (text: string) => void): Promise<number> {
  let failed = false;
  // `warn`: nothing is broken, but something is missing before a run can go (no planner, no task).
  const report = (ok: boolean | undefined | 'warn', label: string, detail: string) => { if (ok === false) failed = true; stdout(`${ok === 'warn' ? 'warn' : ok === undefined ? 'skip' : ok ? 'ok  ' : 'FAIL'}  ${label}: ${detail}\n`); };
  report(nodeSupported(process.versions.node), 'Node', `${process.version} (needs >= 22.12)`);
  const store = new ProjectStore(projectDir);
  let read: Awaited<ReturnType<ProjectStore['read']>> | undefined;
  try {
    read = await store.read();
    const c = read.config;
    report(true, 'Config', `${store.path} (${c.connections.length} connections, ${c.tasks.length} tasks, ${c.profiles.length} run profiles)`);
    if (!c.tasks.length) report('warn', 'Tasks', 'none yet. Add one with `npx rawstep ui`, or run `npx rawstep init` in an empty folder for a demo task');
    for (const profile of c.profiles) {
      const planner = profile.planner, connection = planner && !isFilePlanner(planner) ? c.connections.find(x => x.id === planner.connectionId) : undefined;
      if (!planner) report('warn', `Profile ${profile.name}`, 'no planner yet, so it cannot run. Pick a model in `npx rawstep ui` (Settings > Run profiles)');
      else if (isFilePlanner(planner)) {
        const fixed = !planner.planFile.includes('{task}');
        const exists = fixed ? await stat(resolve(projectDir, planner.planFile)).then(() => true, () => false) : undefined;
        report(exists === false ? false : true, `Profile ${profile.name}`, exists === false ? `its plan file ${planner.planFile} is missing` : `follows the plan file ${planner.planFile} (no model)`);
      } else report(true, `Profile ${profile.name}`, `plans with ${connection?.name ?? planner.connectionId} · ${planner.modelId}`);
    }
  } catch (error) { report(false, 'Config', errorDetails(error)); }
  const executablePath = read?.config.machine.browserExecutablePath || undefined, cdpEndpoint = read?.config.machine.browserEndpoint.trim() || undefined;
  try {
    await (dependencies.launchBrowser ?? (async options => { const session = await createBrowserSession('about:blank', { headless: true, ...options }); await session.close(); }))({ ...(cdpEndpoint ? { cdpEndpoint } : executablePath ? { executablePath } : {}) });
    report(true, 'Browser', cdpEndpoint ? `connected to ${cdpEndpoint}` : executablePath ? `launched ${executablePath}` : 'launched');
  } catch (error) {
    const connect = findRawstepError(error, e => e instanceof BrowserConnectError);
    if (connect) report(false, 'Browser', `${connect.message} The address comes from machine.browserEndpoint in the config.`);
    else report(false, 'Browser', `${errorDetails(error)}. ${cdpEndpoint ? 'Start Chrome with `--remote-debugging-port=9222 --user-data-dir=<separate folder>` and check machine.browserEndpoint in the config.' : 'Install one with `npx playwright install chromium` or set machine.browserExecutablePath in the config.'}`);
  }
  if (read) {
    for (const key of credentialRequirements(read.config)) {
      const label = `Key ${key.label}`;
      if (agentOf(key.connection)) {
        try {
          await (dependencies.checkAgent ?? (connection => discover({ provider: connection.provider as never })))({ provider: key.connection.provider });
          report(true, key.label, 'starts and lists its models (its own sign-in pays for calls)');
        } catch (error) {
          const code = error instanceof ProjectError ? error.code : '';
          report(false, key.label, code === 'agent-missing' ? 'not found on this computer. Install it first' : code === 'agent-signed-out' ? 'needs a sign-in. Sign in from the dashboard connection check' : 'could not be started');
        }
        continue;
      }
      if (!key.env) { report(!key.required, label, key.required ? 'no environment variable is named for it' : 'no API key needed'); continue; }
      const present = !!await store.credential(key.connection);
      report(present || !key.required, label, present ? `${key.env} is set` : key.required ? `${key.env} is missing. Add ${key.env}=... to .env.local or export it` : `${key.env} is not set (optional for this server)`);
    }
    const natives = [...new Set(read.config.profiles.map(p => p.screenReader).filter(b => b !== 'simulation'))];
    if (!natives.length) report(undefined, 'Screen reader', 'only the simulation is configured; no native screen reader to check');
    for (const backend of natives) {
      const atEndpoint = atEndpointOf(read.config.machine, backend);
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
