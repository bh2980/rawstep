import { comboExecutor, comboPlanner, isFilePlanner, credentialId, modelKeyRequired, type Combo, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config.js';

/** How many times each profile runs a task unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/**
 * Why a model combo cannot run as far as the dashboard can tell without asking the server: no executor, or no key for the executor or
 * the planner. Undefined when it looks ready. The analysis model never blocks a run.
 */
export function comboProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, combo: Pick<Combo, 'planner' | 'executor'>): string | undefined {
  const missingKey = (model: Model) => modelKeyRequired(model) && !credentialStatus[credentialId(model)];
  const executor = comboExecutor(config, combo);
  if (!executor) return t('runBox.problem.noExecutor');
  if (missingKey(executor)) return t('runBox.problem.noKey');
  if (!isFilePlanner(combo.planner)) {
    const planner = comboPlanner(config, combo);
    if (!planner) return t('runBox.problem.noPlanner');
    if (missingKey(planner)) return t('runBox.problem.noPlannerKey');
  }
  return undefined;
}

/** A run request from the run dialog: the tasks, the profiles each runs with, and how many times. */
export type RunOptions = { taskIds: string[]; profileIds: string[]; repeats: number; /** What this batch is for, in the person's words. */ note?: string };

/**
 * Starts runs of tasks × profiles × repeats. The server checks every combination first; a reason one cannot run is thrown in words
 * a person can act on.
 */
export async function startRun(view: ConfigView, options: RunOptions): Promise<Experiment> {
  for (const id of options.profileIds) {
    const profile = view.config.profiles.find(item => item.id === id);
    if (!profile) throw new Error(t('quickRun.noProfile'));
    const problem = comboProblem(view.config, view.credentialStatus, profile);
    if (problem) throw new Error(`${profile.name}: ${problem}`);
  }
  const request: PlanRequest = { taskIds: options.taskIds, profileIds: options.profileIds, repeats: options.repeats, revision: view.revision, ...(options.note?.trim() ? { note: options.note.trim() } : {}) };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
