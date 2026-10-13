import { comboExecutor, comboPlanner, isFilePlanner, credentialId, modelKeyRequired, taskProfile, type Combo, type Mode, type Model, type ProjectConfig } from '@rawstep/project/config';
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
export function comboProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, combo: Pick<Combo, 'structure' | 'planner' | 'executors'>, mode: Mode): string | undefined {
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

/** A mode is always chosen by a person; the run profile defaults to the task's own and the repeats to three. */
export type RunOptions = { mode: Mode; repeats?: number; profileId?: string };

/**
 * Starts runs of one task in one mode with one run profile (the task's own unless given), three repeats unless told
 * otherwise. The server checks the combination first; a reason it cannot run is thrown in words a person can act on.
 */
export async function startRun(view: ConfigView, taskId: string, options: RunOptions): Promise<Experiment> {
  const { mode } = options, task = view.config.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(t('quickRun.noTask'));
  const profile = view.config.profiles.find(item => item.id === options.profileId) ?? taskProfile(view.config, task);
  const problem = comboProblem(view.config, view.credentialStatus, profile, mode);
  if (problem) throw new Error(problem);
  const request: PlanRequest = { taskIds: [taskId], modes: [mode], profileIds: [profile.id], repeats: options.repeats ?? QUICK_RUN_REPEATS, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
