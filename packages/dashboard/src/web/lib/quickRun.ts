import { credentialId, modelKeyRequired, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config';

/** How many times a task row's run button repeats the run. */
export const QUICK_RUN_REPEATS = 3;

/** Whether a model can pick actions in keyboard mode, which sends screenshots: decision role, images, two of them. */
const keyboardCapable = (model: Model) => model.roles.includes('decision') && model.inputs.includes('image') && model.maxImages >= 2;

/** The first model that can run in keyboard mode and has the key it needs. */
export function defaultModel(config: Pick<ProjectConfig, 'models'>, credentialStatus: Record<string, boolean>): Model | undefined {
  return config.models.find(model => keyboardCapable(model) && (!modelKeyRequired(model) || credentialStatus[credentialId(model)]));
}

/**
 * Starts the run a task row offers: the first usable model, the task's own run profile, keyboard mode,
 * the task's first prompt and three repeats. Throws with a reason a person can act on.
 */
export async function startDefaultRun(view: ConfigView, taskId: string): Promise<Experiment> {
  const model = defaultModel(view.config, view.credentialStatus), task = view.config.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(t('quickRun.noTask'));
  if (!model) throw new Error(t('quickRun.noModel'));
  const request: PlanRequest = { taskIds: [taskId], modelIds: [model.id], promptIds: [task.modes.keyboard.prompts[0]!.id], mode: 'keyboard', repeats: QUICK_RUN_REPEATS, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
