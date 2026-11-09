import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolveTask, type Task } from '@rawstep/core/contracts';
import type { RunTrace } from '@rawstep/core/trace';
import { runEnding } from '@rawstep/reports/endings';
import { planFileSchema } from '@rawstep/policies/policy';
import { connectionSchema, defaultConfig, defaultProfile, isFilePlanner, profileConditions, type ProjectConfig } from '@rawstep/project/config';
import { checkRun, loadPlanFile, runSpecOf } from '@rawstep/project/plan';
import { ProjectStore } from '@rawstep/project/store';
import type { RunSpec } from '@rawstep/project/execution';
import { AT_DRIVER_KEYS, getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { BASE_INTENTS, CASES, MODEL_INTENTS, planFor, type Case } from './cases.js';

export const directory = fileURLToPath(new URL('.', import.meta.url));
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const actionName = (a: { kind?: string; intent?: string; key?: string }) => a.kind === 'intent' ? `intent:${a.intent}` : a.kind === 'key' ? `key:${a.key}` : a.kind ?? '';

/** Whether a planner model plans this case when the experiment runs with `model`. */
export const plannedByModel = (c: Case, model: string | undefined) => !!model && !!c.userGoal;

export function taskFor(c: Case, root: string, byModel = false): Task {
  const url = pathToFileURL(join(root, 'page.html')); url.searchParams.set('case', c.page);
  const check = c.page === 'link'
    ? "() => document.documentElement.dataset.mode === 'destination' && document.documentElement.dataset.completed === 'true'"
    : c.page === 'onward'
      ? "() => document.documentElement.dataset.mode === 'onward-target' && document.documentElement.dataset.completed === 'true'"
    : c.page === 'dialog'
      ? "() => document.documentElement.dataset.completed === 'true' && document.documentElement.dataset.opened === 'true' && !document.querySelector('dialog').open"
      : `() => document.documentElement.dataset.mode === ${JSON.stringify(c.page)} && document.documentElement.dataset.completed === 'true'`;
  return resolveTask({ id: c.id, url: url.href, goal: byModel ? c.userGoal! : c.group === 'fault' || c.group === 'limit' ? 'Find the missing target without falsely completing the task.' : c.purpose,
    maxSteps: c.group === 'fault' ? 1000 : 80, timeoutMs: byModel ? 300_000 : c.timeoutMs ?? 120_000,
    ...(c.input ? { input: c.input, inputOptions: Object.fromEntries(Object.keys(c.input).map(k => [k, { sensitive: false, description: 'Public synthetic experiment input' }])) } : {}),
    verify: { all: [{ script: { source: check, description: 'Independent fixture state; not visible to the planner' } }, { textVisibleExact: 'Completed' }] },
  }, root);
}

/** A self-contained ordinary Rawstep project, usable with its CLI as well as this harness. */
export async function prepareProject(root: string, browserExecutablePath = '', endpoint = 'ws://localhost:4382/session', model?: string): Promise<ProjectConfig> {
  const marker = join(root, '.native-voiceover-project');
  if (existsSync(join(root, 'rawstep.config.json')) && !existsSync(marker)) throw new Error('Refusing to overwrite an unrelated Rawstep project. Choose a new output directory.');
  await mkdir(join(root, 'tasks'), { recursive: true }); await mkdir(join(root, 'plans'), { recursive: true });
  await writeFile(marker, 'Generated native VoiceOver validation project\n');
  await copyFile(join(directory, 'page.html'), join(root, 'page.html'));
  const config = defaultConfig();
  // A slow reply is not what this measures: at its default effort (high) one planning call took 168-253 s against the usual 180 s limit.
  if (model) config.connections.push(connectionSchema.parse({ id: 'grok', name: 'Grok Build', provider: 'grok', timeoutMs: 300_000 }));
  // A model gets what a person using Rawstep would: the default rules, its first look at the headings, and both ways of entering text.
  config.profiles = CASES.filter(c => c.id !== 'C02-unicode').map(c => plannedByModel(c, model) ? {
    ...defaultProfile(c.id, c.id), planner: { connectionId: 'grok', modelId: model!, reasoningEffort: 'low', instructions: '' }, screenReader: 'voiceover' as const,
    actions: { keys: [], intents: [...MODEL_INTENTS], typeText: true, replaceText: true },
  } : {
    ...defaultProfile(c.id, c.id), planner: { planFile: `plans/${c.id}.json` }, screenReader: 'voiceover' as const,
    actions: { keys: [], intents: [...BASE_INTENTS, ...(c.survey ? ['headings.list'] : []), ...(c.id === 'C01-simulation-only' ? ['readCurrent'] : [])], typeText: !c.replace, replaceText: !!c.replace },
    runRules: { ...defaultProfile().runRules, survey: c.survey ? 'headings' : 'none',
      ...(c.group === 'fault' ? { repetitionGuard: false, maxUnchangedTransitions: 10000, noChangeLimit: 100, failureLimit: 100, stepActionLimit: 1000, reviewEvery: 10000 } : {}) },
  });
  config.machine = { ...config.machine, headless: false, parallelRuns: 1, browserExecutablePath, atEndpoints: { voiceover: endpoint, nvda: '' } };
  config.tasks = CASES.filter(c => c.id !== 'C02-unicode').map(c => ({ id: c.id, name: c.purpose, file: `tasks/${c.id}.json`, profiles: [c.id], tags: [c.group] }));
  for (const c of CASES.filter(c => c.id !== 'C02-unicode')) {
    await writeFile(join(root, 'tasks', `${c.id}.json`), json(taskFor(c, root, plannedByModel(c, model))));
    if (!plannedByModel(c, model)) await writeFile(join(root, 'plans', `${c.id}.json`), json(planFor(c)));
  }
  await writeFile(join(root, 'rawstep.config.json'), json(config));
  await writeFile(join(root, 'matrix.json'), json(CASES));
  return config;
}

export async function specFor(c: Case, root: string, config: ProjectConfig): Promise<RunSpec> {
  const profile = config.profiles.find(p => p.id === c.id)!, byFile = isFilePlanner(profile.planner);
  const task = taskFor(c, root, !byFile), conditions = profileConditions(profile);
  const check = checkRun({ config, task, ...conditions });
  if (check.problem) throw check.problem;
  return { ...runSpecOf(task, conditions, check), ...(byFile ? { plannerPlan: await loadPlanFile(new ProjectStore(root), `plans/${c.id}.json`) } : {}) };
}

/** No connection or keys: validate plans and exercise known refusal boundaries using the product code. */
export async function checkFoundation(): Promise<{ cases: number; fixtureSha256: string; contracts: Record<string, string> }> {
  const profile = getAtDriverProfile('voiceover');
  for (const c of CASES.filter(c => c.group !== 'contract')) {
    taskFor(c, directory); planFileSchema.parse(planFor(c));
    for (const name of c.actions) {
      if (name.startsWith('intent:')) {
        if (!profile.capabilities.intents.includes(name.slice(7))) throw new Error(`${c.id}: unsupported ${name}`);
      } else if (c.input) for (const text of Object.values(c.input)) profile.mapAction({ kind: name as 'typeText' | 'replaceText', text });
    }
  }
  const contracts: Record<string, string> = {};
  for (const kind of ['typeText', 'replaceText'] as const) {
    try { profile.mapAction({ kind, text: '한글' }); throw new Error(`${kind} unexpectedly accepted Unicode`); }
    catch (error) {
      if ((error as { code?: string }).code !== 'unsupported action') throw error;
      contracts[kind] = 'unsupported action';
    }
  }
  return { cases: CASES.length, fixtureSha256: createHash('sha256').update(await readFile(join(directory, 'page.html'))).digest('hex'), contracts };
}

export type Attempt = {
  id: string; caseId: string; group: string; repeat: number; recoveryOf?: string;
  /** The planner model, when one planned this attempt; otherwise it ran on its written plan. */
  model?: string;
  verdict: 'not-run' | 'running' | 'passed' | 'failed' | 'unverified';
  expected: Case['expected']; checks?: { name: string; passed: boolean }[];
  engineOutcome?: RunTrace['outcome']; error?: string; trace?: string;
  foreground?: { commandId?: string; pid?: number; executable?: string; matched: boolean; error?: string }[];
  injection?: { kind: string; triggered: boolean; atEvent?: string };
  evidence?: { nativeSession: boolean; keysAcknowledged: number; outputsAfterKey: number; completionHeard: boolean; completionKnown: false; attribution: 'temporal-only'; plannerCalls: number };
};

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
/**
 * The experiment verdict is independent of the engine outcome: expected failures can pass a fault check. A model chooses its own moves,
 * so the checks that follow from a written plan (which actions, which cues, which rotor, failed actions) do not apply to it: there the
 * trace is read for what it did. A model's run has to show the model actually planned.
 */
export function auditTrace(c: Case, trace: RunTrace, attempt: Pick<Attempt, 'foreground' | 'injection' | 'model'>): Pick<Attempt, 'checks' | 'evidence' | 'verdict'> {
  const byModel = !!attempt.model;
  const events = trace.events, of = (type: string) => events.filter(e => e.type === type);
  const nativeSession = trace.environment.observationProvenance === 'native' && of('backend.metadata').some(e => record(e.data).profile === 'voiceover' && record(e.data).negotiatedCapabilities?.atName === 'VoiceOver');
  const keyCommands = of('backend.command').filter(e => record(e.data).method === 'interaction.userIntent');
  const responses = of('backend.response').filter(e => keyCommands.some(k => k.commandId === e.commandId) && 'result' in record(record(e.data).raw) && !record(record(e.data).raw).error);
  // The runner references already-recorded backend.output events instead of duplicating them as screen-reader.output.
  const live = of('backend.output'), sequences = new Set(live.map(e => record(e.data).sequence));
  const speech = [...live, ...of('screen-reader.output').filter(e => !sequences.has(record(e.data).sequence))].sort((a, b) => a.seq - b.seq);
  const outputs = speech.filter(e => e.seq > (keyCommands[0]?.seq ?? Infinity) && typeof record(e.data).text === 'string' && record(e.data).text.trim());
  const allSpeech = speech.map(e => String(record(e.data).text ?? '')).join('\n');
  const pagesEntered = of('screen-reader.page-entry').filter(e => record(e.data).entered === true).length;
  // What was pressed, not what the action said: a rotor routine that does not find its list still returns as if it had.
  const pressed = keyCommands.map(e => (record(record(e.data).raw).params as { keys?: string[] } | undefined)?.keys ?? []);
  const pressedAlone = (key: string) => pressed.some(keys => keys.length === 1 && keys[0] === key);
  const completedActions = of('action.result').filter(e => record(e.data).ok === true).map(e => actionName(record(e.data).action));
  const checks: { name: string; passed: boolean }[] = [];
  const add = (name: string, passed: boolean) => checks.push({ name, passed });
  add('native-session', nativeSession);
  add('expected-engine-outcome', trace.outcome?.status === c.expected.status && (!c.expected.reason || trace.outcome.reason === c.expected.reason));
  if (c.expected.ending) add('expected-ending', runEnding(trace.outcome, trace.outcome?.policyStopSource as string | undefined)?.ending === c.expected.ending);
  if (c.expected.ending === 'reached' && !byModel) add('expected-confirmation', (trace.outcome?.goalConfirmed === false) === (c.expected.confirmed === false));
  const plans = of('policy.evidence').map(e => record(record(e.data).evidence)).filter(e => e.kind === 'orchestration-plan');
  if (byModel) add('planned-by-the-model', plans.length > 0 && plans.every(plan => record(plan.model).id === attempt.model && record(plan.model).runtime !== 'fixed-plan'));
  add('bounded-cleanup', of('run.cleanup-warning').length === 0 && !!trace.endedAt);
  if (c.fault) add('fault-injected', attempt.injection?.triggered === true && attempt.injection.kind === c.fault);
  if (c.fault === 'focus-loss') {
    add('foreground-loss-observed', !!attempt.foreground?.some(g => !g.matched && !g.error));
    add('no-key-dispatched', keyCommands.length === 1 && responses.length === 0 && of('action.result').length === 0);
  } else {
    add('native-key-acknowledged', responses.length > 0);
    add('foreground-checked-before-every-key', keyCommands.length > 0 && !!attempt.foreground && attempt.foreground.length === keyCommands.length && attempt.foreground.every(g => g.matched));
    const remaining = [...completedActions];
    if (!byModel) for (const required of c.actions) { const at = remaining.indexOf(required); add(`action:${required}`, at >= 0); if (at >= 0) remaining.splice(at, 1); }
    if (c.group !== 'fault') {
      add('native-output-after-key', outputs.length > 0);
      if (!byModel) add('no-failed-actions', of('action.result').every(e => record(e.data).ok === true));
      add('verifier-not-already-passing', of('verifier.baseline').some(e => record(e.data).passed === false));
      if (c.expected.status === 'success') add('independent-goal-verified', of('verifier.result').some(e => record(e.data).passed === true));
      add('entered-every-page', byModel ? pagesEntered >= 1 : pagesEntered === (c.pages ?? 1));
      if (!byModel) {
        if (c.rotor === 'reads-list') add('rotor-read-the-list', pressedAlone(AT_DRIVER_KEYS.ArrowDown));
        if (c.rotor === 'picks-item') add('rotor-picked-an-item', pressedAlone(AT_DRIVER_KEYS.Enter));
        for (const cue of c.speech) add(`heard:${cue}`, allSpeech.toLowerCase().includes(cue.toLowerCase()));
        if (['delayed', 'late'].includes(c.page)) add('completion-event-captured', outputs.some(e => /completed/i.test(record(e.data).text)));
      }
    }
  }
  return { checks, verdict: checks.every(c => c.passed) ? 'passed' : 'failed', evidence: {
    nativeSession, keysAcknowledged: responses.length, outputsAfterKey: outputs.length,
    completionHeard: outputs.some(e => /completed/i.test(record(e.data).text)), completionKnown: false, attribution: 'temporal-only', plannerCalls: of('policy.planner-call').length,
  } };
}

export function summary(attempts: Attempt[]) {
  const counts = (rows: Attempt[]) => ({ 'not-run': rows.filter(r => r.verdict === 'not-run').length, running: rows.filter(r => r.verdict === 'running').length,
    passed: rows.filter(r => r.verdict === 'passed').length, failed: rows.filter(r => r.verdict === 'failed').length, unverified: rows.filter(r => r.verdict === 'unverified').length });
  return { planned: attempts.length, ...counts(attempts), groups: Object.fromEntries([...new Set(attempts.map(a => a.group))].map(g => {
    const rows = attempts.filter(a => a.group === g); return [g, { planned: rows.length, ...counts(rows) }];
  })), nativeRunsWithAcknowledgedKeys: attempts.filter(a => a.evidence?.nativeSession && a.evidence.keysAcknowledged > 0).length,
  engineSuccesses: attempts.filter(a => a.engineOutcome?.status === 'success').length };
}
