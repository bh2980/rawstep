import { credentialId, modelKeyRequired, profileModel, taskProfile, type Mode, type ProjectConfig, type RunProfile } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config';

/** How many times a run button repeats the run unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/**
 * Why a profile cannot run in a mode as far as the dashboard can tell without asking the server: no model, no key, or a model that
 * does not take what the mode sends (keyboard mode sends two screenshots). Undefined when it looks ready.
 */
export function profileProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, profile: RunProfile, mode: Mode): string | undefined {
  const model = profileModel(config, profile);
  if (!model) return t('quickRun.noProfileModel');
  if (modelKeyRequired(model) && !credentialStatus[credentialId(model)]) return t('quickRun.noKey');
  if (mode === 'keyboard' && (!model.inputs.includes('image') || model.maxImages < 2)) return t('quickRun.needsImages');
  return undefined;
}

/** A mode is always chosen by a person; the profile and repeats default to the task's own profile and three runs. */
export type RunOptions = { mode: Mode; profileId?: string; repeats?: number };

/**
 * Starts a run of one task in the chosen mode with a run profile (the task's own unless another is given; the profile brings the model),
 * the task's first prompt for the mode and three repeats unless told otherwise. Throws with a reason a person can act on.
 */
export async function startRun(view: ConfigView, taskId: string, options: RunOptions): Promise<Experiment> {
  const { mode } = options, task = view.config.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(t('quickRun.noTask'));
  const profile = view.config.profiles.find(p => p.id === options.profileId) ?? taskProfile(view.config, task);
  const problem = profileProblem(view.config, view.credentialStatus, profile, mode);
  if (problem) throw new Error(problem);
  const request: PlanRequest = { taskIds: [taskId], profileIds: [profile.id], promptIds: [task.modes[mode].prompts[0]!.id], mode, repeats: options.repeats ?? QUICK_RUN_REPEATS, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
