import { agentExecutor, agentPlanner, credentialId, modelKeyRequired, taskAgent, taskEnvironment, type Agent, type Mode, type Model, type ProjectConfig } from '@rawstep/project/config';
import { api } from '../api';
import { t } from '../i18n';
import type { Combination, ConfigView, Experiment, PlanRequest } from '../../shared/config';

/** How many times a run button repeats the run unless a person picks another number. */
export const QUICK_RUN_REPEATS = 3;

/**
 * Why an agent cannot run in a mode as far as the dashboard can tell without asking the server: no executor for the mode, no key for
 * the executor or (screen reader mode) the planner, or a keyboard executor that does not take the two screenshots keyboard mode sends.
 * Undefined when it looks ready.
 */
export function agentProblem(config: Pick<ProjectConfig, 'connections'>, credentialStatus: Record<string, boolean>, agent: Agent, mode: Mode): string | undefined {
  const missingKey = (model: Model) => modelKeyRequired(model) && !credentialStatus[credentialId(model)];
  const executor = agentExecutor(config, agent, mode);
  if (!executor) return t('agentRun.problem.noExecutor', { mode: t(`sidebar.modes.${mode}`) });
  if (missingKey(executor)) return t('agentRun.problem.noKey');
  const planner = mode === 'screenreader' ? agentPlanner(config, agent) : undefined;
  if (planner && missingKey(planner)) return t('agentRun.problem.noPlannerKey');
  if (mode === 'keyboard' && (!executor.inputs.includes('image') || executor.maxImages < 2)) return t('agentRun.problem.needsImages');
  return undefined;
}

/** A mode is always chosen by a person; the agent, environment and repeats default to the task's own and three runs. */
export type RunOptions = { mode: Mode; agentId?: string; environmentId?: string; repeats?: number };

/**
 * Starts a run of one task in the chosen mode with an agent (the task's own unless another is given; the agent brings the models and
 * their instructions) in an environment (likewise), three repeats unless told otherwise. Throws with a reason a person can act on.
 */
export async function startRun(view: ConfigView, taskId: string, options: RunOptions): Promise<Experiment> {
  const { mode } = options, task = view.config.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(t('quickRun.noTask'));
  const agent = view.config.agents.find(a => a.id === options.agentId) ?? taskAgent(view.config, task);
  const environment = view.config.environments.find(e => e.id === options.environmentId) ?? taskEnvironment(view.config, task);
  const problem = agentProblem(view.config, view.credentialStatus, agent, mode);
  if (problem) throw new Error(problem);
  const request: PlanRequest = { taskIds: [taskId], agentIds: [agent.id], environmentIds: [environment.id], mode, repeats: options.repeats ?? QUICK_RUN_REPEATS, revision: view.revision };
  const blocked = (await api<Combination[]>('/plan', { method: 'POST', body: request })).find(row => !row.supported);
  if (blocked) throw new Error(blocked.reason ?? t('quickRun.unsupported'));
  return api<Experiment>('/experiments', { method: 'POST', body: request });
}
