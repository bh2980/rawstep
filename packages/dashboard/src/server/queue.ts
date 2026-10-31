import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { createRedactor, readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import type { Task } from '@rawstep/core/contracts';
import { AT_DRIVER_COMMAND_ENV, modelKeyRequired, profileConditions, type Model, type ProjectConfig } from '@rawstep/project/config';
import { ProjectStore, atomicJson } from '@rawstep/project/store';
import { assertRunnable, checkRun, loadPlanFile, resolvePermissions, runSpecOf, type RunConditions } from '@rawstep/project/plan';
import { executeRun } from '@rawstep/project/execution';
import { compareRepeats, finalizeRun, llmAnalyzer } from '@rawstep/project/run';
import { RUN_ERROR, planSchema, type Combination, type Experiment, type RunRecord, type RetryPreview } from '../shared/config.js';
import { HttpError, messageOf } from './http.js';
import type { ServerMessage } from '../shared/messages.js';

/** Runs one run record; the default executes it for real, tests substitute their own. */
export type Executor = (run: RunRecord, task: Task, outDir: string, signal: AbortSignal, onEvent?: (event: TraceEvent) => void, local?: { atDriverCommand?: string | undefined; browserProfileDir?: string | undefined; plannerApiKey?: string | undefined }) => Promise<RunTrace>;
const executeRecord: Executor = (run, task, outDir, signal, onEvent, local = {}) =>
  executeRun({ ...run.snapshot.spec, task }, { outDir, signal, ...local, ...(onEvent ? { onEvent } : {}) });
/**
 * What the dashboard keeps and serves of a recorded outcome: the result and how far the run got. A failed run's outcome also holds
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
export class ExperimentQueue {
  readonly experiments: Experiment[] = [];
  private active?: { experiment: string; run: string; controller: AbortController };
  private draining?: Promise<void>;
  private closed = false;
  private writes = Promise.resolve();
  private readonly liveTasks = new Map<string, Task>();
  constructor(readonly store: ProjectStore, private readonly changed: () => void, private readonly executor: Executor = executeRecord, private readonly runEvent?: (experimentId: string, runId: string, event: TraceEvent) => void) {}
  async initialize() {
    const directory = await this.store.file('.rawstep/experiments');
    await mkdir(directory, { recursive: true });
    for (const id of await readdir(directory)) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      const file = await this.store.file('.rawstep/experiments/' + id + '/experiment.json', true);
      let raw: string;
      // A crash between creating the directory and renaming experiment.json into it leaves nothing to recover.
      try { raw = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const experiment = JSON.parse(raw) as Experiment;
      if (experiment.id !== id || !Array.isArray(experiment.runs)) throw new Error(`The run history file of batch ${id} is not in the right format.`);
      let interrupted = false;
      for (const run of experiment.runs) if (run.outcome) run.outcome = publicOutcome(run.outcome);
      for (const run of experiment.runs) if (run.state === 'running' || run.state === 'queued') { run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; run.error = RUN_ERROR.restarted; interrupted = true; }
      this.experiments.push(experiment);
      if (interrupted) await this.persist(experiment);
    }
    this.experiments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async plan(raw: unknown) {
    const request = planSchema.parse(raw), { config, revision } = await this.store.read(), tasks = await this.store.tasks(config);
    if (request.revision && request.revision !== revision) throw new HttpError(409, 'plan-changed');
    const rows: (Combination & { conditions?: RunConditions })[] = [];
    const keyed = new Map<string, boolean>();
    const hasKey = async (model: Model) => { if (!keyed.has(model.id)) keyed.set(model.id, !modelKeyRequired(model) || !!await this.store.credential(model)); return keyed.get(model.id)!; };
    for (const taskId of new Set(request.taskIds)) {
      const task = config.tasks.find(t => t.id === taskId), source = tasks[taskId];
      for (const conditions of conditionSets(config, request)) for (let repeat = 1; repeat <= request.repeats; repeat++) {
        if (rows.length >= 1000) throw new HttpError(400, 'too-many-combinations', { max: 1000 });
        const profileId = conditions.profile.id, key = [taskId, profileId, repeat].join(':');
        let reason: ServerMessage | undefined, warnings: ServerMessage[] = [], plannerName: string | undefined, permissions = structuredClone(conditions.actionSet.actions);
        if (!task || !source) reason = { code: 'task-not-found' };
        else {
          try {
            const check = checkRun({ config, task: source, taskEntry: task, runRules: request.runRules, ...conditions });
            permissions = check.permissions; plannerName = check.plannerModel?.name ?? check.plannerPlanFile; warnings = check.warnings.map(warningMessage);
            if (check.problem) reason = messageOf(check.problem);
            else if (check.plannerModel && !await hasKey(check.plannerModel)) reason = { code: 'missing-planner-credential' };
            else if (check.analysisModel && !await hasKey(check.analysisModel)) warnings.push({ code: 'analysis-key-missing' });
          } catch (e) { reason = messageOf(e); }
        }
        rows.push({ key, taskId, repeat, profileId, ...(plannerName ? { plannerName } : {}),
          supported: !reason, ...(reason ? { reason } : {}), warnings, permissions, conditions });
      }
    }
    return { request, config, tasks, rows };
  }
  async create(raw: unknown) {
    if (this.closed) throw new HttpError(503, 'shutting-down');
    const { request, config, tasks, rows } = await this.plan(raw);
    const selected = request.selected ? rows.filter(r => request.selected!.includes(r.key)) : rows;
    if (!selected.length || selected.some(r => !r.supported) || (request.selected && new Set(request.selected).size !== selected.length)) throw new HttpError(400, 'select-supported');
    const keyed = new Map<string, string | undefined>();
    const runs: RunRecord[] = [];
    for (const { conditions, ...row } of selected) {
      const task = config.tasks.find(t => t.id === row.taskId)!;
      const check = assertRunnable(checkRun({ config, task: tasks[row.taskId]!, taskEntry: task, runRules: request.runRules, ...conditions! }));
      const analysisModel = check.analysisModel;
      if (analysisModel && !keyed.has(analysisModel.id)) keyed.set(analysisModel.id, !modelKeyRequired(analysisModel) || await this.store.credential(analysisModel) ? analysisModel.id : undefined);
      const spec = { ...runSpecOf(safeTask(tasks[row.taskId]!), conditions!, check), ...(check.plannerPlanFile ? { plannerPlan: await loadPlanFile(this.store, check.plannerPlanFile) } : {}) };
      const run: RunRecord = { ...row, id: randomUUID(), state: 'queued', analysisStatus: 'pending', reportStatus: 'pending', taskFile: task.file, analysisInstructions: check.settings.analysisInstructions,
        snapshot: { taskName: task.name, spec }, ...(analysisModel && keyed.get(analysisModel.id) ? { analysisModel } : {}) };
      this.liveTasks.set(run.id, structuredClone(tasks[row.taskId]!));
      runs.push(run);
    }
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, request, runs };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); this.start();
    return experiment;
  }
  async previewRetry(experiment: string, run: string): Promise<RetryPreview> {
    const original = this.find(experiment, run);
    if (!original.taskFile) throw new HttpError(400, 'retry-no-task-file');
    const current = safeTask(await this.store.task(original.taskFile));
    const { revision } = await this.store.read();
    const fields = new Set([...Object.keys(original.snapshot.spec.task), ...Object.keys(current)]);
    const changedFields = [...fields].filter(key => JSON.stringify(original.snapshot.spec.task[key as keyof Task]) !== JSON.stringify(current[key as keyof Task]));
    return { revision, changedFields, original: original.snapshot.spec.task, current };
  }
  async retry(experimentId: string, runId: string, revision: string) {
    if (this.closed) throw new HttpError(503, 'shutting-down');
    const original = this.find(experimentId, runId), preview = await this.previewRetry(experimentId, runId);
    if (['queued', 'running'].includes(original.state)) throw new HttpError(400, 'retry-run-active');
    if (preview.revision !== revision) throw new HttpError(409, 'task-changed');
    const fresh = await this.store.task(original.taskFile!);
    // Re-read secrets from the task file, retaining the original public execution conditions.
    const task = { ...structuredClone(original.snapshot.spec.task), input: fresh.input };
    for (const key of Object.keys(task) as (keyof Task)[]) {
      if (JSON.stringify(task[key])?.includes('[REDACTED]')) Object.assign(task, { [key]: fresh[key] });
    }
    if ((await this.store.read()).revision !== revision) throw new HttpError(409, 'task-changed');
    const spec = original.snapshot.spec;
    resolvePermissions(spec.backend, { actions: original.permissions }, task);
    const run: RunRecord = { ...structuredClone(original), id: randomUUID(), state: 'queued', repeat: 1, analysisStatus: 'pending', reportStatus: 'pending', retryOf: { experiment: experimentId, run: runId } };
    for (const key of ['startedAt', 'endedAt', 'outcome', 'error', 'analysisError', 'reportError'] as const) delete run[key];
    run.snapshot.spec.task = safeTask(task); this.liveTasks.set(run.id, task);
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, runs: [run],
      request: { taskIds: [run.taskId], profileIds: [run.profileId], repeats: 1 } };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); this.start(); return experiment;
  }
  private start() {
    if (this.draining) return;
    this.draining = this.drain().catch(async () => {
      this.active?.controller.abort('storage-error'); this.active = undefined;
      for (const experiment of this.experiments) {
        for (const run of experiment.runs) if (['queued', 'running'].includes(run.state)) {
          run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.error = RUN_ERROR.storage;
          run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; this.liveTasks.delete(run.id);
        }
        await this.persist(experiment).catch(() => {});
      }
      this.changed();
    }).finally(() => { this.draining = undefined; if (!this.closed && this.experiments.some(e => !e.stopped && e.runs.some(r => r.state === 'queued'))) this.start(); });
  }
  private async drain() {
    while (!this.closed) {
      const experiment = [...this.experiments].reverse().find(e => !e.stopped && e.runs.some(r => r.state === 'queued'));
      const run = experiment?.runs.find(r => r.state === 'queued'); if (!experiment || !run) return;
      const controller = new AbortController(); this.active = { experiment: experiment.id, run: run.id, controller };
      run.state = 'running'; run.startedAt = new Date().toISOString(); await this.persist(experiment); this.changed();
      const outDir = await this.store.file('.rawstep/experiments/' + experiment.id + '/' + run.id);
      const task = this.liveTasks.get(run.id)!;
      let plannerApiKey: string | undefined;
      try {
        const spec = run.snapshot.spec;
        const atDriverCommand = spec.backend !== 'simulation' ? await this.store.localValue(AT_DRIVER_COMMAND_ENV) : undefined;
        const browserProfileDir = await this.store.file('.rawstep/browser-profile');
        plannerApiKey = spec.plannerModel ? await this.store.credential(spec.plannerModel) : undefined;
        const trace = await this.executor(run, task, outDir, controller.signal, event => this.runEvent?.(experiment.id, run.id, event), { atDriverCommand, browserProfileDir, plannerApiKey });
        run.outcome = publicOutcome(trace.outcome);
        if (trace.outcome?.reason === 'error' && typeof trace.outcome.error === 'string') run.errorDetail = failureDetail(new Error(trace.outcome.error), [plannerApiKey ?? '', ...Object.values(task?.input ?? {})]);
        run.state = controller.signal.aborted ? 'cancelled' : trace.outcome?.status === 'success' ? 'success' : trace.outcome?.status === 'failure' ? 'failure' : 'inconclusive';
        const analysisModel = run.analysisModel;
        const done = await finalizeRun(trace, outDir, analysisModel ? { createAnalyzer: async () => llmAnalyzer(analysisModel, await this.store.credential(analysisModel), run.analysisInstructions, controller.signal) } : {});
        // The last repeat of a task under a profile: every repeat is compared with the fastest one that reached the goal, before
        // this run counts as done, so nothing reads its hints in between.
        const repeats = experiment.runs.filter(other => other.taskId === run.taskId && other.profileId === run.profileId);
        if (repeats.length > 1 && !repeats.some(other => other !== run && (other.state === 'queued' || other.state === 'running')))
          await compareRepeats(await Promise.all(repeats.map(other => this.store.file('.rawstep/experiments/' + experiment.id + '/' + other.id)))).catch(() => {});
        run.analysisStatus = done.analysis.status;
        if (done.analysis.status === 'failed') run.analysisError = done.analysis.threw ? 'analysis-failed' : done.analysis.error ?? 'analysis-failed';
        run.reportStatus = done.report.status;
        if (done.report.status === 'failed') run.reportError = 'report-failed';
      } catch (error) {
        run.state = controller.signal.aborted ? 'cancelled' : 'failure'; run.error = RUN_ERROR.start;
        if (!controller.signal.aborted) run.errorDetail = failureDetail(error, [plannerApiKey ?? '', ...Object.values(task?.input ?? {})]);
        run.analysisStatus = 'skipped'; run.reportStatus = 'skipped';
      } finally {
        run.endedAt = new Date().toISOString(); this.liveTasks.delete(run.id); this.active = undefined; await this.persist(experiment); this.changed();
      }
    }
  }
  async cancel(experimentId: string, runId?: string) {
    const experiment = this.experiments.find(e => e.id === experimentId); if (!experiment) throw new HttpError(404, 'experiment-not-found');
    if (runId && !experiment.runs.some(r => r.id === runId)) throw new HttpError(404, 'run-not-found');
    if (!runId) experiment.stopped = true;
    for (const run of experiment.runs) if ((!runId || run.id === runId) && run.state === 'queued') { run.state = 'cancelled'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; this.liveTasks.delete(run.id); }
    if (this.active?.experiment === experimentId && (!runId || this.active.run === runId)) this.active.controller.abort('requested');
    await this.persist(experiment); this.changed(); return experiment;
  }
  async close() { this.closed = true; this.active?.controller.abort('requested'); await this.draining; }
  /** Runs file work after every earlier write, so a late save cannot bring back a directory that was just removed. */
  private serialize<T>(work: () => Promise<T>) {
    const result = this.writes.then(work);
    this.writes = result.then(() => {}, () => {}); return result;
  }
  async persist(experiment: Experiment) {
    const snapshot = structuredClone(experiment);
    return this.serialize(async () => atomicJson(await this.store.file('.rawstep/experiments/' + experiment.id + '/experiment.json'), snapshot));
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
      const experiment = this.experiments.find(e => e.id === experimentId); if (!experiment) throw new HttpError(404, 'experiment-not-found');
      const ids = new Set(runIds ?? experiment.runs.map(r => r.id));
      if ([...ids].some(id => !experiment.runs.some(r => r.id === id))) throw new HttpError(404, 'run-not-found');
      return { experiment, ids };
    });
    if (plans.some(({ experiment, ids }) => experiment.runs.some(r => ids.has(r.id) && ['queued', 'running'].includes(r.state)))) throw new HttpError(409, 'delete-run-active');
    let removed = 0;
    for (const { experiment, ids } of plans) {
      removed += ids.size;
      const rest = experiment.runs.filter(r => !ids.has(r.id));
      if (!rest.length) {
        this.experiments.splice(this.experiments.indexOf(experiment), 1);
        await this.serialize(async () => rm(await this.store.file('.rawstep/experiments/' + experiment.id), { recursive: true, force: true }));
      } else {
        experiment.runs = rest;
        await this.serialize(async () => { for (const id of ids) await rm(await this.store.file('.rawstep/experiments/' + experiment.id + '/' + id), { recursive: true, force: true }); });
        await this.persist(experiment);
      }
    }
    return removed;
  }
  find(experiment: string, run: string) {
    const found = this.experiments.find(e => e.id === experiment)?.runs.find(r => r.id === run);
    if (!found) throw new HttpError(404, 'run-not-found'); return found;
  }
  async trace(experiment: string, run: string) {
    this.find(experiment, run);
    return readTrace(await this.store.file('.rawstep/experiments/' + experiment + '/' + run + '/trace.json', true));
  }
}
function safeTask(task: Task): Task {
  const redacted = createRedactor(Object.values(task.input ?? {}))(task).value;
  return { ...redacted, ...(task.id ? { id: task.id } : {}), input: Object.fromEntries(Object.keys(task.input ?? {}).map(k => [k, '[REDACTED]'])) };
}

/** The run profiles an experiment lists, in its order; ids no profile has are left out (the plan then has fewer rows). */
function conditionSets(config: ProjectConfig, request: { profileIds: string[] }): RunConditions[] {
  return [...new Set(request.profileIds)].map(id => config.profiles.find(p => p.id === id)).filter(p => !!p).map(profile => profileConditions(profile));
}
/** The run check's warnings as message codes; one the dashboard has no words for is passed on as recorded. */
function warningMessage(warning: string): ServerMessage {
  if (warning.startsWith('The analysis model is not on an LLM connection')) return { code: 'analysis-not-llm' };
  return { code: 'warning-text', params: { text: warning } };
}
