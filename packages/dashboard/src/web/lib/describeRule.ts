import { t } from '../i18n/index.js';
import { roleLabel } from '../i18n/labels.js';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Event kinds with a label in ruleText.eventKinds. */
const kindLabels = { focus: 1, 'focus-lost': 1, appeared: 1, disappeared: 1, 'live-region': 1, state: 1, submit: 1, navigation: 1, 'page-blur': 1, 'page-focus': 1 } as const;

/** Words for a text matcher: a plain string means "includes". */
function matcher(value: unknown): string | undefined {
  if (str(value)) return t('ruleText.matcherIncludes', { text: value as string });
  if (!isRecord(value)) return undefined;
  if (str(value.includes)) return t('ruleText.matcherIncludes', { text: value.includes as string });
  if (str(value.equals)) return t('ruleText.matcherEquals', { text: value.equals as string });
  if (str(value.regex)) return t('ruleText.matcherRegex', { pattern: value.regex as string, flags: str(value.flags) ?? '' });
  return undefined;
}

/** The text of a matcher that means "includes"; `undefined` when absent or when it is an exact or regex matcher. */
function includesOf(value: unknown): string | undefined {
  if (str(value)) return value as string;
  return isRecord(value) && str(value.includes) ? value.includes as string : undefined;
}

/** `대화상자 “Checkout”`: the element an event or focus rule names, when only a role and an "includes" name are involved. */
function elementOf(detail: Record<string, unknown>): string | undefined {
  const role = str(detail.role), name = includesOf(detail.name);
  if (detail.name !== undefined && name === undefined) return undefined;
  if (!role && !name) return undefined;
  if (!name) return roleLabel(role!);
  return role ? t('hints.text.targetNamed', { role: roleLabel(role), name }) : t('ruleText.elementNameOnly', { name });
}

/** The element or change an event/focused rule points at, e.g. role and accessible name. */
function targetOf(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  if (str(detail.role)) parts.push(t('ruleText.targetRole', { role: detail.role as string }));
  const name = matcher(detail.name), text = matcher(detail.text), url = matcher(detail.url);
  if (name) parts.push(t('ruleText.targetName', { matcher: name }));
  if (text) parts.push(t('ruleText.targetText', { matcher: text }));
  if (str(detail.attr)) parts.push(t('ruleText.targetState', { attr: detail.attr as string, value: str(detail.value) ?? '' }));
  if (url) parts.push(t('ruleText.targetUrl', { matcher: url }));
  return parts.join(', ');
}

/** A plain sentence for the event kinds the editor offers; `undefined` for the others and for matchers it cannot put in words. */
function eventSentence(event: Record<string, unknown>): string | undefined {
  const element = elementOf(event);
  switch (event.kind) {
    case 'live-region': return includesOf(event.text) && !element ? t('ruleText.liveRegion', { text: includesOf(event.text)! }) : undefined;
    case 'appeared': return element ? t('ruleText.appeared', { target: element }) : undefined;
    case 'disappeared': return element ? t('ruleText.disappeared', { target: element }) : undefined;
    case 'state': {
      const attr = str(event.attr), value = str(event.value);
      if (!attr || !value || (event.name !== undefined && !includesOf(event.name))) return undefined;
      return element ? t('ruleText.state', { target: element, attr, value }) : t('ruleText.stateAnywhere', { attr, value });
    }
    case 'submit': return t('ruleText.submit');
    default: return undefined;
  }
}

/**
 * One plain-language Korean sentence for a verify rule, for people who do not read the JSON.
 * Unknown shapes fall back to the JSON text so nothing is hidden.
 */
export function describeRule(rule: unknown): string {
  if (!isRecord(rule)) return JSON.stringify(rule);
  for (const key of ['textVisible', 'textVisibleExact', 'titleIncludes', 'urlIncludes', 'activatedAnnouncementIncludes'] as const) {
    if (typeof rule[key] === 'string') return t(`ruleText.${key}`, { text: rule[key] });
  }
  if (isRecord(rule.event)) {
    const sentence = eventSentence(rule.event);
    if (sentence) return rule.after === 'lastActivation' ? t('ruleText.eventAfterActivation', { text: sentence }) : sentence;
    const kind = str(rule.event.kind), kindText = kind && Object.hasOwn(kindLabels, kind) ? t(`ruleText.eventKinds.${kind as keyof typeof kindLabels}`) : kind ?? '';
    const target = targetOf(rule.event);
    const text = target ? t('ruleText.eventTarget', { kind: kindText, target }) : t('ruleText.event', { kind: kindText });
    return rule.after === 'lastActivation' ? t('ruleText.eventAfterActivation', { text }) : text;
  }
  if (isRecord(rule.focused)) {
    const element = elementOf(rule.focused);
    if (element) return t('ruleText.focusedOn', { target: element });
    const target = targetOf(rule.focused);
    return target ? t('ruleText.focused', { target }) : t('ruleText.focusedAny');
  }
  if (isRecord(rule.script) && str(rule.script.description)) return t('ruleText.script', { description: rule.script.description as string });
  if (isRecord(rule.domEventSeen) && str(rule.domEventSeen.selector) && str(rule.domEventSeen.event)) {
    return t('ruleText.domEventSeen', { selector: rule.domEventSeen.selector as string, event: rule.domEventSeen.event as string });
  }
  if (isRecord(rule.requestSeen) && str(rule.requestSeen.urlIncludes)) {
    return t('ruleText.requestSeen', { url: rule.requestSeen.urlIncludes as string, method: str(rule.requestSeen.method) ? rule.requestSeen.method + ' ' : '' });
  }
  if (isRecord(rule.responseSeen) && str(rule.responseSeen.urlIncludes)) {
    const status = rule.responseSeen.status;
    return t('ruleText.responseSeen', {
      url: rule.responseSeen.urlIncludes as string, method: str(rule.responseSeen.method) ? rule.responseSeen.method + ' ' : '',
      status: typeof status === 'number' ? t('ruleText.responseStatus', { status }) : '',
    });
  }
  if (Array.isArray(rule.any) && rule.any.length) return t('ruleText.any', { items: rule.any.map(item => '(' + describeRule(item) + ')').join(' / ') });
  if ('not' in rule) return t('ruleText.not', { item: describeRule(rule.not) });
  return JSON.stringify(rule);
}
