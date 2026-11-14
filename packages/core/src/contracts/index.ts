import { isRecord } from '../guards.js';
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
/**
 * Reviewed JavaScript for goals the declarative rules cannot express. `source` is a function expression,
 * `(context) => boolean` (may be async), run in an isolated world against the page DOM at verification time;
 * `context.timeline` holds the page observer events. Only add code a person has read: it runs with DOM access.
 */
export type ScriptVerificationRule = { script: { source: string; description: string } };
/** A plain string means "includes"; matching is case-sensitive unless a regex flag says otherwise. */
export type TextMatcher = string | { includes: string } | { equals: string } | { regex: string; flags?: string };
/** What the page observer records. The one list: the observer, the task validation and the `event` rule all take it from here. */
export const OBSERVED_EVENT_KINDS = ['focus', 'focus-lost', 'appeared', 'disappeared', 'live-region', 'state', 'submit', 'navigation', 'page-blur', 'page-focus'] as const;
export type ObservedEventKind = typeof OBSERVED_EVENT_KINDS[number];
/** Asks the page observer's timeline whether a change happened. `after` defaults to `start`: the initial load never counts. */
export type EventVerificationRule = { event: { kind: ObservedEventKind; role?: string; name?: TextMatcher; text?: TextMatcher; attr?: string; value?: string; url?: TextMatcher }; after?: 'start' | 'lastActivation' };
/** Where keyboard focus is now, from the observer's latest focus record. */
export type FocusedVerificationRule = { focused: { role?: string; name?: TextMatcher } };
export type NotVerificationRule = { not: VerifyRule };
export type AnyVerificationRule = { any: VerifyRule[] };
export type VerifyRule = EventVerificationRule | FocusedVerificationRule | NotVerificationRule | AnyVerificationRule | ScriptVerificationRule | { titleIncludes: string } | { urlIncludes: string } | { textVisible: string } | { textVisibleExact: string } | ActivatedAnnouncementVerificationRule | DomEventVerificationRule | RequestVerificationRule | ResponseVerificationRule;
export type VerifySpec = { all: VerifyRule[] };
export type VerifyRuleType = 'event' | 'focused' | 'not' | 'any' | 'script' | 'titleIncludes' | 'urlIncludes' | 'textVisible' | 'textVisibleExact' | 'activatedAnnouncementIncludes' | 'domEventSeen' | 'requestSeen' | 'responseSeen';
/** Independent observations, never task expectations or policy-visible page context. */
export type VerificationWitness =
  | { kind: 'title'; title: string }
  | { kind: 'url'; url: string }
  | { kind: 'visible-text'; text: string | null; textSource?: 'input-value' | 'text-content'; matchIndex: number; visible: true }
  | { kind: 'request'; url: string; method: string; timestamp: string }
  | { kind: 'response'; url: string; method: string; status: number; ok: boolean; timestamp: string }
  | { kind: 'dom-event'; selector: string; event: string; url: string; timestamp: string }
  /** `result` is null when the script could not decide; `error` names why, never the thrown message. */
  | { kind: 'script'; description: string; result: boolean | null; error?: ScriptCheckError }
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
/** Custom verifiers supplied to the runner may omit per-rule observations. */
export type VerificationRecord = { passed: boolean; failures: string[]; rules?: VerificationRuleRecord[] };
export type Task = {
  id?: string;
  url: string;
  goal: string;
  /**
   * What the simulated user knows before starting, written by the person setting up the task: the kind of site and page ("PhoneShop,
   * an online store; a product page"), or what a search result said. Never this page's structure, which a user only learns by
   * moving through it. Planners read it; it is part of the user being simulated.
   */
  context?: string;
  profile?: EnvironmentProfile;
  maxSteps?: number;
  timeoutMs?: number;
  verify: VerifySpec;
  input?: Record<string, string>;
  /** Per-input handling. Inputs are sensitive unless marked otherwise: the model never sees their values. */
  inputOptions?: Record<string, TaskInputOptions>;
  navigation?: NavigationPolicy;
  /** What the site needs of the browser (see `TaskBrowser`); without it Rawstep launches one. */
  browser?: TaskBrowser;
};
/**
 * What a site needs of the browser, a property of the task like its address. `launch` (the default): a browser Rawstep starts.
 * `connect`: a Chrome the person started with a remote debugging port (the computer's `browserEndpoint`), which sites see as an
 * ordinary browser; each run gets its own context there, and `copySignIn` starts it with a copy of that Chrome's sign-in. `personCheck`:
 * a person passes the site's human check in a visible window (Rawstep never answers one); in a launched browser that uses a kept
 * profile, so those runs go one at a time.
 */
export type TaskBrowser = { mode: 'launch' | 'connect'; copySignIn?: boolean; personCheck?: boolean };
export type PolicyAction = { kind: 'intent'; intent: string } | { kind: 'key'; key: string } | { kind: 'typeText'; input: string } | { kind: 'replaceText'; input: string };
/**
 * Who ended a run early: a custom decision policy (`model`), the planner judging the goal reached (`planner`), Rawstep's repetition guard
 * (`exploration-guard`), the simulated user giving up after the approaches they tried failed (`user-gave-up`), or a cost limit on
 * planner calls before either (`orchestration-limit`: unmeasured, not a failure).
 */
export type StopSource = 'model' | 'planner' | 'exploration-guard' | 'user-gave-up' | 'orchestration-limit' | 'no-allowed-action';
export const STOP_SOURCES: readonly StopSource[] = Object.freeze(['model', 'planner', 'exploration-guard', 'user-gave-up', 'orchestration-limit', 'no-allowed-action']);
export type Decision = { action: PolicyAction; rationale?: string } | { stop: 'success' | 'stuck' | 'uncertain'; rationale?: string; stopSource?: StopSource };
export type AllowedActions = { intents: readonly string[]; keys: readonly string[]; inputKeys: readonly string[]; typeText?: boolean; replaceText: boolean };
export type ScreenReaderObservation = {
  kind: 'screenreader';
  /** Explicit simulation is opt-in and must never be presented as native output. */
  provenance?: 'native' | 'simulation';
  /** Output text only. No raw DOM/AX tree, verifier feedback, or screenshots. */
  speech: readonly string[];
  outputEventIds: readonly string[];
  window: { id: string; startedAt: string; endedAt: string; reason: string };
  /** The page title (document.title), which screen readers announce when a page loads. Absent when it could not be read. */
  title?: string;
  /**
   * Lines of `speech` the page announced on its own (live-region updates), not what the move said. The user hears them, so they stay in
   * `speech`; Rawstep leaves them out when it judges whether a move changed anything or where the cursor is, so a ticker that never
   * stops talking does not look like progress. Absent when the screen reader does not tell them apart.
   */
  announcements?: readonly string[];
};
/** What the move itself said: `speech` without the page's own announcements (each listed line taken out once). */
export function moveSpeech(observation: Pick<ScreenReaderObservation, 'speech' | 'announcements'>): string[] {
  const pending = [...observation.announcements ?? []];
  return observation.speech.filter(line => { const i = pending.indexOf(line); if (i < 0) return true; pending.splice(i, 1); return false; });
}
/** What a policy observes: Rawstep simulates screen reader users only. */
export type Observation = ScreenReaderObservation;
/**
 * Why the runner could not carry out an action, in words Rawstep chose: `not-editable` when text entry found no editable
 * focused field, `backend` for anything the screen reader or browser refused. Models see this code, never the raw error.
 */
export type ExecutionFailure = 'not-editable' | 'backend';
export type ActionExecution = { ok: boolean; error?: string; failure?: ExecutionFailure };
export type HistoryEntry = { step: number; decision: Decision; observation: Observation; execution?: ActionExecution };
export interface DecisionPolicy {
  /** Optional policy-owned inference diagnostics; saved as policy evidence, never verifier evidence. */
  takeDecisionEvidence?(): readonly unknown[];
  decide(input: {
    goal: string;
    /** The task's `context`: what the user knows about the site and page before starting. */
    context?: string;
    observation: Observation;
    history: readonly HistoryEntry[];
    allowedActions: AllowedActions;
    /** Named values are task-provided; the policy cannot submit arbitrary text. */
    inputs: Readonly<Record<string, InputDescriptor>>;
    signal: AbortSignal;
    /** Called as the policy starts asking its planner, so a live view can say it is waiting and why (`trigger`). */
    onPlannerCall?: (call: { trigger: string }) => void;
  }): Decision | Promise<Decision>;
}
export type TaskInputOptions = { sensitive?: boolean; description?: string };
/** What a policy may know about a named input: never its value. */
/** A task input as a policy sees it. `value` is present only for inputs marked not sensitive (a search term, a quantity), so the model knows what it would type; secrets stay names. */
export type InputDescriptor = { sensitive: boolean; description?: string; value?: string };
/**
 * What a backend is asked to do. Whether typed text is a secret is not the backend's to know: the runner keeps what is spoken after
 * a secret from the policy and the trace itself, whichever backend typed it.
 */
export type BackendAction = { kind: 'intent'; intent: string } | { kind: 'key'; key: string } | { kind: 'typeText' | 'replaceText'; text: string };
export type BackendCapabilities = { intents: readonly string[]; keys: readonly string[]; textEntry: boolean; replaceText: boolean };
/**
 * One thing the screen reader said. `raw` is the backend's own record of it, kept in the trace and read by nobody: whatever the
 * runner needs of an output is a field here. `announcement: 'live-region'` marks what the page said on its own (a live region), not in
 * answer to the user's move; a backend that cannot tell, like a real screen reader, leaves it out.
 */
export type BackendOutput = { sequence: number; receivedAt: string; text: string; raw: unknown; announcement?: 'live-region' };
/**
 * What a backend says of an action it carried out. `pressed: false` says an action that names a press pressed nothing: with a rotor
 * list open, `activate` goes to the list's item instead. Which action presses is the backend's to know, not the action's name: the
 * runner then treats it as the move it was (no waiting for an answer to a press, no anchor for "since the last activation").
 * Anything else in the receipt is the backend's own and read by nobody.
 */
export type BackendReceipt = { pressed?: boolean; [key: string]: unknown };
/**
 * What a backend says about itself when it starts. The runner records all of it and reads only `environment`: the screen reader's
 * name and version go into the trace's environment and are checked against a task profile's `at`.
 */
export type BackendMetadata = { environment?: { atName?: string; atVersion?: string; [key: string]: unknown } };
/**
 * What a backend reports while it works: commands it sent, speech as it arrived, windows it opened. The runner records each one as
 * `backend.<type>` and reads only these fields. An event that carries one piece of speech has it as `output`, or as its own
 * `sequence` and `text`: the runner ties that output to the event's place in the trace.
 */
export type BackendEvent = {
  type: string; timestamp?: number; commandId?: string | number; windowId?: string; method?: string;
  sequence?: number; text?: string; output?: { sequence: number; text: string };
};
/**
 * Where the screen reader cursor sits on screen, for people reading a run: its box in viewport CSS pixels, how far the page was
 * scrolled and the viewport size. It is recorded in the trace and never given to a policy.
 */
export type CursorLocation = { rect: { x: number; y: number; width: number; height: number }; scroll: { x: number; y: number }; viewport: { width: number; height: number }; url: string };
export type BackendSpeechObservation = { kind?: 'screenreader'; windowId: string; startedAt: string; endedAt: string; reason: string; outputs: readonly BackendOutput[]; speech: readonly string[]; cursor?: CursorLocation };
export type BackendObservation = BackendSpeechObservation;
/** Generic backend boundary: transport and platform semantics belong in adapters. */
export type BackendOperationOptions = { signal?: AbortSignal };
/**
 * What a run's surface is, known before it opens. `web`: a page in a browser; `headless` says the browser shows no window,
 * `customSession` that the caller opens the browser itself (it may be on another machine).
 */
export type SurfaceFacts = { kind: 'web'; headless: boolean; customSession: boolean };
/** What the runner knows about this run's host and surface, for a backend's own preconditions. */
export type BackendRunContext = { platform: string; surface: SurfaceFacts };
/**
 * The opened surface as a backend sees it. `web`: `page` is the automation page (Playwright in Rawstep's browser package) and
 * `browserProcessId` the browser's process when it could say. A backend refuses a kind it cannot drive.
 */
export type BackendSession = { readonly kind: 'web'; readonly page: unknown; readonly browserProcessId?: number };
export interface Backend {
  /** Called after start(): throw when this run cannot proceed here (platform, visibility, session pairing). */
  preflight?(context: BackendRunContext): void | Promise<void>;
  /** Receives the opened surface before the first observation; throw to refuse a session this backend cannot drive. */
  attachSession?(session: BackendSession): void | Promise<void>;
  /** Budget for close(); a native bridge sets a longer one to release OS state (`RAWSTEP_DEFAULTS.cleanupTimeoutMs.nativeBackend`). */
  readonly cleanupTimeoutMs?: number;
  /** Missing means unspecified; only explicit simulation may synthesize output. */
  readonly evidenceProvenance?: 'native' | 'simulation';
  readonly capabilities: BackendCapabilities;
  start(options?: BackendOperationOptions): Promise<BackendMetadata>;
  /** Carries out one action. What it resolves to is the backend's own receipt; the runner reads only `pressed` (see `BackendReceipt`). */
  execute(action: BackendAction, options?: BackendOperationOptions): Promise<BackendReceipt | void>;
  /**
   * Called when a new document has loaded, before the next observation: a screen reader whose cursor can stay on the browser's own
   * controls then gets into the page, unless it is already there (`reason` says why nothing was pressed). Not one of the user's moves.
   * Rejects when it cannot.
   */
  enterPage?(options?: BackendOperationOptions): Promise<{ entered: boolean; moves: number; reason?: string }>;
  observe(options?: BackendOperationOptions): Promise<BackendObservation>;
  close(): Promise<void>;
  subscribe(listener: (event: BackendEvent) => void): () => void;
}

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
};
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`);
}
export function resolveTask(raw: unknown, baseDir = process.cwd()): Task {
  if (!isRecord(raw)) throw new Error('Task must be an object.');
  onlyKeys(raw, ['id','url','goal','context','maxSteps','timeoutMs','verify','input','inputOptions','navigation','profile','browser'], 'Task');
  const url = text(raw.url, 'Task URL');
  const goal = text(raw.goal, 'Task goal');
  const context = raw.context === undefined ? undefined : text(raw.context, 'Task context');
  if (context && context.length > 1000) throw new Error('Task context must be at most 1000 characters.');
  if (!isRecord(raw.verify) || !Array.isArray(raw.verify.all) || raw.verify.all.length === 0) throw new Error('Task verify.all must contain at least one independent verification rule.');
  onlyKeys(raw.verify, ['all'], 'Task verify');
  const rules = raw.verify.all.map(rule => validateVerifyRule(rule));
  const input = raw.input;
  if (input !== undefined && (!isRecord(input) || Object.keys(input).some(k => !k.trim()) || Object.values(input).some(v => typeof v !== 'string'))) throw new Error('Task input must map names to string values.');
  const inputOptions = raw.inputOptions;
  if (inputOptions !== undefined) {
    if (!isRecord(inputOptions)) throw new Error('Task inputOptions must map input names to options.');
    for (const [name, option] of Object.entries(inputOptions)) {
      if (!input || !Object.hasOwn(input, name)) throw new Error(`Task inputOptions names unknown input ${name}.`);
      if (!isRecord(option)) throw new Error(`Task inputOptions.${name} must be an object.`);
      onlyKeys(option, ['sensitive', 'description'], `inputOptions.${name}`);
      if (option.sensitive !== undefined && typeof option.sensitive !== 'boolean') throw new Error(`inputOptions.${name}.sensitive must be boolean.`);
      if (option.description !== undefined && (typeof option.description !== 'string' || !option.description.trim() || option.description.length > 200)) throw new Error(`inputOptions.${name}.description must be a nonempty string up to 200 characters.`);
    }
  }
  // The goal goes to the model verbatim; a sensitive value written there would defeat input hiding.
  for (const [name, value] of Object.entries((input ?? {}) as Record<string, string>)) {
    const sensitive = (isRecord(inputOptions) && isRecord(inputOptions[name]) ? inputOptions[name].sensitive : undefined) !== false;
    if (sensitive && value.length >= 4 && (goal.includes(value) || context?.includes(value))) throw new Error(`Task goal or context contains the value of input ${name}; refer to the input by name instead.`);
    // Script sources are saved in traces and reports like the rest of the task.
    if (sensitive && value.length >= 4 && scriptSources(rules).some(source => source.includes(value))) throw new Error(`A script rule contains the value of input ${name}; check for the field state instead of its value.`);
  }
  const maxSteps = raw.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps;
  const timeoutMs = raw.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs;
  if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) < 1) throw new Error('maxSteps must be a positive integer.');
  // Page time only (waiting for the planner does not count), so an hour is far more than any task needs.
  if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 3_600_000) throw new Error('timeoutMs must be an integer from 1 to 3600000 (one hour).');
  const navigation = validateNavigation(raw.navigation);
  const browser = raw.browser === undefined ? undefined : validateBrowser(raw.browser);
  let resolvedUrl: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[A-Za-z]:[\\/]/.test(url)) {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('Task URL must use http, https, or file.');
    resolvedUrl = parsed.href;
  } else resolvedUrl = pathToFileURL(isAbsolute(url) ? url : resolve(baseDir, url)).href;
  return { ...(raw.id !== undefined ? { id: text(raw.id, 'Task id') } : {}), url: resolvedUrl, goal, ...(context ? { context } : {}), ...(raw.profile !== undefined ? { profile: resolveEnvironmentProfile(raw.profile) } : {}), maxSteps: maxSteps as number, timeoutMs: timeoutMs as number, verify: { all: rules }, ...(input ? { input: { ...input } as Record<string, string> } : {}), ...(isRecord(inputOptions) ? { inputOptions: structuredClone(inputOptions) as Record<string, TaskInputOptions> } : {}), navigation, ...(browser ? { browser } : {}) };
}
function validateBrowser(value: unknown): TaskBrowser {
  if (!isRecord(value)) throw new Error('Task browser must be an object.');
  onlyKeys(value, ['mode', 'copySignIn', 'personCheck'], 'Task browser');
  if (value.mode !== 'launch' && value.mode !== 'connect') throw new Error('browser.mode must be "launch" or "connect".');
  for (const key of ['copySignIn', 'personCheck'] as const) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`browser.${key} must be boolean.`);
  if (value.copySignIn && value.mode !== 'connect') throw new Error('browser.copySignIn needs mode "connect": it copies the sign-in of a Chrome you started yourself.');
  return { mode: value.mode, ...(value.copySignIn ? { copySignIn: true } : {}), ...(value.personCheck ? { personCheck: true } : {}) };
}
/** Whether runs of a task share the kept browser profile, which one Chrome at a time can open. */
export const usesKeptProfile = (browser: TaskBrowser | undefined) => !!browser?.personCheck && browser.mode !== 'connect';
export function validateNavigation(value: unknown): NavigationPolicy {
  if (value === undefined) return { strategy: 'same-origin' };
  if (!isRecord(value)) throw new Error('navigation must be an object.');
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
function validateTextMatcher(value: unknown, label: string): void {
  if (typeof value === 'string') { text(value, label); if (value.length > 200) throw new Error(`${label} must be at most 200 characters.`); return; }
  if (!isRecord(value) || Object.keys(value).length < 1) throw new Error(`${label} must be a string or one of includes, equals, regex.`);
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
export const MAX_SCRIPT_SOURCE = 4000;
/**
 * Every rule of a goal check in order, the ones nested in `any` and `not` included (the nesting rules themselves too). The one walk
 * of the rule tree: what installs a rule's evidence source, what reads its script and what reads its words all go through here, so a
 * rule works the same wherever it is nested. `negated: false` leaves out what a `not` rule holds: that must not happen, so it is not
 * something the goal asks for.
 */
export function flattenVerifyRules(rules: readonly VerifyRule[], options: { negated?: boolean } = {}): VerifyRule[] {
  return rules.flatMap(rule => [rule, ...('not' in rule ? (options.negated === false ? [] : flattenVerifyRules([rule.not], options)) : 'any' in rule ? flattenVerifyRules(rule.any, options) : [])]);
}
function scriptSources(rules: readonly VerifyRule[]): string[] {
  return flattenVerifyRules(rules).flatMap(rule => 'script' in rule ? [rule.script.source] : []);
}
export type ScriptCheckError = 'timeout' | 'threw' | 'not-boolean' | 'not-function' | 'unavailable';
function validateVerifyRule(value: unknown, depth = 0): VerifyRule {
  if (depth > 4) throw new Error('Verification rules may nest at most four levels.');
  if (isRecord(value) && 'event' in value) {
    onlyKeys(value, ['event', 'after'], 'event rule');
    if (value.after !== undefined && value.after !== 'start' && value.after !== 'lastActivation') throw new Error('event rule after must be start or lastActivation.');
    if (!isRecord(value.event)) throw new Error('event rule needs an event object.');
    onlyKeys(value.event, ['kind', 'role', 'name', 'text', 'attr', 'value', 'url'], 'event');
    if (!(OBSERVED_EVENT_KINDS as readonly string[]).includes(String(value.event.kind))) throw new Error(`event.kind must be one of ${OBSERVED_EVENT_KINDS.join(', ')}.`);
    for (const key of ['role', 'attr', 'value']) if (value.event[key] !== undefined) text(value.event[key], `event.${key}`);
    for (const key of ['name', 'text', 'url']) if (value.event[key] !== undefined) validateTextMatcher(value.event[key], `event.${key}`);
    return value as EventVerificationRule;
  }
  if (!isRecord(value) || Object.keys(value).length !== 1) throw new Error('Each verification rule must contain one supported rule.');
  if ('focused' in value) {
    if (!isRecord(value.focused) || !Object.keys(value.focused).length) throw new Error('focused rule needs role and/or name.');
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
  if ('script' in value) {
    if (!isRecord(value.script)) throw new Error('script rule needs { source, description }.');
    onlyKeys(value.script, ['source', 'description'], 'script');
    const source = text(value.script.source, 'script.source');
    if (source.length > MAX_SCRIPT_SOURCE) throw new Error(`script.source must be at most ${MAX_SCRIPT_SOURCE} characters.`);
    if (!/^\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(source)) throw new Error('script.source must be a function expression such as (context) => boolean.');
    const description = text(value.script.description, 'script.description');
    if (description.length > 300) throw new Error('script.description must be at most 300 characters.');
    return value as ScriptVerificationRule;
  }
  if ('domEventSeen' in value && isRecord(value.domEventSeen)) {
    onlyKeys(value.domEventSeen, ['selector','event'], 'domEventSeen');
    text(value.domEventSeen.selector, 'domEventSeen.selector'); text(value.domEventSeen.event, 'domEventSeen.event'); return value as DomEventVerificationRule;
  }
  for (const key of ['requestSeen','responseSeen']) {
    const rule = value[key];
    if (!isRecord(rule)) continue;
    onlyKeys(rule, key === 'requestSeen' ? ['urlIncludes','method'] : ['urlIncludes','method','status'], key);
    text(rule.urlIncludes, `${key}.urlIncludes`);
    if (rule.method !== undefined) text(rule.method, `${key}.method`);
    if (rule.status !== undefined && (!Number.isInteger(rule.status) || (rule.status as number) < 100 || (rule.status as number) > 599)) throw new Error('responseSeen.status must be an HTTP status.');
    return value as RequestVerificationRule | ResponseVerificationRule;
  }
  throw new Error('Unsupported verification rule.');
}

/** Policy-facing view of a task's inputs: names, sensitivity and descriptions, and the value only of inputs marked not sensitive. */
export function describeInputs(task: Pick<Task, 'input' | 'inputOptions'>): Readonly<Record<string, InputDescriptor>> {
  return Object.freeze(Object.fromEntries(Object.entries(task.input ?? {}).map(([name, value]) => {
    const option = task.inputOptions?.[name], sensitive = option?.sensitive !== false;
    return [name, Object.freeze({ sensitive, ...(option?.description ? { description: option.description } : {}), ...(!sensitive ? { value } : {}) })];
  })));
}
/** How a candidate names what it types: the value itself for an input that is not sensitive, otherwise only the input's name. */
export function inputLabel(name: string, descriptor: InputDescriptor | undefined): string {
  const about = descriptor?.description ? `: ${descriptor.description}` : '';
  return descriptor?.value !== undefined ? `"${descriptor.value}" (input ${name}${about})` : `the secret input ${name}${about ? ` (${descriptor!.description})` : ''}`;
}
