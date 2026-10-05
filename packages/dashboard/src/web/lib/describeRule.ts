import { t } from '../i18n/index.js';

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
    const kind = str(rule.event.kind), kindText = kind && Object.hasOwn(kindLabels, kind) ? t(`ruleText.eventKinds.${kind as keyof typeof kindLabels}`) : kind ?? '';
    const target = targetOf(rule.event);
    const text = target ? t('ruleText.eventTarget', { kind: kindText, target }) : t('ruleText.event', { kind: kindText });
    return rule.after === 'lastActivation' ? t('ruleText.eventAfterActivation', { text }) : text;
  }
  if (isRecord(rule.focused)) {
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
