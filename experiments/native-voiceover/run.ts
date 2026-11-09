import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Socket } from 'node:net';
import { homedir, hostname } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { readTrace, type TraceEvent } from '@rawstep/core/trace';
import { executeRun, lockBrowserProfile } from '@rawstep/project/execution';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { CASES, type Case } from './cases.js';
import { auditTrace, checkFoundation, directory, json, plannedByModel, prepareProject, specFor, summary, type Attempt } from './suite.js';

const repository = resolve(directory, '../..');
const shell = (file: string, args: string[], timeout = 3000) => execFileSync(file, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const optional = (file: string, args: string[]) => { try { return shell(file, args); } catch { return 'unknown'; } };

/** One isolated raw TCP relay: the disconnect probe never stops the shared AT Driver service. */
export async function driverRelay(target: string) {
  const url = new URL(target), sockets = new Set<Socket>();
  const server = createServer(client => {
    const remote = createConnection({ host: url.hostname, port: Number(url.port) });
    for (const socket of [client, remote]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); remote.destroy(); }); }
    client.pipe(remote).pipe(client);
  });
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No relay port');
  const disconnect = () => { for (const socket of sockets) socket.destroy(); };
  return { endpoint: `ws://127.0.0.1:${address.port}/session`, disconnect,
    close: async () => { disconnect(); await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes())); } };
}

function frontmost(expected: string): NonNullable<Attempt['foreground']>[number] {
  try {
    const pid = Number(shell('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true']));
    const executable = shell('/bin/ps', ['-p', String(pid), '-o', 'comm=']);
    return { pid, executable, matched: realpathSync(executable) === realpathSync(expected) };
  } catch (error) { return { matched: false, error: error instanceof Error ? error.message : String(error) }; }
}

async function environment(browser: string) {
  if (process.platform !== 'darwin') throw new Error('Native validation must run inside the macOS Tart VM.');
  const hardware = shell('/usr/sbin/sysctl', ['-n', 'hw.model']);
  if (!hardware.startsWith('VirtualMac')) throw new Error(`Refusing to press native keys on a host machine (${hardware}). Run in the Tart VM.`);
  if (!existsSync(browser)) throw new Error('Chromium is missing. Run pnpm exec playwright install chromium.');
  if (!optional('/usr/bin/pgrep', ['-x', 'VoiceOver']).match(/^\d/)) throw new Error('VoiceOver is not running.');
  const prefs = join(homedir(), 'Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences/com.apple.VoiceOver4/default.plist');
  let voiceoverPreferences: unknown = 'unknown';
  try {
    const values = JSON.parse(shell('/usr/bin/plutil', ['-convert', 'json', '-o', '-', prefs]));
    voiceoverPreferences = Object.fromEntries(Object.entries(values).filter(([key]) => /voiceidentifier|quicknav|keyboard.*track|typing.*echo/i.test(key)));
  } catch { /* Saved settings do not establish runtime settings; leave them unknown. */ }
  return { collectedAt: new Date().toISOString(), hostname: hostname(), hardware, macos: shell('/usr/bin/sw_vers', []), node: process.version,
    browserExecutable: realpathSync(browser), keyboardSource: optional('/usr/bin/defaults', ['read', 'com.apple.HIToolbox', 'AppleCurrentKeyboardLayoutInputSourceID']), voiceoverPreferences,
    settingsVerifiedByHarness: false, speechCompletionKnown: false, audibleDeliveryMeasured: false,
    assumptions: ['English US speech and US keyboard layout', 'Control+Option modifier and default command bindings', 'Quick Nav off; keyboard and VoiceOver cursor tracking enabled'],
  };
}

async function fingerprints() {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.rawstep'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|js|json|html|mjs)$/.test(entry.name)) files.push(path);
    }
  };
  for (const name of ['core', 'policies', 'browser', 'screenreaders', 'project']) {
    await walk(join(repository, 'packages', name, 'src'));
    await walk(join(repository, 'packages', name, 'dist'));
  }
  await walk(directory);
  for (const name of ['package.json', 'pnpm-lock.yaml']) files.push(join(repository, name));
  const hashes: Record<string, string> = {};
  for (const path of files.sort()) hashes[relative(repository, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  const snapshotText = await readFile(join(repository, 'SOURCE-SNAPSHOT.json'), 'utf8').catch(() => undefined);
  return { gitHead: optional('git', ['-C', repository, 'rev-parse', 'HEAD']),
    ...(snapshotText ? { transferredSource: { gitHead: JSON.parse(snapshotText).gitHead, manifestSha256: createHash('sha256').update(snapshotText).digest('hex') } } : {}), files: hashes,
    sha256: createHash('sha256').update(json(hashes)).digest('hex') };
}

export function plannedAttempts(cases: readonly Case[], repeats: number, model?: string): Attempt[] {
  const rows: Attempt[] = [];
  for (const c of cases) for (let repeat = 1; repeat <= (c.group === 'contract' ? 1 : repeats); repeat++) {
    const id = `${c.id}-${repeat}`;
    rows.push({ id, caseId: c.id, group: c.group, repeat, ...(plannedByModel(c, model) ? { model } : {}), expected: c.expected, verdict: 'not-run' });
    if (c.group === 'fault') rows.push({ id: `${id}-recovery`, caseId: 'S01-button', group: 'recovery', repeat, recoveryOf: id, expected: CASES[0]!.expected, verdict: 'not-run' });
  }
  return rows;
}

/** Records before execution, atomically after every attempt; interrupted and untouched rows stay in the denominator. */
export async function runExperiment(options: { out: string; phase: string; repeats: number; only?: string; model?: string }) {
  const chosen = options.only ? CASES.filter(c => c.id === options.only) : CASES.filter(c => options.phase === 'all' || c.group === options.phase);
  // With a model, only what it can plan: a fault or a refusal needs its written plan, and those already ran on one.
  const selected = options.model ? chosen.filter(c => plannedByModel(c, options.model)) : chosen;
  if (!selected.length) throw new Error('No cases selected. Use list to see case IDs.');
  const attempts = plannedAttempts(selected, options.repeats, options.model), root = resolve(options.out);
  await mkdir(root, { recursive: true });
  if (existsSync(join(root, 'results.json'))) throw new Error('This output already has results; choose a new --out.');
  const browser = chromium.executablePath(), source = await fingerprints();
  const result = { schemaVersion: 1, kind: 'native-engine-validation', planner: options.model ?? 'fixed-plan', ...(options.model ? { grokCli: optional('grok', ['--version']) } : {}), startedAt: new Date().toISOString(), status: 'preparing',
    environment: undefined as unknown, source, attempts, summary: summary(attempts), error: undefined as string | undefined };
  const save = async () => {
    result.summary = summary(attempts);
    await writeFile(join(root, 'results.json.tmp'), json(result)); await rename(join(root, 'results.json.tmp'), join(root, 'results.json'));
    const table = ['# Native VoiceOver engine validation', '', `Planner: ${result.planner}. State: ${result.status}. Passed: ${result.summary.passed}/${result.summary.planned} planned checks.`,
      '', 'An expected fault passing is not a successful user task. Unrun and unverified rows remain in the denominator.', '',
      '| Attempt | Group | Experiment verdict | Engine outcome | Details |', '|---|---|---|---|---|',
      ...attempts.map(a => `| ${a.id} | ${a.group} | ${a.verdict} | ${a.engineOutcome?.status ?? 'not-started'} | ${(a.error ?? a.checks?.filter(c => !c.passed).map(c => c.name).join(', ') ?? '').replaceAll('|', '/').replaceAll('\n', ' ')} |`),
      '', 'Read results.json and each attempt/trace.json for commands, responses, literal output, observation windows and independent verification. Settings verification, speech completion and audible delivery are not inferred.', ''];
    await writeFile(join(root, 'results.md'), table.join('\n'));
  };
  await save();
  let release: (() => Promise<void>) | undefined;
  const stop = new AbortController();
  let current: AbortController | undefined;
  const interrupt = () => { stop.abort(); current?.abort('SIGINT'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    release = await lockBrowserProfile(join(homedir(), '.rawstep', 'native-voiceover-desktop'));
    result.environment = await environment(browser);
    const config = await prepareProject(join(root, 'project'), browser, undefined, options.model);
    await checkFoundation();
    result.status = 'running'; await save();
    for (const attempt of attempts) {
      if (stop.signal.aborted) break;
      const c = CASES.find(c => c.id === attempt.caseId)!;
      attempt.verdict = 'running'; current = new AbortController();
      attempt.foreground = [];
      if (c.fault) attempt.injection = { kind: c.fault, triggered: false };
      await save();
      const outDir = join(root, 'attempts', attempt.id);
      let relay: Awaited<ReturnType<typeof driverRelay>> | undefined;
      try {
        if (c.id === 'C02-unicode') {
          // The actual profile maps the complete text before it can dispatch even a destructive replace prefix.
          const refused: string[] = [];
          for (const kind of ['typeText', 'replaceText'] as const) try { getAtDriverProfile('voiceover').mapAction({ kind, text: '한글' }); }
          catch (error) { if ((error as { code?: string }).code === 'unsupported action') refused.push(kind); else throw error; }
          attempt.checks = [{ name: 'both-input-actions-refused-offline', passed: refused.length === 2 }];
          attempt.verdict = refused.length === 2 ? 'passed' : 'failed';
        } else {
          const spec = await specFor(c, join(root, 'project'), config);
          if (c.expected.errorCode) throw new Error('An expected setup refusal did not occur.');
          if (c.fault === 'disconnect') {
            relay = await driverRelay(spec.settings.machine.atEndpoints.voiceover);
            spec.settings.machine.atEndpoints.voiceover = relay.endpoint;
          }
          const onEvent = (event: TraceEvent) => {
            try {
              const data = event.data as { method?: string; ok?: boolean };
              if (event.type === 'backend.command' && data.method === 'interaction.userIntent') {
                if (c.fault === 'focus-loss' && !attempt.injection!.triggered) {
                  shell('/usr/bin/osascript', ['-e', 'tell application "Finder" to activate']);
                  attempt.injection = { kind: c.fault, triggered: true, atEvent: event.id };
                }
                let check = frontmost(browser);
                // Activation is asynchronous; the focus-loss probe waits only for the injected change, never repairs focus.
                if (c.fault === 'focus-loss') for (let n = 0; check.matched && n < 5; n++) check = frontmost(browser);
                attempt.foreground!.push({ ...check, commandId: event.commandId });
                if (!check.matched || c.fault === 'focus-loss') current!.abort('foreground-lost');
              }
              if (event.type === 'action.result' && data.ok && c.fault && !attempt.injection!.triggered) {
                attempt.injection = { kind: c.fault, triggered: true, atEvent: event.id };
                if (c.fault === 'cancel') current!.abort('requested');
                if (c.fault === 'disconnect') relay!.disconnect();
              }
            } catch (error) { attempt.error = error instanceof Error ? error.message : String(error); current!.abort('guard-error'); }
          };
          await executeRun(spec, { outDir, signal: current.signal, onEvent });
          const trace = await readTrace(outDir);
          attempt.engineOutcome = trace.outcome; attempt.trace = relative(root, join(outDir, 'trace.json'));
          Object.assign(attempt, auditTrace(c, trace, attempt));
          if (attempt.error) attempt.verdict = 'unverified';
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (c.expected.errorCode && c.expected.errorCode === code) {
          attempt.verdict = 'passed'; attempt.checks = [{ name: 'expected-preflight-refusal', passed: true }];
        } else { attempt.verdict = 'unverified'; attempt.error = error instanceof Error ? error.message : String(error); }
      } finally { await relay?.close(); }
      await save();
      console.log(`${attempt.verdict.padEnd(10)} ${attempt.id} (${attempt.engineOutcome?.status ?? 'no native task'})`);
      if (stop.signal.aborted) break;
      // A broken smoke/recovery or an unexpected foreground loss makes further native dispatch unsafe/uninformative. A model missing a goal is a result, not a broken run.
      if (((c.group === 'smoke' && !attempt.model) || attempt.recoveryOf || attempt.foreground?.some(g => !g.matched)) && attempt.verdict !== 'passed') {
        result.error = `Stopped after ${attempt.id}; remaining planned attempts were not run.`; break;
      }
    }
    result.status = stop.signal.aborted ? 'interrupted' : attempts.some(a => a.verdict === 'not-run') ? 'stopped' : 'complete';
  } catch (error) { result.status = 'blocked'; result.error = error instanceof Error ? error.message : String(error); }
  finally {
    for (const attempt of attempts) if (attempt.verdict === 'running') { attempt.verdict = 'unverified'; attempt.error ??= 'Interrupted before the attempt was finalized.'; }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await release?.(); await save();
  }
  console.log(`Results: ${join(root, 'results.md')}`);
  return result;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { phase: { type: 'string', default: 'all' }, repeats: { type: 'string', default: '3' }, out: { type: 'string' }, only: { type: 'string' }, planner: { type: 'string', default: 'fixed' }, model: { type: 'string', default: 'grok-4.7' } } });
  const command = positionals[0] ?? 'list';
  if (positionals.length > 1 || !['list', 'check', 'prepare', 'run'].includes(command)) throw new Error('Use list, check, prepare, or run [--phase smoke|workflow|limit|fault|contract|all] [--repeats 3] [--only ID] [--out PATH] [--planner fixed|grok] [--model ID].');
  if (!['fixed', 'grok'].includes(values.planner!)) throw new Error('--planner must be fixed or grok.');
  const model = values.planner === 'grok' ? values.model! : undefined;
  if (command === 'list') { console.log(CASES.map(c => `${c.id.padEnd(23)} ${c.group.padEnd(9)} ${c.purpose}`).join('\n')); return; }
  if (command === 'check' || command === 'prepare') {
    const checked = await checkFoundation();
    const out = resolve(values.out ?? join(repository, 'artifacts/native-voiceover/prepared'));
    await prepareProject(out, chromium.executablePath(), undefined, model);
    // Exercise the product's configuration and capability refusal, without connecting to the driver.
    const c = CASES.find(c => c.id === 'C01-simulation-only')!;
    const config = await new (await import('@rawstep/project/store')).ProjectStore(out).read();
    try { await specFor(c, out, config.config); throw new Error('Simulation-only intent was accepted'); }
    catch (error) { if ((error as { code?: string }).code !== 'unsupported-action') throw error; }
    console.log(json({ ...checked, sourceSha256: (await fingerprints()).sha256, preparedProject: out, nativeRunsPerformed: 0 })); return;
  }
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeats must be an integer from 1 to 10.');
  if (!['smoke', 'workflow', 'limit', 'fault', 'contract', 'all'].includes(values.phase!)) throw new Error('Unknown phase');
  if (values.only && !CASES.some(c => c.id === values.only)) throw new Error('Unknown --only case ID');
  const out = values.out ?? join(repository, 'artifacts/native-voiceover', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const result = await runExperiment({ out, repeats, phase: values.phase!, ...(values.only ? { only: values.only } : {}), ...(model ? { model } : {}) });
  if (result.status !== 'complete' || result.attempts.some(a => a.verdict !== 'passed')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
