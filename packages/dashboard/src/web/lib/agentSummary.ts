import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { t } from '../i18n/index.js';
import type { Agent, Connection, Mode, Permissions, Policy } from '@rawstep/project/config';
import { keyboardPreset, screenreaderPreset, type ActionCapabilities } from './presets.js';

/** One short phrase describing how stuck detection behaves, e.g. the automatic setting. */
export function stuckSummary(policy: Pick<Policy, 'repetitionGuard'>): string {
  return t(`agents.stuck.${policy.repetitionGuard}`);
}

const keyboardName = (permissions: Permissions) => {
  const preset = keyboardPreset(permissions);
  return preset === 'custom' ? t('presets.keyboard.custom.summary', { count: permissions.keys.length }) : t(`presets.keyboard.${preset}.name`);
};
const screenreaderName = (permissions: Permissions, capabilities: ActionCapabilities) => {
  const preset = screenreaderPreset(permissions, capabilities);
  return preset === 'custom' ? t('presets.screenreader.custom.summary', { count: permissions.intents.length }) : t(`presets.screenreader.${preset}.name`);
};

/** One-line summary of an agent for lists: its models, then the allowed-action presets. */
export function agentSummary(agent: Pick<Agent, 'executors' | 'planner' | 'permissions'>, connections: readonly Connection[], screenreaderCapabilities: ActionCapabilities): string {
  return `${agentModelsLine(agent, connections)} · ${t('agents.summaryActions', { keyboard: keyboardName(agent.permissions.keyboard), screenreader: screenreaderName(agent.permissions.screenreader, screenreaderCapabilities) })}`;
}

/** The policy values shown as "inherited" on a task that does not override them. */
export function policyInheritedSummary(policy: Policy): string {
  return t('taskSettings.inheritedPolicy', {
    stuck: stuckSummary(policy), history: policy.historyLimit, visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions,
    giveUp: policy.modelGiveUp ? t('agents.on') : t('agents.off'), focusGate: policy.focusGate ? t('agents.on') : t('agents.off'),
  });
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** The page size an environment runs at: its own viewport, a built-in preset it names, or the default. */
export function environmentViewport(profile: unknown, presets: Record<string, unknown>): { width: number; height: number } {
  const environment = typeof profile === 'string' ? record(presets[profile]) : record(profile);
  const viewport = record(environment.viewport);
  return { width: positive(viewport.width, RAWSTEP_DEFAULTS.viewport.width), height: positive(viewport.height, RAWSTEP_DEFAULTS.viewport.height) };
}

export type AgentCondition = { id: 'screenreader' | 'keyboard' | 'planner' | 'actions' | 'stuck'; value: string };

/** "connection · model ID" of a model choice, or undefined when there is none or its connection is gone. */
export function choiceName(choice: { connectionId: string; modelId: string } | undefined, connections: readonly Connection[]): string | undefined {
  const connection = choice && connections.find(c => c.id === choice.connectionId);
  return connection && choice.modelId ? `${connection.name} · ${choice.modelId}` : undefined;
}
/**
 * An agent's models in one line. With a mode: that mode's executor, plus the planner in screen reader mode. Without: every executor
 * by mode, plus the planner.
 */
export function agentModelsLine(agent: Pick<Agent, 'executors' | 'planner'>, connections: readonly Connection[], mode?: Mode): string {
  const planner = choiceName(agent.planner, connections);
  if (mode) {
    const executor = choiceName(agent.executors[mode], connections);
    if (!executor) return t('agents.condition.noExecutor');
    return planner && mode === 'screenreader' ? t('agents.withPlanner', { model: executor, planner }) : executor;
  }
  const parts = (['screenreader', 'keyboard'] as const).flatMap(m => { const name = choiceName(agent.executors[m], connections); return name ? [t('agents.executorOf', { mode: t(`sidebar.modes.${m}`), model: name })] : []; });
  if (!parts.length) return t('agents.condition.noExecutor');
  return [...(planner ? [t('agents.plannerOf', { model: planner })] : []), ...parts].join(' · ');
}
/**
 * An agent read as an experiment condition: who decides in each mode, the planner, what it may do and when a run counts as blocked.
 * These lines are what two runs of the same task differ by when only the agent differs.
 */
export function agentConditions(agent: Agent, screenreader: ActionCapabilities, connections: readonly Connection[]): AgentCondition[] {
  const { policy } = agent, planner = choiceName(agent.planner, connections);
  return [
    { id: 'planner', value: planner ? t('agents.condition.planner', { model: planner, replans: policy.maxReplans }) : t('agents.condition.plannerNone') },
    { id: 'screenreader', value: choiceName(agent.executors.screenreader, connections) ?? t('agents.condition.noExecutor') },
    { id: 'keyboard', value: choiceName(agent.executors.keyboard, connections) ?? t('agents.condition.noExecutor') },
    { id: 'actions', value: t('agents.condition.actions', { keyboard: keyboardName(agent.permissions.keyboard), screenreader: screenreaderName(agent.permissions.screenreader, screenreader) }) },
    { id: 'stuck', value: t('agents.condition.stuck', { guard: stuckSummary(policy), visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions, giveUp: t(policy.modelGiveUp ? 'agents.condition.giveUpOn' : 'agents.condition.giveUpOff') }) },
  ];
}
