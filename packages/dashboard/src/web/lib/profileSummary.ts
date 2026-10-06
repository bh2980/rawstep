import { t } from '../i18n';
import type { Permissions, Policy, RunProfile } from '@rawstep/project/config';
import { keyboardPreset, screenreaderPreset, type ActionCapabilities } from './presets';

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
  return t('taskEditor.inheritedPolicy', {
    stuck: stuckSummary(policy), history: policy.historyLimit, visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions,
    giveUp: policy.modelGiveUp ? t('profiles.on') : t('profiles.off'), focusGate: policy.focusGate ? t('profiles.on') : t('profiles.off'),
  });
}
