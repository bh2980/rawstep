import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { t } from '../i18n/index.js';
import type { Connection, Permissions, Policy, RunProfile } from '@rawstep/project/config';
import { keyboardPreset, screenreaderPreset, type ActionCapabilities } from './presets.js';

/** One short phrase describing how stuck detection behaves, e.g. the automatic setting. */
export function stuckSummary(policy: Pick<Policy, 'repetitionGuard'>): string {
  return t(`profiles.stuck.${policy.repetitionGuard}`);
}

const keyboardName = (permissions: Permissions) => {
  const preset = keyboardPreset(permissions);
  return preset === 'custom' ? t('presets.keyboard.custom.summary', { count: permissions.keys.length }) : t(`presets.keyboard.${preset}.name`);
};
const screenreaderName = (permissions: Permissions, capabilities: ActionCapabilities) => {
  const preset = screenreaderPreset(permissions, capabilities);
  return preset === 'custom' ? t('presets.screenreader.custom.summary', { count: permissions.intents.length }) : t(`presets.screenreader.${preset}.name`);
};

/** One-line summary of a run profile for lists: the allowed-action presets and the stuck detection. */
export function profileSummary(profile: Pick<RunProfile, 'permissions' | 'policy'>, screenreaderCapabilities: ActionCapabilities): string {
  return t('profiles.summary', { keyboard: keyboardName(profile.permissions.keyboard), screenreader: screenreaderName(profile.permissions.screenreader, screenreaderCapabilities), stuck: stuckSummary(profile.policy) });
}

/** The policy values shown as "inherited" on a task that does not override them. */
export function policyInheritedSummary(policy: Policy): string {
  return t('taskSettings.inheritedPolicy', {
    stuck: stuckSummary(policy), history: policy.historyLimit, visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions,
    giveUp: policy.modelGiveUp ? t('profiles.on') : t('profiles.off'), focusGate: policy.focusGate ? t('profiles.on') : t('profiles.off'),
  });
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** The page size a profile runs at: its own environment, a built-in preset it names, or the default. */
export function profileViewport(profile: Pick<RunProfile, 'environment'>, presets: Record<string, unknown>): { width: number; height: number } {
  const environment = typeof profile.environment === 'string' ? record(presets[profile.environment]) : record(profile.environment);
  const viewport = record(environment.viewport);
  return { width: positive(viewport.width, RAWSTEP_DEFAULTS.viewport.width), height: positive(viewport.height, RAWSTEP_DEFAULTS.viewport.height) };
}

export type ProfileCondition = { id: 'model' | 'actions' | 'stuck' | 'viewport' | 'analysis'; value: string };

/** "connection · model ID" of a model choice, or undefined when there is none or its connection is gone. */
export function choiceName(choice: { connectionId: string; modelId: string } | undefined, connections: readonly Connection[]): string | undefined {
  const connection = choice && connections.find(c => c.id === choice.connectionId);
  return connection && choice.modelId ? `${connection.name} · ${choice.modelId}` : undefined;
}

/**
 * A run profile read as an experiment condition: the model, what it may do, when a run counts as blocked, the page it runs on and how
 * it is analysed. These lines are what two runs of the same task differ by when only the profile differs.
 */
export function profileConditions(profile: Pick<RunProfile, 'model' | 'analysisModel' | 'permissions' | 'policy' | 'environment' | 'analysisInstructions'>, screenreader: ActionCapabilities, presets: Record<string, unknown>, connections: readonly Connection[]): ProfileCondition[] {
  const { width, height } = profileViewport(profile, presets), { policy } = profile;
  const analysis = choiceName(profile.analysisModel, connections);
  return [
    { id: 'model', value: choiceName(profile.model, connections) ?? t('profiles.condition.noModel') },
    { id: 'actions', value: t('profiles.condition.actions', { keyboard: keyboardName(profile.permissions.keyboard), screenreader: screenreaderName(profile.permissions.screenreader, screenreader) }) },
    { id: 'stuck', value: t('profiles.condition.stuck', { guard: stuckSummary(policy), visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions, giveUp: t(policy.modelGiveUp ? 'profiles.condition.giveUpOn' : 'profiles.condition.giveUpOff') }) },
    { id: 'viewport', value: t('profiles.condition.viewport', { width, height }) },
    { id: 'analysis', value: analysis ? t('profiles.condition.analysisLlm', { model: analysis }) : t('profiles.condition.analysisRules') },
  ];
}
