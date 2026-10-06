import { credentialId, modelKeyRequired, type Mode, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config';

/** How many times a run button repeats the run unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/** Whether a model can pick actions in a mode: the decision role and the inputs the mode feeds it (keyboard mode sends two images). */
const supportsMode = (model: Model, mode: Mode) => model.roles.includes('decision') && (mode === 'keyboard' ? model.inputs.includes('image') && model.maxImages >= 2 : model.inputs.includes('text'));

/** The models that can run in a mode and have the key they need. */
export function usableModels(config: Pick<ProjectConfig, 'models'>, credentialStatus: Record<string, boolean>, mode: Mode = 'keyboard'): Model[] {
  return config.models.filter(model => supportsMode(model, mode) && (!modelKeyRequired(model) || credentialStatus[credentialId(model)]));
}

export type RunOptions = { modelId?: string; mode?: Mode; repeats?: number };

/**
 * Starts a run of one task: the chosen or first usable model, the task's own run profile, the task's first prompt for the mode,
 * keyboard mode and three repeats unless told otherwise. Throws with a reason a person can act on.
 */
export async function startRun(view: ConfigView, taskId: string, options: RunOptions = {}): Promise<Experiment> {
  const mode = options.mode ?? 'keyboard', task = view.config.tasks.find(item => item.id === taskId);
  const model = options.modelId ? view.config.models.find(item => item.id === options.modelId) : usableModels(view.config, view.credentialStatus, mode)[0];
  if (!task) throw new Error(t('quickRun.noTask'));
  if (!model) throw new Error(t('quickRun.noModel'));
  const request: PlanRequest = { taskIds: [taskId], modelIds: [model.id], promptIds: [task.modes[mode].prompts[0]!.id], mode, repeats: options.repeats ?? QUICK_RUN_REPEATS, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
