import { comboPlanner, isFilePlanner, credentialId, modelKeyRequired, type Combo, type Model, type Profile, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api.js';
import { serverText, t } from '../i18n/index.js';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config.js';

/** How many times each profile runs a task unless a person picks another number. */
export const QUICK_RUN_REPEATS = 1;

/**
 * The one profile the run dialog starts with: the last single profile a person ran if it still exists, else the first profile that
 * plans with a model and can run (a written plan file is a demo, not what most people mean to run), else the first one that can run,
 * else the first profile. A multi-profile pick is never restored — running several profiles at once has to be chosen each time.
 */
export function defaultRunProfileId<P extends Pick<Profile, 'id' | 'planner'>>(profiles: readonly P[], lastId?: string, canRun: (profile: P) => boolean = () => true): string | undefined {
  return (profiles.find(profile => profile.id === lastId) ?? profiles.find(profile => !isFilePlanner(profile.planner) && canRun(profile)) ?? profiles.find(canRun) ?? profiles[0])?.id;
}

/**
 * Why a model combo cannot run as far as the dashboard can tell without asking the server: no planner, or no key for the planner.
 * Undefined when it looks ready. The analysis model never blocks a run.
 */
export function comboProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, combo: Pick<Combo, 'planner'>): string | undefined {
  const missingKey = (model: Model) => modelKeyRequired(model) && !credentialStatus[credentialId(model)];
  if (!isFilePlanner(combo.planner)) {
    const planner = comboPlanner(config, combo);
    if (!planner) return t('runBox.problem.noPlanner');
    if (missingKey(planner)) return t('runBox.problem.noPlannerKey');
  }
  return undefined;
}

/** A run request from the run dialog: the tasks, the profiles each runs with (one list for all, or a list per task), and how many times. */
export type RunOptions = { taskIds: string[]; profileIds: string[]; /** Profiles for some tasks instead of `profileIds` (each task with its own usual profiles). */ profilesByTask?: Record<string, string[]>; repeats: number; /** What this batch is for, in the person's words. */ note?: string };

/**
 * Starts runs of tasks × profiles × repeats. The server checks every combination first; a reason one cannot run is thrown in words
 * a person can act on.
 */
export async function startRun(view: ConfigView, options: RunOptions): Promise<Experiment> {
  for (const id of new Set([...options.profileIds, ...Object.values(options.profilesByTask ?? {}).flat()])) {
    const profile = view.config.profiles.find(item => item.id === id);
    if (!profile) throw new Error(t('quickRun.noProfile'));
    const problem = comboProblem(view.config, view.credentialStatus, profile);
    if (problem) throw new Error(`${profile.name}: ${problem}`);
  }
  const request: PlanRequest = { taskIds: options.taskIds, profileIds: options.profileIds, ...(options.profilesByTask ? { profilesByTask: options.profilesByTask } : {}), repeats: options.repeats, revision: view.revision, ...(options.note?.trim() ? { note: options.note.trim() } : {}) };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ? serverText(blocked.reason) : t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
