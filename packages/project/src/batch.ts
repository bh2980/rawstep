import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { z } from 'zod';
import { createRedactor, readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import { usesKeptProfile, type Task } from '@rawstep/core/contracts';
import { AT_DRIVER_COMMAND_ENV, modelKeyRequired, profileConditions, type ManagedTask, type Model, type ProjectConfig } from './config.js';
import { ProjectError } from './errors.js';
import { compareRepeats, finalizeRun, llmAnalyzer } from './finalize.js';
import { assertRunnable, checkRun, loadPlanFile, resolvePermissions, runSpecOf, type RunConditions } from './plan.js';
import { executeRun } from './execution.js';
import { planSchema, RUN_ERROR, type BatchMessage, type BatchOwner, type Combination, type Experiment, type RetryPreview, type RunRecord } from './experiment.js';

export * from './experiment.js';
import { ProjectStore, atomicJson } from './store.js';

/** Where batches live, relative to the project. */
export const BATCHES_DIR = '.rawstep/experiments';

/** Runs one run record; the default executes it for real, tests substitute their own. */
export type Executor = (run: RunRecord, task: Task, outDir: string, signal: AbortSignal, onEvent?: (event: TraceEvent) => void, local?: { atDriverCommand?: string | undefined; browserProfileDir?: string | undefined; plannerApiKey?: string | undefined }) => Promise<RunTrace>;
const executeRecord: Executor = (run, task, outDir, signal, onEvent, local = {}) =>
  executeRun({ ...run.snapshot.spec, task }, { outDir, signal, ...local, ...(onEvent ? { onEvent } : {}) });
/**
 * What a batch keeps and serves of a recorded outcome: the result and how far the run got. A failed run's outcome also holds
 * the raw error text, which can quote a provider's reply, so nothing else is passed on.
 */
export function publicOutcome(outcome: unknown): RunRecord['outcome'] {
  if (!outcome || typeof outcome !== 'object') return undefined;
  const o = outcome as Record<string, unknown>;
  return {
    status: String(o.status),
    ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
    ...(typeof o.steps === 'number' ? { steps: o.steps } : {}),
    ...(typeof o.stage === 'string' ? { stage: o.stage } : {}),
    ...(typeof o.step === 'number' ? { step: o.step } : {}),
    ...(typeof o.policyStopSource === 'string' ? { stopSource: o.policyStopSource } : {}),
  };
}
const DETAIL_LIMIT = 600;
/**
 * What a run that threw before it had an outcome is shown with: the error's code and message, keys and the task's input values
 * replaced, cut to a readable length. The dashboard puts its own words for a known code in front of the message.
 */
export function failureDetail(error: unknown, secrets: readonly string[]): RunRecord['errorDetail'] {
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
  // A project error keeps its own detail (for example the last output of the AT Driver command).
  const raw = error instanceof Error ? error.message : String(error);
  const { value } = createRedactor(secrets.filter(secret => secret.length >= 4))(raw);
  const message = value.length > DETAIL_LIMIT ? value.slice(0, DETAIL_LIMIT - 1) + '…' : value;
  return { ...(code ? { code } : {}), message };
}
/** The message for a failure: a project error by its own code and values, bad input as such, anything else as the generic failure. */
export function batchMessageOf(error: unknown): BatchMessage {
  if (error instanceof ProjectError) return { code: error.code, ...(error.params ? { params: error.params } : {}), text: error.message };
  if (error instanceof z.ZodError) return { code: 'invalid-input', text: 'The request is not valid.' };
  return { code: 'request-failed', text: error instanceof Error ? error.message : String(error) };
}
/** A task that is not registered in the project (a file run by path from the CLI), passed with the batch that runs it. */
export type LooseTask = { entry: ManagedTask; task: Task };
export type BatchQueueOptions = {
  /** Called whenever a batch changes, so a screen can refresh. */
  onChange?: () => void;
  executor?: Executor;
  /** Every recorded trace event of every run, as it happens. */
  onRunEvent?: (experimentId: string, runId: string, event: TraceEvent) => void;
  /** Who runs the batches this queue creates. */
  via?: BatchOwner['via'];
  /** How many runs go at once; without it the project's `machine.parallelRuns`. */
  parallel?: number;
};

const SELF: Pick<BatchOwner, 'pid' | 'host'> = { pid: process.pid, host: hostname() };
/** Whether a process on this computer is still there; one on another computer is taken to be. */
function alive(owner: BatchOwner): boolean {
  if (owner.host !== SELF.host) return true;
  try { process.kill(owner.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
const mine = (experiment: Experiment) => !!experiment.owner && experiment.owner.pid === SELF.pid && experiment.owner.host === SELF.host;
/** A batch another Rawstep process (a CLI run, another dashboard) is running right now: this one only reads it. */
export const runningElsewhere = (experiment: Experiment) => !mine(experiment) && !!experiment.owner && alive(experiment.owner)
  && experiment.runs.some(run => run.state === 'queued' || run.state === 'running');

/**
 * Runs batches, several runs at a time up to the parallel limit, and keeps their records. The batches of other processes in the same
 * project are listed (`refresh`) and left alone: a batch whose process is gone is marked interrupted.
 */
export class BatchQueue {
  readonly experiments: Experiment[] = [];
  private readonly active = new Map<string, { experiment: string; controller: AbortController; done: Promise<void> }>();
  private readonly liveTasks = new Map<string, Task>();
  private readonly seen = new Map<string, number>();
  private readonly waiters = new Set<() => void>();
  private filling = false;
  private refill = false;
  private closed = false;
  private writes = Promise.resolve();
  private readonly executor: Executor;
  constructor(readonly store: ProjectStore, private readonly options: BatchQueueOptions = {}) { this.executor = options.executor ?? executeRecord; }
  private changed() { this.options.onChange?.(); for (const wake of [...this.waiters]) wake(); }
  /** Lists the project's batches and marks the runs of a batch whose process is gone as interrupted. */
  async initialize() { await this.refresh(); }
  /**
   * Reads batches written since the last look: new ones, and those of other processes, which change while they run. Returns whether
   * anything changed.
   */
  async refresh(): Promise<boolean> {
    const directory = await this.store.file(BATCHES_DIR);
    await mkdir(directory, { recursive: true });
    let changed = false;
    for (const id of await readdir(directory)) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      const known = this.experiments.find(e => e.id === id);
      if (known && mine(known)) continue;
      const file = await this.store.file(BATCHES_DIR + '/' + id + '/experiment.json', true);
      // A crash between creating the directory and renaming experiment.json into it leaves nothing to recover.
      const modified = await stat(file).then(info => info.mtimeMs, () => undefined);
      if (modified === undefined || this.seen.get(id) === modified) continue;
      let experiment: Experiment;
      try { experiment = JSON.parse(await readFile(file, 'utf8')) as Experiment; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (experiment.id !== id || !Array.isArray(experiment.runs)) throw new Error(`The run history file of batch ${id} is not in the right format.`);
      this.seen.set(id, modified);
      for (const run of experiment.runs) if (run.outcome) run.outcome = publicOutcome(run.outcome);
      let interrupted = false;
      if (!runningElsewhere(experiment)) for (const run of experiment.runs) if (run.state === 'running' || run.state === 'queued') {
        run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; run.error = RUN_ERROR.restarted; interrupted = true;
      }
      if (known) this.experiments.splice(this.experiments.indexOf(known), 1, experiment); else this.experiments.push(experiment);
      if (interrupted) await this.persist(experiment);
      changed = true;
    }
    // Batches removed on disk (by another process) leave the list too.
    const present = new Set((await readdir(directory)).filter(id => /^[0-9a-f-]{36}$/.test(id)));
    for (const experiment of [...this.experiments]) if (!mine(experiment) && !present.has(experiment.id)) { this.experiments.splice(this.experiments.indexOf(experiment), 1); this.seen.delete(experiment.id); changed = true; }
    this.experiments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (changed) this.options.onChange?.();
    return changed;
  }
  async plan(raw: unknown, loose: Record<string, LooseTask> = {}) {
    const request = planSchema.parse(raw), { config, revision } = await this.store.read();
    const tasks: Record<string, Task> = { ...await this.store.tasks(config), ...Object.fromEntries(Object.entries(loose).map(([taskId, { task }]) => [taskId, task])) };
    const entries = [...config.tasks, ...Object.values(loose).map(({ entry }) => entry)];
    if (request.revision && request.revision !== revision) throw new ProjectError('plan-changed', 'The project changed since this batch was planned.', 409);
    const rows: (Combination & { conditions?: RunConditions })[] = [];
    const keyed = new Map<string, boolean>();
    const hasKey = async (model: Model) => { if (!keyed.has(model.id)) keyed.set(model.id, !modelKeyRequired(model) || !!await this.store.credential(model)); return keyed.get(model.id)!; };
    for (const taskId of new Set(request.taskIds)) {
      const task = entries.find(t => t.id === taskId), source = tasks[taskId];
      for (const conditions of conditionSets(config, { profileIds: request.profilesByTask?.[taskId] ?? request.profileIds })) for (let repeat = 1; repeat <= request.repeats; repeat++) {
        if (rows.length >= 1000) throw new ProjectError('too-many-combinations', 'A batch holds at most 1000 runs.', 400, { max: 1000 });
        const profileId = conditions.profile.id, key = [taskId, profileId, repeat].join(':');
        let reason: BatchMessage | undefined, warnings: BatchMessage[] = [], plannerName: string | undefined, permissions = structuredClone(conditions.actionSet.actions);
        if (!task || !source) reason = { code: 'task-not-found', text: `No task "${taskId}" in rawstep.config.json.` };
        else {
          try {
            const check = checkRun({ config, task: source, taskEntry: task, runRules: request.runRules, ...conditions });
            permissions = check.permissions; plannerName = check.plannerModel?.name ?? check.plannerPlanFile; warnings = check.warnings.map(warningMessage);
            if (check.problem) reason = batchMessageOf(check.problem);
            else if (check.plannerModel && !await hasKey(check.plannerModel)) reason = { code: 'missing-planner-credential', text: `The key for the planner model "${check.plannerModel.name}" is not set.` };
            else if (check.analysisModel && !await hasKey(check.analysisModel)) warnings.push({ code: 'analysis-key-missing', text: `The key for the analysis model "${check.analysisModel.name}" is not set; the runs get the rule-based analysis only.` });
          } catch (e) { reason = batchMessageOf(e); }
        }
        rows.push({ key, taskId, repeat, profileId, ...(plannerName ? { plannerName } : {}),
          supported: !reason, ...(reason ? { reason } : {}), warnings, permissions, conditions });
      }
    }
    return { request, config, tasks, entries, rows };
  }
  async create(raw: unknown, loose: Record<string, LooseTask> = {}) {
    if (this.closed) throw new ProjectError('shutting-down', 'Rawstep is shutting down.', 503);
    const { request, config, tasks, entries, rows } = await this.plan(raw, loose);
    const selected = request.selected ? rows.filter(r => request.selected!.includes(r.key)) : rows;
    if (!selected.length || selected.some(r => !r.supported) || (request.selected && new Set(request.selected).size !== selected.length)) throw new ProjectError('select-supported', 'Pick only runs that can run.');
    const keyed = new Map<string, string | undefined>();
    const runs: RunRecord[] = [];
    for (const { conditions, ...row } of selected) {
      const task = entries.find(t => t.id === row.taskId)!;
      const check = assertRunnable(checkRun({ config, task: tasks[row.taskId]!, taskEntry: task, runRules: request.runRules, ...conditions! }));
      const analysisModel = check.analysisModel;
      if (analysisModel && !keyed.has(analysisModel.id)) keyed.set(analysisModel.id, !modelKeyRequired(analysisModel) || await this.store.credential(analysisModel) ? analysisModel.id : undefined);
      const spec = { ...runSpecOf(safeTask(tasks[row.taskId]!), conditions!, check), ...(check.plannerPlanFile ? { plannerPlan: await loadPlanFile(this.store, check.plannerPlanFile) } : {}) };
      const run: RunRecord = { ...row, id: randomUUID(), state: 'queued', analysisStatus: 'pending', reportStatus: 'pending', taskFile: task.file, analysisInstructions: check.settings.analysisInstructions,
        snapshot: { taskName: task.name, spec }, ...(analysisModel && keyed.get(analysisModel.id) ? { analysisModel } : {}) };
      this.liveTasks.set(run.id, structuredClone(tasks[row.taskId]!));
      runs.push(run);
    }
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, request, runs, owner: { ...SELF, via: this.options.via ?? 'dashboard' } };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); void this.fill();
    return experiment;
  }
  async previewRetry(experiment: string, run: string): Promise<RetryPreview> {
    const original = this.find(experiment, run);
    if (!original.taskFile) throw new ProjectError('retry-no-task-file', 'This run has no task file to run again.');
    const current = safeTask(await this.store.task(original.taskFile));
    const { revision } = await this.store.read();
    const fields = new Set([...Object.keys(original.snapshot.spec.task), ...Object.keys(current)]);
    const changedFields = [...fields].filter(key => JSON.stringify(original.snapshot.spec.task[key as keyof Task]) !== JSON.stringify(current[key as keyof Task]));
    return { revision, changedFields, original: original.snapshot.spec.task, current };
  }
  async retry(experimentId: string, runId: string, revision: string) {
    if (this.closed) throw new ProjectError('shutting-down', 'Rawstep is shutting down.', 503);
    const original = this.find(experimentId, runId), preview = await this.previewRetry(experimentId, runId);
    if (['queued', 'running'].includes(original.state)) throw new ProjectError('retry-run-active', 'This run is still going.');
    if (preview.revision !== revision) throw new ProjectError('task-changed', 'The task changed since the preview.', 409);
    const fresh = await this.store.task(original.taskFile!);
    // Re-read secrets from the task file, retaining the original public execution conditions.
    const task = { ...structuredClone(original.snapshot.spec.task), input: fresh.input };
    for (const key of Object.keys(task) as (keyof Task)[]) {
      if (JSON.stringify(task[key])?.includes('[REDACTED]')) Object.assign(task, { [key]: fresh[key] });
    }
    if ((await this.store.read()).revision !== revision) throw new ProjectError('task-changed', 'The task changed since the preview.', 409);
    const spec = original.snapshot.spec;
    resolvePermissions(spec.backend, { actions: original.permissions }, task);
    const run: RunRecord = { ...structuredClone(original), id: randomUUID(), state: 'queued', repeat: 1, analysisStatus: 'pending', reportStatus: 'pending', retryOf: { experiment: experimentId, run: runId } };
    for (const key of ['startedAt', 'endedAt', 'outcome', 'error', 'analysisError', 'reportError'] as const) delete run[key];
    run.snapshot.spec.task = safeTask(task); this.liveTasks.set(run.id, task);
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, runs: [run],
      request: { taskIds: [run.taskId], profileIds: [run.profileId], repeats: 1 }, owner: { ...SELF, via: this.options.via ?? 'dashboard' } };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); void this.fill(); return experiment;
  }
  /** Resolves once none of the batch's runs is queued or running. */
  whenDone(experimentId: string): Promise<void> {
    const settled = () => !this.experiments.find(e => e.id === experimentId)?.runs.some(r => r.state === 'queued' || r.state === 'running');
    if (settled()) return Promise.resolve();
    return new Promise(resolve => { const wake = () => { if (settled()) { this.waiters.delete(wake); resolve(); } }; this.waiters.add(wake); });
  }
  /** How many runs may go at once: the queue's own limit or the project's `parallelRuns`. */
  private async limit(): Promise<number> {
    const machine = await this.store.read().then(({ config }) => config.machine, () => undefined);
    return Math.max(1, Math.min(8, this.options.parallel ?? machine?.parallelRuns ?? 1));
  }
  /** The next run to start: the oldest batch's first queued run, skipping one that needs the kept browser profile while another has it. */
  private next(): { experiment: Experiment; run: RunRecord } | undefined {
    const profileTaken = [...this.active.keys()].some(id => usesKeptProfile(this.experiments.flatMap(e => e.runs).find(r => r.id === id)?.snapshot.spec.task.browser));
    for (const experiment of [...this.experiments].reverse()) {
      if (!mine(experiment) || experiment.stopped) continue;
      const run = experiment.runs.find(r => r.state === 'queued' && !(profileTaken && usesKeptProfile(r.snapshot.spec.task.browser)));
      if (run) return { experiment, run };
    }
    return undefined;
  }
  /** Starts queued runs, oldest batch first, until the parallel limit is reached. */
  private async fill(): Promise<void> {
    if (this.filling) { this.refill = true; return; }
    this.filling = true;
    try {
      do {
        this.refill = false;
        const limit = await this.limit();
        while (!this.closed && this.active.size < limit) {
          // One Chrome profile cannot be open twice: runs that keep it wait for each other, the rest go on.
          const next = this.next(); if (!next) break;
          await this.begin(next.experiment, next.run);
        }
      } while (this.refill && !this.closed);
    } catch { await this.storageFailed(); } finally { this.filling = false; }
  }
  private async begin(experiment: Experiment, run: RunRecord) {
    const controller = new AbortController();
    run.state = 'running'; run.startedAt = new Date().toISOString();
    const slot = { experiment: experiment.id, controller, done: Promise.resolve() };
    this.active.set(run.id, slot);
    await this.persist(experiment); this.changed();
    slot.done = this.execute(experiment, run, controller).catch(() => this.storageFailed()).finally(() => { this.active.delete(run.id); this.changed(); void this.fill(); });
  }
  /** Saving a batch failed: nothing more can be recorded, so every run still waiting or going ends as interrupted. */
  private async storageFailed() {
    for (const { controller } of this.active.values()) controller.abort('storage-error');
    for (const experiment of this.experiments.filter(mine)) {
      for (const run of experiment.runs) if (['queued', 'running'].includes(run.state)) {
        run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.error = RUN_ERROR.storage;
        run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; this.liveTasks.delete(run.id);
      }
      await this.persist(experiment).catch(() => {});
    }
    this.changed();
  }
  private async execute(experiment: Experiment, run: RunRecord, controller: AbortController) {
    const outDir = await this.store.file(BATCHES_DIR + '/' + experiment.id + '/' + run.id);
    const task = this.liveTasks.get(run.id)!;
    let plannerApiKey: string | undefined;
    try {
      const spec = run.snapshot.spec;
      const atDriverCommand = spec.backend !== 'simulation' ? await this.store.localValue(AT_DRIVER_COMMAND_ENV) : undefined;
      const browserProfileDir = await this.store.file('.rawstep/browser-profile');
      plannerApiKey = spec.plannerModel ? await this.store.credential(spec.plannerModel) : undefined;
      const trace = await this.executor(run, task, outDir, controller.signal, event => this.options.onRunEvent?.(experiment.id, run.id, event), { atDriverCommand, browserProfileDir, plannerApiKey });
      run.outcome = publicOutcome(trace.outcome);
      if (trace.outcome?.reason === 'error' && typeof trace.outcome.error === 'string') run.errorDetail = failureDetail(new Error(trace.outcome.error), [plannerApiKey ?? '', ...Object.values(task?.input ?? {})]);
      run.state = controller.signal.aborted ? 'cancelled' : trace.outcome?.status === 'success' ? 'success' : trace.outcome?.status === 'failure' ? 'failure' : 'inconclusive';
      const analysisModel = run.analysisModel;
      const done = await finalizeRun(trace, outDir, { taskName: run.snapshot.taskName, ...(analysisModel ? { createAnalyzer: async () => llmAnalyzer(analysisModel, await this.store.credential(analysisModel), run.analysisInstructions, controller.signal) } : {}) });
      // The last repeat of a task under a profile: every repeat is compared with the fastest one that reached the goal, before
      // this run counts as done, so nothing reads its hints in between.
      const repeats = experiment.runs.filter(other => other.taskId === run.taskId && other.profileId === run.profileId);
      if (repeats.length > 1 && !repeats.some(other => other !== run && (other.state === 'queued' || other.state === 'running')))
        await compareRepeats(await Promise.all(repeats.map(other => this.store.file(BATCHES_DIR + '/' + experiment.id + '/' + other.id))), { taskName: run.snapshot.taskName }).catch(() => {});
      run.analysisStatus = done.analysis.status;
      if (done.analysis.status === 'failed') run.analysisError = done.analysis.threw ? 'analysis-failed' : done.analysis.error ?? 'analysis-failed';
      run.reportStatus = done.report.status;
      if (done.report.status === 'failed') run.reportError = 'report-failed';
    } catch (error) {
      run.state = controller.signal.aborted ? 'cancelled' : 'failure'; run.error = RUN_ERROR.start;
      if (!controller.signal.aborted) run.errorDetail = failureDetail(error, [plannerApiKey ?? '', ...Object.values(task?.input ?? {})]);
      run.analysisStatus = 'skipped'; run.reportStatus = 'skipped';
    } finally {
      run.endedAt = new Date().toISOString(); this.liveTasks.delete(run.id); await this.persist(experiment);
    }
  }
  /** Refuses to act on a batch another process is running: only that process can stop or change it. */
  private own(experiment: Experiment) {
    if (runningElsewhere(experiment)) throw new ProjectError('batch-running-elsewhere', `This batch is running in another Rawstep process (${experiment.owner!.via}, process ${experiment.owner!.pid}); stop it there.`, 409);
  }
  async cancel(experimentId: string, runId?: string) {
    const experiment = this.experiments.find(e => e.id === experimentId); if (!experiment) throw new ProjectError('experiment-not-found', 'No such batch.', 404);
    if (runId && !experiment.runs.some(r => r.id === runId)) throw new ProjectError('run-not-found', 'No such run.', 404);
    this.own(experiment);
    if (!runId) experiment.stopped = true;
    for (const run of experiment.runs) if ((!runId || run.id === runId) && run.state === 'queued') { run.state = 'cancelled'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; this.liveTasks.delete(run.id); }
    for (const [id, slot] of this.active) if (slot.experiment === experimentId && (!runId || id === runId)) slot.controller.abort('requested');
    await this.persist(experiment); this.changed(); return experiment;
  }
  async close() { this.closed = true; for (const slot of this.active.values()) slot.controller.abort('requested'); await Promise.all([...this.active.values()].map(slot => slot.done)); }
  /** Runs file work after every earlier write, so a late save cannot bring back a directory that was just removed. */
  private serialize<T>(work: () => Promise<T>) {
    const result = this.writes.then(work);
    this.writes = result.then(() => {}, () => {}); return result;
  }
  async persist(experiment: Experiment) {
    const snapshot = structuredClone(experiment);
    return this.serialize(async () => {
      const file = await this.store.file(BATCHES_DIR + '/' + experiment.id + '/experiment.json');
      await atomicJson(file, snapshot);
      // What this process wrote is not news when it looks again.
      const modified = await stat(file).then(info => info.mtimeMs, () => undefined);
      if (modified !== undefined) this.seen.set(experiment.id, modified);
    });
  }
  /**
   * Removes recorded runs (all of the experiment's when `runIds` is omitted) with their files. Queued and running runs are never
   * removed. An experiment left without runs goes too. Returns how many runs were removed.
   */
  async deleteRuns(experimentId: string, runIds?: readonly string[]) {
    const removed = await this.removeRuns([{ experimentId, runIds }]); this.changed(); return removed;
  }
  /** Removes runs of several experiments in one go; nothing is removed unless every one of them may be. */
  async deleteMany(refs: readonly { experiment: string; run: string }[]) {
    const groups = new Map<string, string[]>();
    for (const ref of refs) groups.set(ref.experiment, [...groups.get(ref.experiment) ?? [], ref.run]);
    const removed = await this.removeRuns([...groups].map(([experimentId, runIds]) => ({ experimentId, runIds }))); this.changed(); return removed;
  }
  private async removeRuns(requests: { experimentId: string; runIds?: readonly string[] | undefined }[]) {
    const plans = requests.map(({ experimentId, runIds }) => {
      const experiment = this.experiments.find(e => e.id === experimentId); if (!experiment) throw new ProjectError('experiment-not-found', 'No such batch.', 404);
      const ids = new Set(runIds ?? experiment.runs.map(r => r.id));
      if ([...ids].some(id => !experiment.runs.some(r => r.id === id))) throw new ProjectError('run-not-found', 'No such run.', 404);
      return { experiment, ids };
    });
    if (plans.some(({ experiment, ids }) => experiment.runs.some(r => ids.has(r.id) && ['queued', 'running'].includes(r.state)))) throw new ProjectError('delete-run-active', 'A run that is waiting or going cannot be deleted.', 409);
    let removed = 0;
    for (const { experiment, ids } of plans) {
      removed += ids.size;
      const rest = experiment.runs.filter(r => !ids.has(r.id));
      if (!rest.length) {
        this.experiments.splice(this.experiments.indexOf(experiment), 1); this.seen.delete(experiment.id);
        await this.serialize(async () => rm(await this.store.file(BATCHES_DIR + '/' + experiment.id), { recursive: true, force: true }));
      } else {
        experiment.runs = rest;
        await this.serialize(async () => { for (const id of ids) await rm(await this.store.file(BATCHES_DIR + '/' + experiment.id + '/' + id), { recursive: true, force: true }); });
        await this.persist(experiment);
      }
    }
    return removed;
  }
  find(experiment: string, run: string) {
    const found = this.experiments.find(e => e.id === experiment)?.runs.find(r => r.id === run);
    if (!found) throw new ProjectError('run-not-found', 'No such run.', 404); return found;
  }
  /** The folder a run writes its trace, hints and report to. */
  runDir(experiment: string, run: string) { return this.store.file(BATCHES_DIR + '/' + experiment + '/' + run); }
  async trace(experiment: string, run: string) {
    this.find(experiment, run);
    return readTrace(await this.store.file(BATCHES_DIR + '/' + experiment + '/' + run + '/trace.json', true));
  }
}
function safeTask(task: Task): Task {
  const redacted = createRedactor(Object.values(task.input ?? {}))(task).value;
  return { ...redacted, ...(task.id ? { id: task.id } : {}), input: Object.fromEntries(Object.keys(task.input ?? {}).map(k => [k, '[REDACTED]'])) };
}

/** The run profiles a batch lists, in its order; ids no profile has are left out (the plan then has fewer rows). */
function conditionSets(config: ProjectConfig, request: { profileIds: string[] }): RunConditions[] {
  return [...new Set(request.profileIds)].map(id => config.profiles.find(p => p.id === id)).filter(p => !!p).map(profile => profileConditions(profile));
}
/** The run check's warnings as message codes; one the dashboard has no words for is passed on as recorded. */
function warningMessage(warning: string): BatchMessage {
  if (warning.startsWith('The analysis model is not on an LLM connection')) return { code: 'analysis-not-llm', text: warning };
  return { code: 'warning-text', params: { text: warning }, text: warning };
}
