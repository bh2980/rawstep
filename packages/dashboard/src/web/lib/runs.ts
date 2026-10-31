import type { ProjectConfig } from '@rawstep/project/config';
import type { Experiment, RunRecord } from '../../shared/config.js';
import { t } from '../i18n/index.js';

export type RunRef = { experiment: Experiment; run: RunRecord };

export const isLive = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
export const isFinished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';

/** The model ID alone of a model a run recorded ("connection · model ID" otherwise). */
export const shortModel = (model: { modelId?: string; name: string }): string => model.modelId || model.name;

/** What planned a run: its planner model's ID, or the plan file it read. */
export const runModelsName = (run: Pick<RunRecord, 'snapshot'>): string => {
  const { plannerModel, plannerPlan } = run.snapshot.spec;
  return plannerModel ? shortModel(plannerModel) : plannerPlan ? t('conditions.summary.planFile', { path: plannerPlan.file }) : '—';
};

export function runStartedAt(ref: RunRef): number {
  const time = Date.parse(ref.run.startedAt ?? ref.experiment.createdAt);
  return Number.isFinite(time) ? time : 0;
}

/** Every run of every experiment, newest first. */
export function flattenRuns(experiments: readonly Experiment[]): RunRef[] {
  return experiments
    .flatMap(experiment => experiment.runs.map(run => ({ experiment, run })))
    .sort((a, b) => runStartedAt(b) - runStartedAt(a) || b.run.repeat - a.run.repeat);
}

export function findRun(runs: readonly RunRef[], runId: string | undefined): RunRef | undefined {
  return runId ? runs.find(ref => ref.run.id === runId) : undefined;
}

export function durationSeconds(run: RunRecord): number | undefined {
  if (!run.startedAt || !run.endedAt) return undefined;
  const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : undefined;
}

export function runStepCount(run: RunRecord): number | undefined {
  return typeof run.outcome?.steps === 'number' ? run.outcome.steps : undefined;
}

export function runPath(experimentId: string, runId: string): string {
  return `/experiments/${experimentId}/runs/${runId}`;
}

export function screenshotUrl(experimentId: string, runId: string, eventId: string): string {
  return `/api${runPath(experimentId, runId)}/png/${encodeURIComponent(eventId)}`;
}

const recorded = (value: unknown): { id?: unknown; name?: unknown } => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** What a run ran with, read from what it recorded at the start (names as they were then), falling back to the project by id. */
export type RunConditionsView = {
  backend: string;
  /** The run profile's name; older runs recorded a preset or model combo instead. */
  profile: string;
  /** Model names by role; `analysis` never changes an outcome. A plan file run has no planner model. */
  planner?: string; analysis?: string;
};
export function runConditions(run: Pick<RunRecord, 'snapshot' | 'analysisModel'> & Partial<Pick<RunRecord, 'profileId'>>, config?: Partial<Pick<ProjectConfig, 'profiles'>>): RunConditionsView {
  const { spec } = run.snapshot, c = recorded(spec.conditions) as Record<string, unknown>;
  const named = [c.profile, c.preset, c.combo].map(item => recorded(item).name).find((name): name is string => typeof name === 'string');
  const profile = named ?? config?.profiles?.find(p => p.id === run.profileId)?.name ?? run.profileId ?? '—';
  return {
    backend: spec.backend, profile,
    ...(spec.plannerModel ? { planner: spec.plannerModel.name } : {}),
    ...(run.analysisModel ? { analysis: run.analysisModel.name } : {}),
  };
}

/** "Run #n" numbers of one task's runs: 1 is the oldest. Runs of other tasks are ignored. */
export function taskRunNumbers(runs: readonly RunRef[], taskId: string): Map<string, number> {
  const mine = runs.filter(ref => ref.run.taskId === taskId).sort((a, b) => runStartedAt(a) - runStartedAt(b) || a.run.repeat - b.run.repeat);
  return new Map(mine.map((ref, index) => [ref.run.id, index + 1]));
}

/** The task's current name (it may have been renamed after the run); the name recorded with the run when the task is gone. */
export function taskNameOf(run: Pick<RunRecord, 'taskId' | 'snapshot'>, tasks: readonly { id: string; name: string }[]): string {
  return tasks.find(task => task.id === run.taskId)?.name ?? run.snapshot.taskName;
}
