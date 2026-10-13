import { comboExecutor, comboPlanner, isFilePlanner, credentialId, modelKeyRequired, type Combo, type Mode, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config.js';

/** How many times each profile runs a task unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/**
 * Why a model combo cannot run in a mode as far as the dashboard can tell without asking the server: no executor for the mode, no key
 * for the executor or (a planned combo in screen reader mode) the planner, or a keyboard executor that does not take the two
 * screenshots keyboard mode sends. Undefined when it looks ready. The analysis model never blocks a run.
 */
export function comboProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, combo: Pick<Combo, 'planner' | 'executors'>, mode: Mode): string | undefined {
  const missingKey = (model: Model) => modelKeyRequired(model) && !credentialStatus[credentialId(model)];
  const executor = comboExecutor(config, combo, mode);
  if (!executor) return t('runBox.problem.noExecutor', { mode: t(`sidebar.modes.${mode}`) });
  if (missingKey(executor)) return t('runBox.problem.noKey');
  if (mode === 'screenreader' && !isFilePlanner(combo.planner)) {
    const planner = comboPlanner(config, combo);
    if (!planner) return t('runBox.problem.noPlanner');
    if (missingKey(planner)) return t('runBox.problem.noPlannerKey');
  }
  if (mode === 'keyboard' && (!executor.inputs.includes('image') || executor.maxImages < 2)) return t('runBox.problem.needsImages');
  return undefined;
}

/** A run request from the run dialog: the tasks, the profiles each runs with (each in its own mode), and how many times. */
export type RunOptions = { taskIds: string[]; profileIds: string[]; repeats: number };

/**
 * Starts runs of tasks × profiles × repeats. The server checks every combination first; a reason one cannot run is thrown in words
 * a person can act on.
 */
export async function startRun(view: ConfigView, options: RunOptions): Promise<Experiment> {
  for (const id of options.profileIds) {
    const profile = view.config.profiles.find(item => item.id === id);
    if (!profile) throw new Error(t('quickRun.noProfile'));
    const problem = comboProblem(view.config, view.credentialStatus, profile, profile.mode);
    if (problem) throw new Error(`${profile.name}: ${problem}`);
  }
  const request: PlanRequest = { taskIds: options.taskIds, profileIds: options.profileIds, repeats: options.repeats, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
