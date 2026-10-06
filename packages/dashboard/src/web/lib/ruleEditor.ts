import type { EventVerificationRule, ObservedEventKind, TextMatcher, VerifyRule } from '@rawstep/core/contracts';

/** What a person edits when adding a completion check: plain strings per kind, converted to and from verify rules. */
export type RuleDraft =
  | { kind: 'textVisible' | 'urlIncludes' | 'titleIncludes'; text: string }
  | { kind: 'liveRegion'; text: string; afterActivation: boolean }
  | { kind: 'appeared' | 'disappeared'; role: string; name: string; afterActivation: boolean }
  | { kind: 'focused'; role: string; name: string }
  | { kind: 'state'; role: string; name: string; attr: string; value: string; afterActivation: boolean }
  | { kind: 'submit'; afterActivation: boolean }
  | { kind: 'request'; url: string; method: string }
  | { kind: 'response'; url: string; method: string; status: string }
  | { kind: 'domEvent'; selector: string; event: string }
  | { kind: 'script'; source: string; description: string }
  | { kind: 'any'; items: RuleDraft[] }
  | { kind: 'not'; item: RuleDraft };

export type RuleDraftKind = RuleDraft['kind'];

/** Kinds shown first, in plain language. */
export const BASIC_KINDS = ['textVisible', 'urlIncludes', 'liveRegion', 'appeared', 'disappeared', 'focused', 'state', 'submit'] as const satisfies readonly RuleDraftKind[];
/** Kinds under "고급". `any` and `not` are only offered at the top level of a check. */
export const ADVANCED_KINDS = ['titleIncludes', 'request', 'response', 'domEvent', 'script', 'any', 'not'] as const satisfies readonly RuleDraftKind[];
/** The state attributes a check can wait for. */
export const STATE_ATTRIBUTES = ['aria-expanded', 'aria-checked', 'checked', 'aria-selected', 'aria-pressed'] as const;

/** An empty draft of a kind, with the defaults that make the common case one click. */
export function blankDraft(kind: RuleDraftKind): RuleDraft {
  switch (kind) {
    case 'textVisible': case 'urlIncludes': case 'titleIncludes': return { kind, text: '' };
    case 'liveRegion': return { kind, text: '', afterActivation: false };
    case 'appeared': case 'disappeared': return { kind, role: '', name: '', afterActivation: false };
    case 'focused': return { kind, role: '', name: '' };
    case 'state': return { kind, role: '', name: '', attr: STATE_ATTRIBUTES[0], value: 'true', afterActivation: false };
    case 'submit': return { kind, afterActivation: false };
    case 'request': return { kind, url: '', method: '' };
    case 'response': return { kind, url: '', method: '', status: '' };
    case 'domEvent': return { kind, selector: '', event: 'click' };
    case 'script': return { kind, source: '', description: '' };
    case 'any': return { kind, items: [blankDraft('textVisible'), blankDraft('textVisible')] };
    case 'not': return { kind, item: blankDraft('textVisible') };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const trimmed = (value: string) => value.trim();

/** The text of a matcher that means "includes"; `null` for equals and regex matchers this editor cannot show, `''` when absent. */
function includesText(matcher: TextMatcher | undefined): string | null {
  if (matcher === undefined) return '';
  if (typeof matcher === 'string') return matcher;
  return 'includes' in matcher ? matcher.includes : null;
}

const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

function eventDraft(rule: EventVerificationRule): RuleDraft | undefined {
  const { event, after } = rule, afterActivation = after === 'lastActivation';
  const name = includesText(event.name), text = includesText(event.text);
  if (name === null || text === null) return undefined;
  switch (event.kind) {
    case 'live-region': return hasOnly(event, ['kind', 'text']) ? { kind: 'liveRegion', text, afterActivation } : undefined;
    case 'appeared': case 'disappeared': return hasOnly(event, ['kind', 'role', 'name']) ? { kind: event.kind, role: event.role ?? '', name, afterActivation } : undefined;
    case 'state': return hasOnly(event, ['kind', 'role', 'name', 'attr', 'value']) ? { kind: 'state', role: event.role ?? '', name, attr: event.attr ?? '', value: event.value ?? '', afterActivation } : undefined;
    case 'submit': return hasOnly(event, ['kind']) ? { kind: 'submit', afterActivation } : undefined;
    default: return undefined;
  }
}

/**
 * The draft that edits a rule, or `undefined` when the editor cannot show it without losing something
 * (regex or exact matchers, focus and navigation events, exact text); such a rule stays a read-only card.
 */
export function draftFromRule(rule: VerifyRule): RuleDraft | undefined {
  // A rule read from a task file may have any shape; one this editor cannot read is shown as a card instead.
  try {
    const draft = convert(rule);
    // Only a draft that builds exactly the same rule again may stand for it: nothing is lost by editing.
    return draft && canonical(ruleFromDraft(draft)) === canonical(rule) ? draft : undefined;
  } catch { return undefined; }
}

/** JSON with sorted keys and `{ includes }` matchers written as plain strings, to compare rules whatever way their fields were written. */
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : isRecord(item) && Object.keys(item).length === 1 && typeof item.includes === 'string' ? item.includes : isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}

function convert(rule: VerifyRule): RuleDraft | undefined {
  if ('event' in rule) return eventDraft(rule);
  if ('focused' in rule) {
    const name = includesText(rule.focused.name);
    return name === null ? undefined : { kind: 'focused', role: rule.focused.role ?? '', name };
  }
  if ('textVisible' in rule) return { kind: 'textVisible', text: rule.textVisible };
  if ('urlIncludes' in rule) return { kind: 'urlIncludes', text: rule.urlIncludes };
  if ('titleIncludes' in rule) return { kind: 'titleIncludes', text: rule.titleIncludes };
  if ('requestSeen' in rule) return { kind: 'request', url: rule.requestSeen.urlIncludes, method: rule.requestSeen.method ?? '' };
  if ('responseSeen' in rule) return { kind: 'response', url: rule.responseSeen.urlIncludes, method: rule.responseSeen.method ?? '', status: rule.responseSeen.status === undefined ? '' : String(rule.responseSeen.status) };
  if ('domEventSeen' in rule) return { kind: 'domEvent', selector: rule.domEventSeen.selector, event: rule.domEventSeen.event };
  if ('script' in rule) return { kind: 'script', source: rule.script.source, description: rule.script.description };
  if ('any' in rule) {
    const items = rule.any.map(convert);
    return items.every((item): item is RuleDraft => !!item) ? { kind: 'any', items } : undefined;
  }
  if ('not' in rule) {
    const item = convert(rule.not);
    return item ? { kind: 'not', item } : undefined;
  }
  return undefined;
}

const event = (kind: ObservedEventKind, fields: Omit<EventVerificationRule['event'], 'kind'>, afterActivation: boolean): VerifyRule =>
  ({ event: { kind, ...fields }, ...(afterActivation ? { after: 'lastActivation' as const } : {}) });

/** What a draft still needs before it is a rule; `undefined` when it is complete. A key into `ruleEditor.missing` in the locale files. */
export function draftMissing(draft: RuleDraft): 'text' | 'element' | 'state' | 'url' | 'status' | 'selector' | 'code' | 'items' | undefined {
  switch (draft.kind) {
    case 'textVisible': case 'urlIncludes': case 'titleIncludes': case 'liveRegion': return trimmed(draft.text) ? undefined : 'text';
    case 'appeared': case 'disappeared': case 'focused': return trimmed(draft.role) || trimmed(draft.name) ? undefined : 'element';
    case 'state': return trimmed(draft.attr) && trimmed(draft.value) ? undefined : 'state';
    case 'submit': return undefined;
    case 'request': return trimmed(draft.url) ? undefined : 'url';
    case 'response': {
      if (!trimmed(draft.url)) return 'url';
      const status = trimmed(draft.status);
      return !status || (Number.isInteger(Number(status)) && Number(status) >= 100 && Number(status) <= 599) ? undefined : 'status';
    }
    case 'domEvent': return trimmed(draft.selector) && trimmed(draft.event) ? undefined : 'selector';
    case 'script': return trimmed(draft.source) && trimmed(draft.description) ? undefined : 'code';
    case 'any': return draft.items.length >= 1 && draft.items.every(item => !draftMissing(item)) ? undefined : 'items';
    case 'not': return draftMissing(draft.item) ? 'items' : undefined;
  }
}

/** The verify rule a draft stands for, or `undefined` while it is incomplete. */
export function ruleFromDraft(draft: RuleDraft): VerifyRule | undefined {
  if (draftMissing(draft)) return undefined;
  const optional = (key: string, value: string) => trimmed(value) ? { [key]: trimmed(value) } : {};
  switch (draft.kind) {
    case 'textVisible': return { textVisible: trimmed(draft.text) };
    case 'urlIncludes': return { urlIncludes: trimmed(draft.text) };
    case 'titleIncludes': return { titleIncludes: trimmed(draft.text) };
    case 'liveRegion': return event('live-region', { text: trimmed(draft.text) }, draft.afterActivation);
    case 'appeared': case 'disappeared': return event(draft.kind, { ...optional('role', draft.role), ...optional('name', draft.name) }, draft.afterActivation);
    case 'focused': return { focused: { ...optional('role', draft.role), ...optional('name', draft.name) } };
    case 'state': return event('state', { attr: trimmed(draft.attr), value: trimmed(draft.value), ...optional('role', draft.role), ...optional('name', draft.name) }, draft.afterActivation);
    case 'submit': return event('submit', {}, draft.afterActivation);
    case 'request': return { requestSeen: { urlIncludes: trimmed(draft.url), ...optional('method', draft.method.toUpperCase()) } };
    case 'response': return { responseSeen: { urlIncludes: trimmed(draft.url), ...optional('method', draft.method.toUpperCase()), ...(trimmed(draft.status) ? { status: Number(trimmed(draft.status)) } : {}) } };
    case 'domEvent': return { domEventSeen: { selector: trimmed(draft.selector), event: trimmed(draft.event) } };
    case 'script': return { script: { source: draft.source.trim(), description: trimmed(draft.description) } };
    case 'any': return { any: draft.items.map(item => ruleFromDraft(item)!) };
    case 'not': return { not: ruleFromDraft(draft.item)! };
  }
}

/** True when a rule is a script: code that runs on the page and that a person must have read. */
export const isScriptRule = (rule: VerifyRule): rule is Extract<VerifyRule, { script: unknown }> => isRecord(rule) && 'script' in rule;
