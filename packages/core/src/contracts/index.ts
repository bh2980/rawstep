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
export type VerifyRule = { titleIncludes: string } | { urlIncludes: string } | { textVisible: string } | { textVisibleExact: string } | ActivatedAnnouncementVerificationRule | DomEventVerificationRule | RequestVerificationRule | ResponseVerificationRule;
export type VerifySpec = { all: VerifyRule[] };
export type VerifyRuleType = 'titleIncludes' | 'urlIncludes' | 'textVisible' | 'textVisibleExact' | 'activatedAnnouncementIncludes' | 'domEventSeen' | 'requestSeen' | 'responseSeen';
/** Independent observations, never task expectations or policy-visible page context. */
export type VerificationWitness =
  | { kind: 'title'; title: string }
  | { kind: 'url'; url: string }
  | { kind: 'visible-text'; text: string | null; textSource?: 'input-value' | 'text-content'; matchIndex: number; visible: true }
  | { kind: 'request'; url: string; method: string; timestamp: string }
  | { kind: 'response'; url: string; method: string; status: number; ok: boolean; timestamp: string }
  | { kind: 'dom-event'; selector: string; event: string; url: string; timestamp: string }
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
export interface Backend {
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
  const rules = raw.verify.all.map(validateVerifyRule);
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
function validateVerifyRule(value: unknown): VerifyRule {
  if (!object(value) || Object.keys(value).length !== 1) throw new Error('Each verification rule must contain one supported rule.');
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
