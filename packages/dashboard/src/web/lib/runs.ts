import type { Mode, ProjectConfig } from '@rawstep/project/config';
import type { Experiment, RunRecord } from '../../shared/config.js';
import { t } from '../i18n/index.js';

export type RunRef = { experiment: Experiment; run: RunRecord };

export const isLive = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
export const isFinished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';

/** The model ID alone of a model a run recorded ("connection · model ID" otherwise). */
export const shortModel = (model: { modelId?: string; name: string }): string => model.modelId || model.name;

/** The models a run used, by role: "계획 gemini → 실행 jev" with a planner, otherwise the executor alone. */
export const runModelsName = (run: Pick<RunRecord, 'snapshot'>): string => {
  const { model, plannerModel } = run.snapshot.spec;
  return plannerModel ? t('runConditions.plannedModels', { planner: shortModel(plannerModel), executor: shortModel(model) }) : shortModel(model);
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

type Named = readonly { id: string; name: string }[];
type Recorded = { id?: string; name?: string };
const recorded = (value: unknown): Recorded & Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Recorded & Record<string, unknown> : {};

/** What a run ran under, read from what it recorded at the start (names as they were then), falling back to the project by id. */
export type RunConditionsView = {
  mode: Mode; structure: 'solo' | 'planned';
  combo: string; actionSet: string; pageEnvironment: string; atEnvironment: string; backend: string; preset?: string;
  /** Model names by role; `analysis` never changes an outcome. */
  executor: string; planner?: string; analysis?: string;
};
export function runConditions(run: Pick<RunRecord, 'snapshot' | 'comboId' | 'actionSetId' | 'pageEnvironmentId' | 'atEnvironmentId' | 'presetId' | 'structure' | 'analysisModel'>,
  config?: Partial<Pick<ProjectConfig, 'combos' | 'actionSets' | 'pageEnvironments' | 'atEnvironments' | 'presets'>>): RunConditionsView {
  const { spec } = run.snapshot, c = recorded(spec.conditions);
  const name = (key: string, list: Named | undefined, id: string | undefined) => {
    const own = recorded(c[key]).name;
    return typeof own === 'string' ? own : list?.find(item => item.id === id)?.name ?? id ?? '—';
  };
  const combo = recorded(c.combo), preset = recorded(c.preset);
  const structure = combo.structure === 'planned' || combo.structure === 'solo' ? combo.structure : run.structure ?? 'solo';
  const presetName = typeof preset.name === 'string' ? preset.name : config?.presets?.find(p => p.id === run.presetId)?.name;
  return {
    mode: spec.mode, structure,
    combo: name('combo', config?.combos, run.comboId), actionSet: name('actionSet', config?.actionSets, run.actionSetId),
    pageEnvironment: name('pageEnvironment', config?.pageEnvironments, run.pageEnvironmentId), atEnvironment: name('atEnvironment', config?.atEnvironments, run.atEnvironmentId),
    backend: spec.backend, ...(presetName ? { preset: presetName } : {}),
    executor: spec.model.name, ...(spec.plannerModel ? { planner: spec.plannerModel.name } : {}),
    ...(run.analysisModel ? { analysis: run.analysisModel.name } : typeof combo.analysis === 'string' ? { analysis: combo.analysis } : {}),
  };
}
/** "스크린리더 · 계획 + 실행 · 숙련 사용자 · Default · 모의 VoiceOver": the conditions in one line, screen reader runs naming their assistive technology. */
export function runConditionsLine(view: RunConditionsView): string {
  return [t(`sidebar.modes.${view.mode}`), view.combo, view.actionSet, view.pageEnvironment, ...(view.mode === 'screenreader' ? [view.atEnvironment] : [])].join(' · ');
}

/** "Run #n" numbers of one task's runs: 1 is the oldest. Runs of other tasks are ignored. */
export function taskRunNumbers(runs: readonly RunRef[], taskId: string): Map<string, number> {
  const mine = runs.filter(ref => ref.run.taskId === taskId).sort((a, b) => runStartedAt(a) - runStartedAt(b) || a.run.repeat - b.run.repeat);
  return new Map(mine.map((ref, index) => [ref.run.id, index + 1]));
}

/** The finished run that reached the goal in the fewest actions; the first one wins a tie. */
export function fastestRun(runs: readonly RunRef[]): { ref: RunRef; steps: number } | undefined {
  let best: { ref: RunRef; steps: number } | undefined;
  for (const ref of runs) {
    const steps = runStepCount(ref.run);
    if (ref.run.state === 'success' && steps !== undefined && (!best || steps < best.steps)) best = { ref, steps };
  }
  return best;
}

/** The task's current name (it may have been renamed after the run); the name recorded with the run when the task is gone. */
export function taskNameOf(run: Pick<RunRecord, 'taskId' | 'snapshot'>, tasks: readonly { id: string; name: string }[]): string {
  return tasks.find(task => task.id === run.taskId)?.name ?? run.snapshot.taskName;
}
