import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { resolveTask, type Task } from '@rawstep/core/contracts';
import { readTrace, type RunOutcome, type TraceEvent } from '@rawstep/core/trace';
import { aggregateHints, extractHints, HINTS_SCHEMA_VERSION, type HintFinding, type HintReport } from '@rawstep/reports/hints';
import { buildBatchSummary, type BatchSummary } from '@rawstep/reports/compare';
import { findByIdOrName, modelKeyRequired, profileConditions, firstProfile, type ManagedTask, type Profile, type ProjectConfig, type RunRules } from './config.js';
import { ProjectError } from './errors.js';
import { requireKey } from './finalize.js';
import { ProjectStore } from './store.js';
import { assertRunnable, checkRun } from './plan.js';
import type { RunExecutor } from './execution.js';
import { BatchQueue, type Executor, type LooseTask, type RunRecord } from './batch.js';

export { compareRepeats, finalizeRun, llmAnalyzer, projectAnalyzer, requireKey, type FinalizeOptions, type FinalizeResult } from './finalize.js';

export type RunTaskOptions = {
  /** The directory holding rawstep.config.json. Defaults to the current directory. */
  projectDir?: string;
  /** The run profile by id or name; defaults to the task's first usual profile (`tasks[].profiles`), then the project's first. */
  profile?: string;
  /** Run rules for these runs only, over the profile's. */
  runRules?: Partial<RunRules>;
  /** How many times to run each task under each profile (default 1). The repeats are compared with each other. */
  repeat?: number;
  /** How many runs go at once (1 to 8); defaults to the project's `machine.parallelRuns`. */
  parallel?: number;
  /** What this batch of runs is for ("made Add to cart a button"), shown with it in the dashboard. */
  note?: string;
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};
/** One run of a batch: which task under which profile, where its files are, how it ended and its hints. */
export type BatchRun = { runId: string; taskId: string; taskName: string; profileId: string; profileName: string; outDir: string; outcome: RunOutcome | undefined; hints: HintReport };
/** The batch the runs were saved as, in `.rawstep/experiments/<id>/`; the dashboard lists it with its own. */
export type BatchRef = { id: string; dir: string };
export type RunTaskResult = {
  batch: BatchRef;
  /** The batch summed up per task and profile, also saved as summary.json in the batch folder (a baseline for `rawstep compare`). */
  summary: BatchSummary;
  /** The conditions the runs were made with, as recorded in each trace. */
  conditions: Record<string, unknown>;
  /** Things worth knowing that did not stop the runs (no analysis key, an analysis model that is not an LLM). */
  warnings: string[];
  runs: BatchRun[];
  /** Hints gathered across all runs by kind and page element. */
  findings: HintFinding[];
};
export type RunSuiteOptions = Omit<RunTaskOptions, 'profile'> & {
  /** Tasks by id or file path; with `tags`, the tasks that have any of them are added. Neither runs every registered task. */
  tasks?: string[];
  tags?: string[];
  /** Run profiles by id or name for every task; without them each task runs with its usual profiles (`tasks[].profiles`), else the project's first. */
  profiles?: string[];
};
/** The runs of one task under one profile, with the hints gathered across them. */
export type SuiteGroup = { taskId: string; taskName: string; profileId: string; profileName: string; runs: BatchRun[]; findings: HintFinding[] };
export type RunSuiteResult = { batch: BatchRef; summary: BatchSummary; warnings: string[]; runs: BatchRun[]; groups: SuiteGroup[] };
const MAX_REPEAT = 100;

/**
 * A task id from rawstep.config.json, or a path to a task JSON file (relative paths resolve from the project directory). A file that
 * is not registered runs as it is, with its relative URLs read from its own folder, and is kept in the batch under its file name.
 */
async function loadTask(store: ProjectStore, config: ProjectConfig, reference: string, projectDir: string): Promise<{ entry: ManagedTask; task: Task; loose: boolean }> {
  const path = resolve(projectDir, reference);
  const entry = config.tasks.find(t => t.id === reference) ?? config.tasks.find(t => resolve(projectDir, t.file) === path);
  if (entry) return { entry, task: await store.task(entry.file), loose: false };
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const known = config.tasks.map(t => t.id).join(', ');
    throw new ProjectError('task-not-found', `"${reference}" is not a task id in rawstep.config.json and there is no task file at ${path}.${known ? ` Known tasks: ${known}.` : ''}`, 404);
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch (e) { throw new ProjectError('invalid-task', `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  const task = resolveTask(json, dirname(path)), name = basename(path).replace(/\.json$/i, '');
  const looseId = 'file-' + (name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'task');
  return { entry: { id: looseId, name, file: relative(projectDir, path) }, task, loose: true };
}

/** The profiles a task usually runs with, in its order; without any, the project's first. */
function usualProfiles(config: ProjectConfig, entry: ManagedTask): Profile[] {
  const usual = (entry.profiles ?? []).map(id => config.profiles.find(p => p.id === id)).filter((p): p is Profile => !!p);
  return usual.length ? usual : [firstProfile(config)];
}

function pick<T extends { id: string; name: string }>(kind: string, list: readonly T[], reference: string): T {
  const found = findByIdOrName(list, reference);
  if (!found) throw new ProjectError(`${kind}-not-found`, `No ${kind} "${reference}" in rawstep.config.json.${list.length ? ` Available: ${list.map(i => `${i.name} (${i.id})`).join(', ')}.` : ''}`, 404);
  return found;
}

/**
 * Runs a task from the project in `projectDir` and reports where the runs got slow or took detours. `task` is a task id
 * from rawstep.config.json or a path to a task JSON file; a file that is not registered runs with the project's first profile.
 * Reaching the goal is one signal in the hints, not a verdict, so a run that fails its goal still resolves.
 * It rejects on setup problems (no config, no usable model, a missing key) and on cancellation. The runs are saved as one batch,
 * which the dashboard lists.
 *
 * `internals.execute` replaces the real browser and model run; it exists for tests.
 */
export async function runTask(task: string, options: RunTaskOptions = {}, internals: { execute?: RunExecutor } = {}): Promise<RunTaskResult> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const store = new ProjectStore(projectDir), { config } = await store.read();
  const loaded = await loadTask(store, config, task, projectDir);
  const profile = options.profile !== undefined ? pick('profile', config.profiles, options.profile) : usualProfiles(config, loaded.entry)[0]!;
  const result = await runBatch(store, config, [loaded], { all: [profile] }, options, internals);
  return { batch: result.batch, summary: result.summary, conditions: result.conditions, warnings: result.warnings, runs: result.runs, findings: aggregateHints(result.runs.map(r => r.hints)) };
}

/**
 * Runs several tasks (picked by id, path or tag, or all of the project's) under one or more profiles as one batch, `parallel` runs at
 * a time, and gathers each task's runs under each profile. Like `runTask`, it rejects only on setup problems and cancellation.
 */
export async function runSuite(options: RunSuiteOptions = {}, internals: { execute?: RunExecutor } = {}): Promise<RunSuiteResult> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const store = new ProjectStore(projectDir), { config } = await store.read();
  const tags = options.tags ?? [];
  const tagged = config.tasks.filter(t => t.tags?.some(tag => tags.includes(tag))).map(t => t.id);
  if (tags.length && !tagged.length) {
    const known = [...new Set(config.tasks.flatMap(t => t.tags ?? []))];
    throw new ProjectError('no-tasks', `No task has the tag${tags.length > 1 ? 's' : ''} ${tags.join(', ')}.${known.length ? ` Tags in this project: ${known.join(', ')}.` : ' No task has a tag yet.'}`, 404);
  }
  const references = [...new Set([...options.tasks ?? [], ...tagged])];
  if (!references.length && !tags.length) references.push(...config.tasks.map(t => t.id));
  if (!references.length) throw new ProjectError('no-tasks', 'The project has no tasks to run.', 404);
  const tasks = [];
  for (const reference of references) tasks.push(await loadTask(store, config, reference, projectDir));
  const chosen = options.profiles?.length ? options.profiles.map(p => pick('profile', config.profiles, p)) : undefined;
  const { batch, summary, warnings, runs } = await runBatch(store, config, tasks, chosen ? { all: chosen } : { byTask: Object.fromEntries(tasks.map(t => [t.entry.id, usualProfiles(config, t.entry)])) }, options, internals);
  const groups: SuiteGroup[] = [];
  for (const run of runs) {
    let group = groups.find(g => g.taskId === run.taskId && g.profileId === run.profileId);
    if (!group) groups.push(group = { taskId: run.taskId, taskName: run.taskName, profileId: run.profileId, profileName: run.profileName, runs: [], findings: [] });
    group.runs.push(run);
  }
  for (const group of groups) group.findings = aggregateHints(group.runs.map(r => r.hints));
  return { batch, summary, warnings, runs, groups };
}

/**
 * Checks every task under every profile as a run would (a missing key or an unusable profile stops it here, before anything runs),
 * then runs them as one batch on the project's queue and reads back each run's outcome and hints.
 */
async function runBatch(store: ProjectStore, config: ProjectConfig, tasks: { entry: ManagedTask; task: Task; loose: boolean }[], choice: { all: Profile[] } | { byTask: Record<string, Profile[]> }, options: RunTaskOptions, internals: { execute?: RunExecutor }) {
  const profilesOf = (taskId: string) => 'all' in choice ? choice.all : choice.byTask[taskId]!;
  const profiles = [...new Map(tasks.flatMap(t => profilesOf(t.entry.id)).map(p => [p.id, p])).values()];
  const repeat = options.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) throw new ProjectError('invalid-repeat', `The repeat count must be an integer from 1 to ${MAX_REPEAT}.`);
  if (options.parallel !== undefined && (!Number.isInteger(options.parallel) || options.parallel < 1 || options.parallel > 8)) throw new ProjectError('invalid-parallel', 'The number of runs at once must be an integer from 1 to 8.');
  const warnings = new Set<string>();
  for (const { entry, task, loose } of tasks) for (const profile of profilesOf(entry.id)) {
    const check = assertRunnable(checkRun({ config, task, ...(loose ? {} : { taskEntry: entry }), runRules: options.runRules, ...profileConditions(profile) }));
    for (const warning of check.warnings) warnings.add(warning);
    if (check.plannerModel) await requireKey(store, check.plannerModel);
    // Analysis never blocks a run: without its key the runs get the rule-based analysis only.
    if (check.analysisModel && modelKeyRequired(check.analysisModel) && !await store.credential(check.analysisModel)) warnings.add(`The key for the analysis model "${check.analysisModel.name}" is not set; the runs get the rule-based analysis only.`);
  }
  const signal = options.signal ?? new AbortController().signal;
  const cancelled = () => new ProjectError('cancelled', 'The run was cancelled. Traces written so far are kept.');
  if (signal.aborted) throw cancelled();
  const execute = internals.execute;
  const executor: Executor | undefined = execute && ((run, task, outDir, runSignal, onEvent, local = {}) => execute({ ...run.snapshot.spec, task }, { outDir, signal: runSignal, ...local, ...(onEvent ? { onEvent } : {}) }));
  const queue = new BatchQueue(store, { via: 'cli', ...(options.parallel ? { parallel: options.parallel } : {}), ...(executor ? { executor } : {}), ...(options.onEvent ? { onRunEvent: (_batch, _run, event) => options.onEvent!(event) } : {}) });
  const loose: Record<string, LooseTask> = Object.fromEntries(tasks.filter(t => t.loose).map(({ entry, task }) => [entry.id, { entry, task }]));
  const experiment = await queue.create({ taskIds: tasks.map(t => t.entry.id), profileIds: profiles.map(p => p.id), repeats: repeat,
    ...('byTask' in choice ? { profilesByTask: Object.fromEntries(tasks.map(t => [t.entry.id, profilesOf(t.entry.id).map(p => p.id)])) } : {}), ...(options.runRules ? { runRules: options.runRules } : {}), ...(options.note ? { note: options.note } : {}) }, loose);
  // A cancel stops what is waiting and the runs going; what they did is kept and finished (hints, report) before the cancel is reported.
  const stop = () => void queue.cancel(experiment.id).catch(() => {});
  signal.addEventListener('abort', stop, { once: true });
  try { await queue.whenDone(experiment.id); } finally { signal.removeEventListener('abort', stop); await queue.close(); }
  if (signal.aborted) throw cancelled();
  const runs: BatchRun[] = [];
  for (const record of experiment.runs) runs.push(await readRun(queue, experiment.id, record, profiles));
  const dir = await store.file('.rawstep/experiments/' + experiment.id);
  // The queue wrote the batch's summary.json when its last run ended; the result carries the same, read from these runs.
  const summary = buildBatchSummary({ id: experiment.id, createdAt: experiment.createdAt, ...(experiment.request.note ? { note: experiment.request.note } : {}) }, runs);
  return { batch: { id: experiment.id, dir }, summary, conditions: experiment.runs[0]?.snapshot.spec.conditions ?? {}, warnings: [...warnings], runs };
}
/** A finished run as the batch saved it; one that never got going has no trace, so its outcome is the error it stopped on. */
async function readRun(queue: BatchQueue, batchId: string, record: RunRecord, profiles: Profile[]): Promise<BatchRun> {
  const outDir = await queue.runDir(batchId, record.id), trace = await readTrace(outDir).catch(() => undefined);
  const saved = await readFile(outDir + '/hints.json', 'utf8').then(text => JSON.parse(text) as HintReport, () => undefined);
  const hints = saved ?? (trace ? extractHints(trace) : { schemaVersion: HINTS_SCHEMA_VERSION, runId: record.id, taskId: record.taskId, steps: 0, durationMs: null, goalReached: false, hints: [], limitations: [] });
  const outcome = trace?.outcome ?? (record.state === 'cancelled' ? { status: 'aborted', reason: 'aborted' } : { status: 'failure', reason: 'error', stage: 'setup', error: record.errorDetail?.message ?? 'The run did not start.' }) as RunOutcome;
  return { runId: trace?.runId ?? record.id, taskId: record.taskId, taskName: record.snapshot.taskName, profileId: record.profileId, profileName: profiles.find(p => p.id === record.profileId)?.name ?? record.profileId, outDir, outcome, hints };
}
