import { RAWSTEP_DEFAULTS } from '../defaults.js';
import { resolveEnvironmentProfile } from '../profiles/schema.js';
import type { EnvironmentProfile } from '../profiles/types.js';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export type NavigationPolicy = ({ strategy: 'same-origin' } | { strategy: 'start-url-prefix' } | { strategy: 'allow-url-list'; allowUrlList: string[] }) & { readOnly?: boolean; denyUrlIncludes?: string[] };
export type ResolvedNavigationPolicy = NavigationPolicy;
export type RequestVerificationRule = { requestSeen: { urlIncludes: string; method?: string } };
export type ResponseVerificationRule = { responseSeen: { urlIncludes: string; method?: string; status?: number } };
export type ActivatedAnnouncementVerificationRule = { activatedAnnouncementIncludes: string };
export type DomEventVerificationRule = { domEventSeen: { selector: string; event: string } };
/** A plain string means "includes"; matching is case-sensitive unless a regex flag says otherwise. */
export type TextMatcher = string | { includes: string } | { equals: string } | { regex: string; flags?: string };
export type ObservedEventKind = 'focus' | 'focus-lost' | 'appeared' | 'disappeared' | 'live-region' | 'state' | 'submit' | 'navigation';
/** Asks the page observer's timeline whether a change happened. `after` defaults to `start`: the initial load never counts. */
export type EventVerificationRule = { event: { kind: ObservedEventKind; role?: string; name?: TextMatcher; text?: TextMatcher; attr?: string; value?: string; url?: TextMatcher }; after?: 'start' | 'lastActivation' };
/** Where keyboard focus is now, from the observer's latest focus record. */
export type FocusedVerificationRule = { focused: { role?: string; name?: TextMatcher } };
export type NotVerificationRule = { not: VerifyRule };
export type AnyVerificationRule = { any: VerifyRule[] };
export type VerifyRule = EventVerificationRule | FocusedVerificationRule | NotVerificationRule | AnyVerificationRule | { titleIncludes: string } | { urlIncludes: string } | { textVisible: string } | { textVisibleExact: string } | ActivatedAnnouncementVerificationRule | DomEventVerificationRule | RequestVerificationRule | ResponseVerificationRule;
export type VerifySpec = { all: VerifyRule[] };
export type VerifyRuleType = 'event' | 'focused' | 'not' | 'any' | 'titleIncludes' | 'urlIncludes' | 'textVisible' | 'textVisibleExact' | 'activatedAnnouncementIncludes' | 'domEventSeen' | 'requestSeen' | 'responseSeen';
/** Independent observations, never task expectations or policy-visible page context. */
export type VerificationWitness =
  | { kind: 'title'; title: string }
  | { kind: 'url'; url: string }
  | { kind: 'visible-text'; text: string | null; textSource?: 'input-value' | 'text-content'; matchIndex: number; visible: true }
  | { kind: 'request'; url: string; method: string; timestamp: string }
  | { kind: 'response'; url: string; method: string; status: number; ok: boolean; timestamp: string }
  | { kind: 'dom-event'; selector: string; event: string; url: string; timestamp: string }
  | { kind: 'observer-event'; event: { kind: string; step: number; role?: string | null; name?: string; text?: string; attr?: string; value?: string | null; url?: string; sameDocument?: boolean } }
  | { kind: 'activation-speech'; provenance?: 'native' | 'simulation'; speech: string[]; outputEventIds: string[]; activationStep: number; window: ScreenReaderObservation['window']; association: 'temporal-only' };
export type VerificationRuleRecord = {
  /** Zero-based position in task.verify.all. */
  ruleIndex: number;
  ruleType: VerifyRuleType;
  passed: boolean;
  failure?: string;
  /** The runner persists these separately and replaces them with evidenceEventIds. */
  witnesses: VerificationWitness[];
};
/** Legacy custom verifiers may omit per-rule observations. */
export type VerificationRecord = { passed: boolean; failures: string[]; rules?: VerificationRuleRecord[] };
export type Task = {
  id?: string;
  mode?: 'screenreader' | 'keyboard';
  url: string;
  goal: string;
  profile?: EnvironmentProfile;
  maxSteps?: number;
  timeoutMs?: number;
  verify: VerifySpec;
  input?: Record<string, string>;
  navigation?: NavigationPolicy;
};
export type PolicyAction = { kind: 'intent'; intent: string } | { kind: 'key'; key: string } | { kind: 'typeText'; input: string } | { kind: 'replaceText'; input: string };
export type Decision = { action: PolicyAction; rationale?: string } | { stop: 'success' | 'stuck' | 'uncertain'; rationale?: string; stopSource?: 'model' | 'exploration-guard' };
export type AllowedActions = { intents: readonly string[]; keys: readonly string[]; inputKeys: readonly string[]; typeText?: boolean; replaceText: boolean };
export type ScreenReaderObservation = {
  kind: 'screenreader';
  /** Explicit simulation is opt-in and must never be presented as native output. */
  provenance?: 'native' | 'simulation';
  /** Output text only. No raw DOM/AX tree, verifier feedback, or screenshots. */
  speech: readonly string[];
  outputEventIds: readonly string[];
  window: { id: string; startedAt: string; endedAt: string; reason: string };
};
export type ScreenshotObservation = { pngBase64: string; viewport: { w: number; h: number } };
export type KeyboardObservation = {
  kind: 'keyboard';
  screenshot: ScreenshotObservation;
  previousScreenshot?: ScreenshotObservation;
  window: { id: string; startedAt: string; endedAt: string; reason: string };
};
/** Compatibility alias; new code should use KeyboardObservation. */
export type LegacyKeyboardObservation = KeyboardObservation;
export type Observation = ScreenReaderObservation | KeyboardObservation;
export type HistoryEntry = { step: number; decision: Decision; observation: Observation; execution?: { ok: boolean; error?: string } };
export interface DecisionPolicy {
  /** Optional policy-owned inference diagnostics; saved as policy evidence, never verifier evidence. */
  takeDecisionEvidence?(): readonly unknown[];
  decide(input: {
    goal: string;
    observation: Observation;
    history: readonly HistoryEntry[];
    allowedActions: AllowedActions;
    /** Named values are task-provided; the policy cannot submit arbitrary text. */
    inputs: Readonly<Record<string, string>>;
    signal: AbortSignal;
  }): Decision | Promise<Decision>;
}
export type BackendAction = { kind: 'intent'; intent: string } | { kind: 'key'; key: string } | { kind: 'typeText' | 'replaceText'; text: string };
export type BackendCapabilities = { intents: readonly string[]; keys: readonly string[]; textEntry: boolean; replaceText: boolean };
export type BackendOutput = { sequence: number; receivedAt: string; text: string; raw: unknown };
export type BackendSpeechObservation = { kind?: 'screenreader'; windowId: string; startedAt: string; endedAt: string; reason: string; outputs: readonly BackendOutput[]; speech: readonly string[] };
export type BackendKeyboardObservation = { kind: 'keyboard'; windowId: string; startedAt: string; endedAt: string; reason: string; screenshot: ScreenshotObservation; previousScreenshot?: ScreenshotObservation };
export type BackendObservation = BackendSpeechObservation | BackendKeyboardObservation;
/** Generic backend boundary: transport and platform semantics belong in adapters. */
export type BackendOperationOptions = { signal?: AbortSignal };
/** What the runner knows about this run's host and browser, for a backend's own preconditions. */
export type BackendRunContext = { headless: boolean; platform: string; customBrowserSession: boolean };
/** The opened browser session as a backend sees it; `page` is the automation page (Playwright in Rawstep's browser package). */
export type BackendSession = { readonly page: unknown; readonly nativeTargetWindowId?: number };
export interface Backend {
  /** Called after start(): throw when this run cannot proceed here (platform, visibility, session pairing). */
  preflight?(context: BackendRunContext): void | Promise<void>;
  /** Receives the opened browser session before the first observation; throw to refuse a session this backend cannot drive. */
  attachSession?(session: BackendSession): void | Promise<void>;
  /** Budget for close(); native bridges may need longer to release OS state. */
  readonly cleanupTimeoutMs?: number;
  readonly observationKind?: 'screenreader' | 'keyboard';
  /** Missing means unspecified; only explicit simulation may synthesize output. */
  readonly evidenceProvenance?: 'native' | 'simulation';
  readonly capabilities: BackendCapabilities;
  start(options?: BackendOperationOptions): Promise<unknown>;
  execute(action: BackendAction, options?: BackendOperationOptions): Promise<unknown>;
  observe(options?: BackendOperationOptions): Promise<BackendObservation>;
  close(): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
}

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`);
}
export function resolveTask(raw: unknown, baseDir = process.cwd()): Task {
  if (!object(raw)) throw new Error('Task must be an object.');
  onlyKeys(raw, ['id','url','goal','mode','maxSteps','timeoutMs','verify','input','navigation','config','profile'], 'Task');
  if (raw.mode !== undefined && raw.mode !== 'screenreader' && raw.mode !== 'keyboard') throw new Error('Task mode must be screenreader or keyboard.');
  const url = text(raw.url, 'Task URL');
  const goal = text(raw.goal, 'Task goal');
  if (!object(raw.verify) || !Array.isArray(raw.verify.all) || raw.verify.all.length === 0) throw new Error('Task verify.all must contain at least one independent verification rule.');
  onlyKeys(raw.verify, ['all'], 'Task verify');
  const rules = raw.verify.all.map(rule => validateVerifyRule(rule));
  const input = raw.input;
  if (input !== undefined && (!object(input) || Object.keys(input).some(k => !k.trim()) || Object.values(input).some(v => typeof v !== 'string'))) throw new Error('Task input must map names to string values.');
  const maxSteps = raw.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps;
  const timeoutMs = raw.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs;
  if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) < 1) throw new Error('maxSteps must be a positive integer.');
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 2_147_483_647) throw new Error('timeoutMs must be an integer from 1 to 2147483647.');
  if (raw.config !== undefined && !object(raw.config)) throw new Error('Task config must be an object.');
  const config = object(raw.config) ? raw.config : {};
  onlyKeys(config, ['navigation'], 'Deprecated task config; move supported options to task fields');
  const navigation = validateNavigation(raw.navigation ?? config.navigation);
  let resolvedUrl: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[A-Za-z]:[\\/]/.test(url)) {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('Task URL must use http, https, or file.');
    resolvedUrl = parsed.href;
  } else resolvedUrl = pathToFileURL(isAbsolute(url) ? url : resolve(baseDir, url)).href;
  return { ...(raw.mode !== undefined ? { mode: raw.mode as 'screenreader' | 'keyboard' } : {}), ...(raw.id !== undefined ? { id: text(raw.id, 'Task id') } : {}), url: resolvedUrl, goal, ...(raw.profile !== undefined ? { profile: resolveEnvironmentProfile(raw.profile) } : {}), maxSteps: maxSteps as number, timeoutMs: timeoutMs as number, verify: { all: rules }, ...(input ? { input: { ...input } as Record<string, string> } : {}), navigation };
}
export function validateNavigation(value: unknown): NavigationPolicy {
  if (value === undefined) return { strategy: 'same-origin' };
  if (!object(value)) throw new Error('navigation must be an object.');
  if(value.readOnly!==undefined&&typeof value.readOnly!=='boolean')throw new Error('navigation.readOnly must be boolean.');
  if(value.denyUrlIncludes!==undefined&&(!Array.isArray(value.denyUrlIncludes)||value.denyUrlIncludes.length>100||value.denyUrlIncludes.some(v=>typeof v!=='string'||!v.trim()||v.length>200)))throw new Error('navigation.denyUrlIncludes must be a bounded nonempty string list.');
  const safety={...(value.readOnly!==undefined?{readOnly:value.readOnly as boolean}:{}),...(value.denyUrlIncludes?{denyUrlIncludes:[...value.denyUrlIncludes as string[]]}:{})};
  if (value.strategy === undefined || value.strategy === 'same-origin') { onlyKeys(value, ['strategy','readOnly','denyUrlIncludes'], 'same-origin navigation'); return { strategy: 'same-origin', ...safety }; }
  if (value.strategy === 'start-url-prefix') { onlyKeys(value, ['strategy','readOnly','denyUrlIncludes'], 'start-url-prefix navigation'); return { strategy: 'start-url-prefix', ...safety }; }
  if (value.strategy === 'allow-url-list') {
    onlyKeys(value, ['strategy','allowUrlList','readOnly','denyUrlIncludes'], 'allow-url-list navigation');
    if (!Array.isArray(value.allowUrlList) || !value.allowUrlList.length) throw new Error('allowUrlList must be a nonempty URL prefix list.');
    const allowUrlList = value.allowUrlList.map((entry: unknown) => {
      const prefix = text(entry, 'allowUrlList prefix');
      const parsed = new URL(prefix);
      if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('allowUrlList requires HTTP(S) URL prefixes without credentials.');
      return parsed.href;
    });
    return { strategy: 'allow-url-list', allowUrlList: [...new Set(allowUrlList)], ...safety };
  }
  throw new Error('Invalid navigation policy.');
}
const OBSERVED_EVENT_KINDS: readonly string[] = ['focus', 'focus-lost', 'appeared', 'disappeared', 'live-region', 'state', 'submit', 'navigation'];
function validateTextMatcher(value: unknown, label: string): void {
  if (typeof value === 'string') { text(value, label); if (value.length > 200) throw new Error(`${label} must be at most 200 characters.`); return; }
  if (!object(value) || Object.keys(value).length < 1) throw new Error(`${label} must be a string or one of includes, equals, regex.`);
  if ('regex' in value) {
    onlyKeys(value, ['regex', 'flags'], label); text(value.regex, `${label}.regex`);
    if (value.flags !== undefined && (typeof value.flags !== 'string' || !/^[imsu]*$/.test(value.flags))) throw new Error(`${label}.flags may only contain i, m, s, u.`);
    if ((value.regex as string).length > 200) throw new Error(`${label}.regex must be at most 200 characters.`);
    try { new RegExp(value.regex as string, value.flags as string | undefined); } catch { throw new Error(`${label}.regex is not a valid regular expression.`); }
    return;
  }
  if (Object.keys(value).length !== 1 || !('includes' in value || 'equals' in value)) throw new Error(`${label} must use exactly one of includes, equals or regex.`);
  const v = value.includes ?? value.equals; text(v, label); if ((v as string).length > 200) throw new Error(`${label} must be at most 200 characters.`);
}
export function matchesText(matcher: TextMatcher, value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  if (typeof matcher === 'string') return value.includes(matcher);
  if ('equals' in matcher) return value === matcher.equals;
  if ('includes' in matcher) return value.includes(matcher.includes);
  return new RegExp(matcher.regex, matcher.flags).test(value);
}
function validateVerifyRule(value: unknown, depth = 0): VerifyRule {
  if (depth > 4) throw new Error('Verification rules may nest at most four levels.');
  if (object(value) && 'event' in value) {
    onlyKeys(value, ['event', 'after'], 'event rule');
    if (value.after !== undefined && value.after !== 'start' && value.after !== 'lastActivation') throw new Error('event rule after must be start or lastActivation.');
    if (!object(value.event)) throw new Error('event rule needs an event object.');
    onlyKeys(value.event, ['kind', 'role', 'name', 'text', 'attr', 'value', 'url'], 'event');
    if (!OBSERVED_EVENT_KINDS.includes(String(value.event.kind))) throw new Error(`event.kind must be one of ${OBSERVED_EVENT_KINDS.join(', ')}.`);
    for (const key of ['role', 'attr', 'value']) if (value.event[key] !== undefined) text(value.event[key], `event.${key}`);
    for (const key of ['name', 'text', 'url']) if (value.event[key] !== undefined) validateTextMatcher(value.event[key], `event.${key}`);
    return value as EventVerificationRule;
  }
  if (!object(value) || Object.keys(value).length !== 1) throw new Error('Each verification rule must contain one supported rule.');
  if ('focused' in value) {
    if (!object(value.focused) || !Object.keys(value.focused).length) throw new Error('focused rule needs role and/or name.');
    onlyKeys(value.focused, ['role', 'name'], 'focused');
    if (value.focused.role !== undefined) text(value.focused.role, 'focused.role');
    if (value.focused.name !== undefined) validateTextMatcher(value.focused.name, 'focused.name');
    return value as FocusedVerificationRule;
  }
  if ('not' in value) return { not: validateVerifyRule(value.not, depth + 1) };
  if ('any' in value) {
    if (!Array.isArray(value.any) || !value.any.length || value.any.length > 20) throw new Error('any must list 1 to 20 rules.');
    return { any: value.any.map(rule => validateVerifyRule(rule, depth + 1)) };
  }
  for (const key of ['titleIncludes','urlIncludes','textVisible','textVisibleExact','activatedAnnouncementIncludes']) {
    if (key in value) { text(value[key], key); return value as VerifyRule; }
  }
  if ('domEventSeen' in value && object(value.domEventSeen)) {
    onlyKeys(value.domEventSeen, ['selector','event'], 'domEventSeen');
    text(value.domEventSeen.selector, 'domEventSeen.selector'); text(value.domEventSeen.event, 'domEventSeen.event'); return value as DomEventVerificationRule;
  }
  for (const key of ['requestSeen','responseSeen']) {
    const rule = value[key];
    if (!object(rule)) continue;
    onlyKeys(rule, key === 'requestSeen' ? ['urlIncludes','method'] : ['urlIncludes','method','status'], key);
    text(rule.urlIncludes, `${key}.urlIncludes`);
    if (rule.method !== undefined) text(rule.method, `${key}.method`);
    if (rule.status !== undefined && (!Number.isInteger(rule.status) || (rule.status as number) < 100 || (rule.status as number) > 599)) throw new Error('responseSeen.status must be an HTTP status.');
    return value as RequestVerificationRule | ResponseVerificationRule;
  }
  throw new Error('Unsupported verification rule.');
}
