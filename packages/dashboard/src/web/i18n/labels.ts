import type { ObservedChange } from '../../shared/api.js';
import { i18n, t } from './index.js';
import { core } from './locales/ko/core.js';
import { shell } from './locales/ko/shell.js';

/** Own-property check so recorded values like 'constructor' never resolve to inherited members. */
const has = (table: object, key: string) => Object.hasOwn(table, key);

/** `t` for a key built at runtime from a value that was already checked against its lookup table. */
const lookup = (key: string): string => i18n.t(key as 'app.title');

export function hintKindLabel(kind: string): string {
  return has(core.hints.kinds, kind) ? lookup(`hints.kinds.${kind}`) : kind;
}

/** Korean word for an accessibility role such as 'button'; unknown roles are shown as recorded. */
export function roleLabel(role: string): string {
  return has(shell.roles, role) ? lookup(`roles.${role}`) : role;
}

/** The page element a finding or hint is about: `버튼 “Checkout”`, or just the role when it has no name. */
export function targetLabel(target: { role: string; name?: string } | undefined): string {
  if (!target) return t('taskList.wholePage');
  return target.name ? t('hints.text.targetNamed', { role: roleLabel(target.role), name: target.name }) : roleLabel(target.role);
}

/** What kind of friction a finding is and where: `키 입력 과다 · 버튼 “Checkout”`. */
export function findingLabel(finding: { kind: string; target?: { role: string; name?: string } }): string {
  return t('taskList.finding', { kind: hintKindLabel(finding.kind), target: targetLabel(finding.target) });
}

/** Korean label for a recorded outcome reason; unknown reasons are shown as recorded. */
export function outcomeReasonLabel(reason: string): string {
  return has(core.run.outcomeReasons, reason) ? lookup(`run.outcomeReasons.${reason}`) : reason;
}

/** Korean text for a known limitation sentence; unknown ones are shown as recorded. */
export function limitationLabel(text: string): string {
  // Looked up in the core object, not through t: the keys are English sentences containing '.', ';' and ':'.
  const texts: Record<string, string> = core.hints.limitationTexts;
  return has(texts, text) ? texts[text]! : text;
}

export function runStateLabel(state: string): string {
  return has(core.runStates, state) ? lookup(`runStates.${state}`) : state;
}

/** Label for a recorded intent such as 'next'; unknown intents are shown as recorded. */
export function intentLabel(intent: string): string {
  return has(core.steps.intents, intent) ? lookup(`steps.intents.${intent}`) : intent;
}

/** Step difference against the reference run: `extra` is this run's steps minus the reference's. */
export function versusLabel(extra: number): string {
  if (extra === 0) return t('run.versusSame');
  return extra > 0 ? t('run.versusMore', { extra }) : t('run.versusLess', { extra });
}

/** Short text for one page-observer change, for chips in the step timeline. */
export function describeChange(change: ObservedChange): string {
  const target = describeTarget(change);
  switch (change.kind) {
    case 'focus': return t('observed.focus', { target });
    case 'focus-lost': return t('observed.focusLost');
    case 'page-blur': return t('observed.pageBlur');
    case 'page-focus': return t('observed.pageFocus');
    case 'live-region': return change.text ? t('observed.liveRegion', { text: change.text }) : t('observed.liveRegionEmpty');
    case 'appeared': return change.role === 'dialog' || change.role === 'alertdialog' ? t('observed.dialogAppeared') : t('observed.appeared', { target });
    case 'disappeared': return t('observed.disappeared', { target });
    case 'state': return t('observed.state', { attr: change.attr ?? '', value: String(change.value ?? ''), target });
    case 'navigation': return t('observed.navigation', { url: change.url ?? '' });
    case 'submit': return t('observed.submit', { target });
    default: return change.kind;
  }
}

function describeTarget(change: ObservedChange): string {
  const role = change.role ?? t('observed.element');
  return change.name ? t('observed.targetNamed', { role, name: change.name }) : role;
}
