import { comboExecutor, comboPlanner, isFilePlanner, credentialId, modelKeyRequired, taskConditions, type Combo, type Mode, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config.js';

/** How many times a run button repeats the run unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/**
 * Why a model combo cannot run in a mode as far as the dashboard can tell without asking the server: no executor for the mode, no key
 * for the executor or (a planned combo in screen reader mode) the planner, or a keyboard executor that does not take the two
 * screenshots keyboard mode sends. Undefined when it looks ready. The analysis model never blocks a run.
 */
export function comboProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, combo: Combo, mode: Mode): string | undefined {
  const missingKey = (model: Model) => modelKeyRequired(model) && !credentialStatus[credentialId(model)];
  const executor = comboExecutor(config, combo, mode);
  if (!executor) return t('runBox.problem.noExecutor', { mode: t(`sidebar.modes.${mode}`) });
  if (missingKey(executor)) return t('runBox.problem.noKey');
  if (combo.structure === 'planned' && mode === 'screenreader' && !isFilePlanner(combo.planner)) {
    const planner = comboPlanner(config, combo);
    if (!planner) return t('runBox.problem.noPlanner');
    if (missingKey(planner)) return t('runBox.problem.noPlannerKey');
  }
  if (mode === 'keyboard' && (!executor.inputs.includes('image') || executor.maxImages < 2)) return t('runBox.problem.needsImages');
  return undefined;
}

/** The conditions of one run by id; any left out are the task's own (its choice, its preset's, the first shared item). */
export type RunConditionIds = { comboId: string; actionSetId: string; pageEnvironmentId: string; atEnvironmentId: string };
/** A mode is always chosen by a person; the conditions default to the task's own and the repeats to three. */
export type RunOptions = { mode: Mode; repeats?: number; conditions?: Partial<RunConditionIds> };

/**
 * Starts runs of one task in one mode under one set of conditions (the task's own unless given), three repeats unless told
 * otherwise. The server checks the combination first; a reason it cannot run is thrown in words a person can act on.
 */
export async function startRun(view: ConfigView, taskId: string, options: RunOptions): Promise<Experiment> {
  const { mode } = options, task = view.config.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(t('quickRun.noTask'));
  const own = taskConditions(view.config, task), picked = options.conditions ?? {};
  const find = <T extends { id: string }>(list: readonly T[], id: string | undefined, fallback: T) => list.find(item => item.id === id) ?? fallback;
  const combo = find(view.config.combos, picked.comboId, own.combo);
  const problem = comboProblem(view.config, view.credentialStatus, combo, mode);
  if (problem) throw new Error(problem);
  const request: PlanRequest = {
    taskIds: [taskId], modes: [mode], comboIds: [combo.id],
    actionSetIds: [find(view.config.actionSets, picked.actionSetId, own.actionSet).id],
    pageEnvironmentIds: [find(view.config.pageEnvironments, picked.pageEnvironmentId, own.pageEnvironment).id],
    atEnvironmentIds: [find(view.config.atEnvironments, picked.atEnvironmentId, own.atEnvironment).id],
    repeats: options.repeats ?? QUICK_RUN_REPEATS, revision: view.revision,
  };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
