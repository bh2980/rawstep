import { t } from '../i18n';
import type { Permissions, Policy } from '../../shared/config';

/** "Tab·Shift+Tab·Enter" for the allowed actions of one mode; a "none" label when nothing is allowed. */
export function permissionsSummary(permissions: Permissions): string {
  const actions = [...permissions.keys, ...permissions.intents];
  return actions.length ? actions.join('·') : t('profiles.noActions');
}

/** One short phrase describing how stuck detection behaves, e.g. the automatic setting. */
export function stuckSummary(policy: Pick<Policy, 'repetitionGuard'>): string {
  return t(`profiles.stuck.${policy.repetitionGuard}`);
}

/** One-line summary of a run profile for lists. */
export function profileSummary(profile: { permissions: { keyboard: Permissions }; policy: Policy }): string {
  return t('profiles.summary', { keyboard: permissionsSummary(profile.permissions.keyboard), stuck: stuckSummary(profile.policy) });
}

/** The policy values shown as "inherited" on a task that does not override them. */
export function policyInheritedSummary(policy: Policy): string {
  return t('taskEditor.inheritedPolicy', {
    stuck: stuckSummary(policy), history: policy.historyLimit, visits: policy.maxStateVisits, unchanged: policy.maxUnchangedTransitions,
    giveUp: policy.modelGiveUp ? t('profiles.on') : t('profiles.off'), focusGate: policy.focusGate ? t('profiles.on') : t('profiles.off'),
  });
}
