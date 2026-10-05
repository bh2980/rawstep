import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { LlmTraceAnalyzer } from '@rawstep/reports';
import { ProjectError } from '@rawstep/project/errors';
import { createRedactor, readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import type { Task } from '@rawstep/core/contracts';
import { modelKeyRequired, resolveBaseURL, resolveRunSettings, taskProfile, type Model } from '@rawstep/project/config';
import { ProjectStore, atomicJson } from '@rawstep/project/store';
import { checkRun, resolvePermissions } from '@rawstep/project/plan';
import { executeRun } from '@rawstep/project/execution';
import { finalizeRun } from '@rawstep/project/run';
import { planSchema, type Combination, type Experiment, type RunRecord, type RetryPreview } from '../shared/config.js';
import { HttpError, koreanMessage } from './http.js';

/** Runs one run record; the default executes it for real, tests substitute their own. */
export type Executor = (run: RunRecord, task: Task, outDir: string, apiKey: string | undefined, signal: AbortSignal, onEvent?: (event: TraceEvent) => void) => Promise<RunTrace>;
const executeRecord: Executor = (run, task, outDir, apiKey, signal, onEvent) => {
  const { model, prompt, mode, globals, profile } = run.snapshot;
  return executeRun({ task, model, prompt, mode, settings: globals, environment: profile, permissions: run.permissions, diagnoseStop: run.diagnoseStop }, { outDir, apiKey, signal, ...(onEvent ? { onEvent } : {}) });
};
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
      if (experiment.id !== id || !Array.isArray(experiment.runs)) throw new Error('실험 이력 형식이 잘못되었습니다.');
      let interrupted = false;
      for (const run of experiment.runs) if (run.state === 'running' || run.state === 'queued') { run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; run.error = '서버 재시작으로 중단되었습니다. 새 실행으로 재시도하세요.'; interrupted = true; }
      this.experiments.push(experiment);
      if (interrupted) await this.persist(experiment);
    }
    this.experiments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async plan(raw: unknown) {
    const request = planSchema.parse(raw), { config, revision } = await this.store.read(), tasks = await this.store.tasks(config);
    if (request.revision && request.revision !== revision) throw new HttpError(409, '작업이나 설정이 변경되었습니다. 실행 조합을 다시 확인하세요.');
    const rows: Combination[] = [];
    const keyed = new Map<string, boolean>();
    const hasKey = async (model: Model) => { if (!keyed.has(model.id)) keyed.set(model.id, !modelKeyRequired(model) || !!await this.store.credential(model)); return keyed.get(model.id)!; };
    for (const taskId of new Set(request.taskIds)) for (const modelId of new Set(request.modelIds)) for (const promptId of new Set(request.promptIds)) for (const profileId of new Set(request.profileIds ?? [taskProfile(config, config.tasks.find(t => t.id === taskId) ?? {}).id])) for (let repeat = 1; repeat <= request.repeats; repeat++) {
      if (rows.length >= 1000) throw new HttpError(400, '실험 하나의 실행 조합은 최대 1000개입니다.');
      const task = config.tasks.find(t => t.id === taskId), model = config.models.find(m => m.id === modelId), profile = config.profiles.find(p => p.id === profileId);
      const prompt = task?.modes[request.mode].prompts.find(p => p.id === promptId);
      const source = tasks[taskId];
      let reason: string | undefined, permissions = structuredClone((profile ?? config.profiles[0]!).permissions[request.mode]);
      if (!task || !model || !profile || !prompt || !source) reason = '작업·모델·프롬프트·실행 프로필 중 찾을 수 없는 항목이 있습니다.';
      else {
        try {
          const analyzer = request.analysisModelId ? config.models.find(m => m.id === request.analysisModelId) : undefined;
          const check = checkRun({ config, task: source, taskEntry: task, model, profile, mode: request.mode, analysisModel: analyzer, diagnoseStop: request.diagnoseStop });
          permissions = check.permissions;
          if (check.problem) reason = koreanMessage(check.problem);
          else if (!await hasKey(model)) reason = koreanMessage(new ProjectError('missing-credential', ''));
          else if (request.analysisModelId && !analyzer) reason = koreanMessage(new ProjectError('analysis-model-invalid', ''));
        } catch (e) { reason = (e as Error).message; }
      }
      rows.push({ key: [taskId, modelId, promptId, profileId, repeat].join(':'), taskId, modelId, promptId, profileId, repeat, supported: !reason, ...(reason ? { reason } : {}), permissions, permissionSource: task?.modes[request.mode].permissions ? 'task' : 'profile' });
    }
    return { request, config, tasks, rows };
  }
  async create(raw: unknown) {
    if (this.closed) throw new HttpError(503, '서버 종료 중입니다.');
    const { request, config, tasks, rows } = await this.plan(raw);
    const selected = request.selected ? rows.filter(r => request.selected!.includes(r.key)) : rows;
    if (!selected.length || selected.some(r => !r.supported) || (request.selected && new Set(request.selected).size !== selected.length)) throw new HttpError(400, '지원하는 실행 조합을 선택하세요.');
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, request, runs: selected.map(row => {
      const task = config.tasks.find(t => t.id === row.taskId)!, model = config.models.find(m => m.id === row.modelId)!, profile = config.profiles.find(p => p.id === row.profileId)!;
      const settings = resolveRunSettings(config, task, profile);
      const run: RunRecord = { ...row, id: randomUUID(), state: 'queued', analysisStatus: 'pending', reportStatus: 'pending', diagnoseStop: request.diagnoseStop, taskFile: task.file, analysisInstructions: settings.analysisInstructions, snapshot: {
        task: safeTask(tasks[row.taskId]!),
        taskName: task.name, model: structuredClone(model),
        prompt: structuredClone(task.modes[request.mode].prompts.find(p => p.id === row.promptId)!),
        mode: request.mode, profile: resolveEnvironmentProfile(profile.environment), runProfile: { id: profile.id, name: profile.name },
        globals: settings,
      }, ...(request.analysisModelId ? { analysisModel: structuredClone(config.models.find(m => m.id === request.analysisModelId)!) } : {}) };
      this.liveTasks.set(run.id, structuredClone(tasks[row.taskId]!));
      return run;
    }) };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); this.start();
    return experiment;
  }
  async previewRetry(experiment: string, run: string): Promise<RetryPreview> {
    const original = this.find(experiment, run);
    if (!original.taskFile) throw new HttpError(400, '이 기록에는 원본 작업 파일이 없습니다. 새 실험을 구성하세요.');
    const current = safeTask(await this.store.task(original.taskFile));
    const { revision } = await this.store.read();
    const fields = new Set([...Object.keys(original.snapshot.task), ...Object.keys(current)]);
    const changedFields = [...fields].filter(key => JSON.stringify(original.snapshot.task[key as keyof Task]) !== JSON.stringify(current[key as keyof Task]));
    return { revision, changedFields, original: original.snapshot.task, current };
  }
  async retry(experimentId: string, runId: string, revision: string) {
    if (this.closed) throw new HttpError(503, '서버 종료 중입니다.');
    const original = this.find(experimentId, runId), preview = await this.previewRetry(experimentId, runId);
    if (['queued', 'running'].includes(original.state)) throw new HttpError(400, '진행 중인 실행은 먼저 종료하세요.');
    if (preview.revision !== revision) throw new HttpError(409, '작업이 변경되었습니다. 차이를 다시 확인하세요.');
    const fresh = await this.store.task(original.taskFile!);
    // Re-read secrets from the task file, retaining the original public execution conditions.
    const task = { ...structuredClone(original.snapshot.task), input: fresh.input };
    for (const key of Object.keys(task) as (keyof Task)[]) {
      if (JSON.stringify(task[key])?.includes('[REDACTED]')) Object.assign(task, { [key]: fresh[key] });
    }
    if ((await this.store.read()).revision !== revision) throw new HttpError(409, '작업이 변경되었습니다. 차이를 다시 확인하세요.');
    const kept = original.snapshot.globals;
    resolvePermissions({ machine: kept }, { permissions: { keyboard: kept.keyboard, screenreader: kept.screenreader } }, task, original.snapshot.mode, original.permissions);
    const run: RunRecord = { ...structuredClone(original), id: randomUUID(), state: 'queued', repeat: 1, analysisStatus: 'pending', reportStatus: 'pending', retryOf: { experiment: experimentId, run: runId } };
    for (const key of ['startedAt', 'endedAt', 'outcome', 'error', 'analysisError', 'reportError'] as const) delete run[key];
    run.snapshot.task = safeTask(task); this.liveTasks.set(run.id, task);
    const experiment: Experiment = { id: randomUUID(), createdAt: new Date().toISOString(), stopped: false, request: { taskIds: [run.taskId], modelIds: [run.modelId], promptIds: [run.promptId], profileIds: [run.profileId], repeats: 1, mode: run.snapshot.mode }, runs: [run] };
    await this.persist(experiment); this.experiments.unshift(experiment); this.changed(); this.start(); return experiment;
  }
  private start() {
    if (this.draining) return;
    this.draining = this.drain().catch(async () => {
      this.active?.controller.abort('storage-error'); this.active = undefined;
      for (const experiment of this.experiments) {
        for (const run of experiment.runs) if (['queued', 'running'].includes(run.state)) {
          run.state = 'interrupted'; run.endedAt = new Date().toISOString(); run.error = '실행 기록을 저장하지 못해 큐를 중단했습니다. 프로젝트 파일과 저장 공간을 확인하세요.';
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
      try {
        const trace = await this.executor(run, this.liveTasks.get(run.id)!, outDir, await this.store.credential(run.snapshot.model), controller.signal, event => this.runEvent?.(experiment.id, run.id, event));
        run.outcome = trace.outcome;
        run.state = controller.signal.aborted ? 'cancelled' : trace.outcome?.status === 'success' ? 'success' : trace.outcome?.status === 'failure' ? 'failure' : 'inconclusive';
        const done = await finalizeRun(trace, outDir, run.analysisModel ? { createAnalyzer: async () => {
          const m = run.analysisModel!;
          return new LlmTraceAnalyzer({ baseURL: resolveBaseURL(m), model: m.modelId, apiKey: await this.store.credential(m), timeoutMs: m.timeoutMs, instructions: run.analysisInstructions, signal: controller.signal });
        } } : {});
        run.analysisStatus = done.analysis.status;
        if (done.analysis.status === 'failed') run.analysisError = done.analysis.threw ? '분석을 완료하지 못했습니다. 원래 실행 결과는 유지됩니다.' : done.analysis.error ?? '분석 실패';
        run.reportStatus = done.report.status;
        if (done.report.status === 'failed') run.reportError = '보고서 생성 실패';
      } catch {
        run.state = controller.signal.aborted ? 'cancelled' : 'failure'; run.error = '실행 준비 또는 실행이 실패했습니다. 연결과 브라우저 설정을 확인하세요.';
        run.analysisStatus = 'skipped'; run.reportStatus = 'skipped';
      } finally {
        run.endedAt = new Date().toISOString(); this.liveTasks.delete(run.id); this.active = undefined; await this.persist(experiment); this.changed();
      }
    }
  }
  async cancel(experimentId: string, runId?: string) {
    const experiment = this.experiments.find(e => e.id === experimentId); if (!experiment) throw new HttpError(404, '실험을 찾을 수 없습니다.');
    if (runId && !experiment.runs.some(r => r.id === runId)) throw new HttpError(404, '실행을 찾을 수 없습니다.');
    if (!runId) experiment.stopped = true;
    for (const run of experiment.runs) if ((!runId || run.id === runId) && run.state === 'queued') { run.state = 'cancelled'; run.endedAt = new Date().toISOString(); run.analysisStatus = 'skipped'; run.reportStatus = 'skipped'; this.liveTasks.delete(run.id); }
    if (this.active?.experiment === experimentId && (!runId || this.active.run === runId)) this.active.controller.abort('requested');
    await this.persist(experiment); this.changed(); return experiment;
  }
  async close() { this.closed = true; this.active?.controller.abort('requested'); await this.draining; }
  async persist(experiment: Experiment) {
    const snapshot = structuredClone(experiment);
    const work = this.writes.then(async () => atomicJson(await this.store.file('.rawstep/experiments/' + experiment.id + '/experiment.json'), snapshot));
    this.writes = work.then(() => {}, () => {}); return work;
  }
  find(experiment: string, run: string) {
    const found = this.experiments.find(e => e.id === experiment)?.runs.find(r => r.id === run);
    if (!found) throw new HttpError(404, '실행을 찾을 수 없습니다.'); return found;
  }
  async trace(experiment: string, run: string) {
    this.find(experiment, run);
    return readTrace(await this.store.file('.rawstep/experiments/' + experiment + '/' + run + '/trace.json', true));
  }
}
function safeTask(task: Task): Task {
  const redacted = createRedactor(Object.values(task.input ?? {}))(task).value;
  return { ...redacted, ...(task.id ? { id: task.id } : {}), mode: task.mode, input: Object.fromEntries(Object.keys(task.input ?? {}).map(k => [k, '[REDACTED]'])) };
}
