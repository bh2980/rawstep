import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { collectBrowserDiagnostics, verifyLiveProfile, ProfileApplicationError, resolveEnvironmentProfile, type EnvironmentProfile, type NativeZoomController } from '../profiles/index.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createBrowserSession, isBotCheckPage, settlePage, BrowserSetupError, BrowserAccessBlockedError, type BrowserSession, type CreateBrowserSessionOptions } from '../browser/index.js';
import { describeInputs, resolveTask, type AllowedActions, type Backend, type Decision, type DecisionPolicy, type HistoryEntry, type Observation, type PolicyAction, type Task, type VerificationRecord, type VerificationWitness } from '@rawstep/core/contracts';
import { TraceRecorder, createRedactor, type RunOutcome, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import { RawstepError, findRawstepError } from '@rawstep/core/errors';
import { verifyTask, type VerificationContext } from '../verify/index.js';
import type { ObserverEvent, ObserverOptions } from '../observer/index.js';

export type RunOptions = {
  backend: Backend;
  profile?: EnvironmentProfile | string;
  nativeZoom?: NativeZoomController;
  /** Cooperative cancellation; already dispatched native commands cannot be undone. */
  signal?: AbortSignal;
  policy: DecisionPolicy;
  outDir: string;
  allowedActions?: { intents?: readonly string[]; keys?: readonly string[]; inputKeys?: readonly string[]; typeText?: boolean; replaceText?: boolean };
  diagnosticScreenshots?: boolean;
  /** Explicit opt-in: raw input keystrokes, echoed speech and screenshots may expose secrets. */
  includeSensitiveInputValues?: boolean;
  headless?: boolean;
  browserExecutablePath?: string;
  proxyServer?: string;
  browserSessionFactory?: (url: string, options: CreateBrowserSessionOptions) => Promise<BrowserSession>;
  /** Receives every stored (redacted) trace event as it is recorded, e.g. for a live dashboard. */
  onEvent?: (event: TraceEvent) => void;
  /** Page observer for hints; on by default. Never visible to the policy. */
  observe?: boolean | ObserverOptions;
  verifier?: (task: Task, browser: BrowserSession, context?: VerificationContext) => Promise<VerificationRecord>;
  /**
   * A person passes the site's own human checks: the run uses a visible browser with this kept profile, and whenever the page
   * shows a check it waits (up to `timeoutMs`, default 5 minutes) until the page is the site again. The wait does not count
   * against the task's time budget. Rawstep never answers a check itself.
   */
  personCheck?: { userDataDir: string; timeoutMs?: number };
};
const PERSON_CHECK_TIMEOUT_MS = 5 * 60_000, PERSON_CHECK_POLL_MS = 1000;
class BudgetExceeded extends Error { constructor() { super('Run time budget exceeded.'); this.name = 'BudgetExceeded'; } }
class RunAborted extends Error { constructor(readonly signal: 'SIGINT' | 'SIGTERM' | 'requested') { super(`Run cancelled (${signal}).`); this.name = 'RunAborted'; } }

/** The runner owns budgets, action restrictions and independent completion verification. */
export async function runTask(source: Task, options: RunOptions): Promise<RunTrace> {
  const resolved = resolveTask({ ...source, ...(options.profile ? { profile: resolveEnvironmentProfile(options.profile) } : {}) });
  const observationKind = options.backend.observationKind ?? 'screenreader';
  const simulation = options.backend.evidenceProvenance === 'simulation';
  const speechSource = simulation ? 'simulation' : 'screen-reader';
  const observationProvenance = observationKind === 'keyboard' ? 'keyboard' : options.backend.evidenceProvenance ?? 'unspecified';
  if (resolved.mode && resolved.mode !== observationKind) throw new Error(`Task mode ${resolved.mode} does not match backend observation kind ${observationKind}.`);
  const task: Task = { ...resolved, mode: resolved.mode ?? observationKind };
  if (!options.policy || typeof options.policy.decide !== 'function') throw new Error('A DecisionPolicy is required.');
  const allowedActions = resolveAllowedActions(task, options);
  const inputDescriptors = describeInputs(task);
  // What the policy observes: sensitive values are masked by backends (pixels) and here (speech).
  // Values under 4 characters cannot be hidden by substring matching without destroying unrelated speech; the withheld typing step covers their echo.
  const sensitiveValues = Object.entries(task.input ?? {}).filter(([name, value]) => inputDescriptors[name]!.sensitive && value.length >= 4).map(([, value]) => value);
  const maskForPolicy = createRedactor(sensitiveValues);
  const withheldObservations = new WeakSet<Observation>();
  const policyView = (value: Observation): Observation => value.kind !== 'screenreader' ? value
    : withheldObservations.has(value) ? { ...value, speech: ['[typed input withheld]'] }
    : { ...value, speech: value.speech.map(line => maskForPolicy(line).value) };
  const trace = new TraceRecorder({ ...task, id: task.id ?? randomUUID() }, options.outDir, { includeSensitiveInputValues: options.includeSensitiveInputValues, environment: { observationProvenance }, ...(options.onEvent ? { onEvent: options.onEvent } : {}) });
  await trace.initialize();
  const controller = new AbortController();
  // Moved later by the time a person spends passing a human check.
  let deadline = Date.now() + task.timeoutMs!;
  let stage = 'initialization';
  let activeStep = 0;
  let evidenceFailure: Error | undefined;
  const onExternalAbort = () => controller.abort(new RunAborted(options.signal?.reason === 'SIGINT' || options.signal?.reason === 'SIGTERM' ? options.signal.reason : 'requested'));
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (options.signal?.aborted) onExternalAbort();
  const recordEvidenceFailure = (error: unknown) => {
    evidenceFailure ??= error instanceof Error ? error : new Error('Trace persistence failed.');
    controller.abort(evidenceFailure);
  };
  const append = (...args: Parameters<TraceRecorder['append']>) => {
    try { return trace.append(...args); } catch (error) { recordEvidenceFailure(error); throw error; }
  };
  const bestEffortEvidence = (record: () => unknown) => { try { record(); } catch (error) { recordEvidenceFailure(error); } };
  const throwIfStopped = () => {
    if (evidenceFailure) throw evidenceFailure;
    controller.signal.throwIfAborted();
    if (Date.now() >= deadline) { const error = new BudgetExceeded(); controller.abort(error); throw error; }
  };
  const withinBudget = <T>(work: () => Promise<T> | T): Promise<T> => {
    try { throwIfStopped(); } catch (error) { return Promise.reject(error); }
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(evidenceFailure ?? controller.signal.reason); };
      const timer = setTimeout(() => controller.abort(new BudgetExceeded()), Math.max(1, deadline - Date.now()));
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { throwIfStopped(); return work(); }).then(value => {
        cleanup(); try { throwIfStopped(); resolve(value); } catch (error) { reject(error); }
      }, error => { cleanup(); reject(error); });
    });
  };
  let browser: BrowserSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let active = true;
  // Speech has no reliable completion/causal signal. Taint persists after input for late echoes.
  let inputTainted = false;
  let outcome: RunOutcome = { status: 'inconclusive', reason: 'maxSteps' };
  let steps = 0;
  const history: HistoryEntry[] = [];
  let latestActivation: VerificationContext['latestActivation'];
  const outputEventIds = new Map<number, string>();
  // Observer changes keep their structure after text entry so hints still work; only words are withheld.
  // The unredacted timeline stays in memory for goal rules; only the trace copy is redacted.
  const timeline: ObserverEvent[] = [];
  // Without a working observer there is no timeline at all, so event rules report "unavailable" rather than "nothing happened".
  const observedTimeline = (): { timeline?: readonly ObserverEvent[] } => browser?.observer?.available ? { timeline } : {};
  const drainObserver = () => { for (const event of browser?.observer?.take() ?? []) timeline.push(event), append(`observer.${event.kind}`, inputTainted ? redactObserverEvent(event) : event, { source: 'browser-diagnostic', timestamp: event.at, redacted: inputTainted }); };
  const recordBrowserDiagnostic = (type: string, data: unknown) => append(type, inputTainted ? { message: '[REDACTED]', reason: 'Browser diagnostics may contain delayed or form-encoded task input.' } : data, { source: 'browser-diagnostic', redacted: inputTainted });
  try {
    unsubscribe = options.backend.subscribe((event: unknown) => {
      if (!active) return;
      try {
      const data = event && typeof event === 'object' ? event as Record<string, unknown> : {};
      const storedEvent = inputTainted ? {
        type: data.type ?? 'event', sequence: data.sequence, timestamp: data.timestamp,
        commandId: data.commandId, windowId: data.windowId, method: data.method,
        payload: '[REDACTED]', reason: 'Possible input keystroke or asynchronous input echo'
      } : event;
      const entry = append(`backend.${String(data.type ?? 'event')}`, storedEvent, {
        source: observationKind === 'keyboard' ? 'runner' : speechSource,
        ...(typeof data.commandId === 'string' || typeof data.commandId === 'number' ? { commandId: String(data.commandId) } : {}),
        ...(typeof data.timestamp === 'number' ? { timestamp: new Date(data.timestamp).toISOString() } : {}),
        redacted: inputTainted
      });
      const candidate = data.output && typeof data.output === 'object' ? data.output as Record<string, unknown> : data;
      if (typeof candidate.sequence === 'number' && typeof candidate.text === 'string') outputEventIds.set(candidate.sequence, entry.id);
      } catch (error) { recordEvidenceFailure(error); }
    });
    stage = 'backend-start';
    const metadata = await withinBudget(() => options.backend.start({ signal: controller.signal }));
    append('backend.metadata', metadata, { source: 'runner' });
    // Each backend owns its host, visibility and pairing rules; the runner only supplies the facts.
    await withinBudget(() => options.backend.preflight?.({ headless: options.headless ?? false, platform: process.platform, customBrowserSession: !!options.browserSessionFactory }));
    if (metadata && typeof metadata === 'object') {
      const value = metadata as { environment?: Record<string, unknown> };
      if (value.environment) trace.updateEnvironment({
        screenReader: typeof value.environment.atName === 'string' ? value.environment.atName : 'unknown',
        screenReaderVersion: typeof value.environment.atVersion === 'string' ? value.environment.atVersion : 'unknown',
        ...(simulation ? { simulationEnvironment: value.environment } : { native: value.environment })
      });
    }
    // A launch that completes after the deadline still owns resources and must close them.
    stage = 'browser-start';
    browser = await withinBudget(async () => {
      const opened = await (options.browserSessionFactory ?? createBrowserSession)(task.url, { headless: options.personCheck ? false : options.headless ?? false, ...(options.personCheck ? { userDataDir: options.personCheck.userDataDir } : {}), executablePath: options.browserExecutablePath, proxyServer: options.proxyServer, ...(options.observe !== undefined ? { observe: options.observe } : {}), navigation: task.navigation, verify: task.verify, profile: task.profile, nativeZoom: options.nativeZoom });
      if (controller.signal.aborted) { await opened.close(); throw controller.signal.reason; }
      try { await options.backend.attachSession?.(opened); } catch (error) { await opened.close(); throw error; }
      return opened;
    });
    await withinBudget(() => browser!.page.bringToFront());
    /**
     * While the page shows a human check, wait for the person to pass it in the visible window. The waiting is recorded and
     * added back to the time budget; a check nobody passes in time ends the run as access-blocked.
     */
    const waitForPerson = async (step: number) => {
      if (!options.personCheck || !(await withinBudget(() => isBotCheckPage(browser!.page)))) return;
      const started = Date.now(), limit = options.personCheck.timeoutMs ?? PERSON_CHECK_TIMEOUT_MS;
      append('run.waiting-for-person', { step, reason: 'bot-check', timeoutMs: limit }, { source: 'runner' });
      for (;;) {
        if (evidenceFailure) throw evidenceFailure;
        controller.signal.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, PERSON_CHECK_POLL_MS));
        if (!(await isBotCheckPage(browser!.page).catch(() => true))) break;
        if (Date.now() - started > limit) {
          append('run.person-check-timeout', { step, waitedMs: Date.now() - started }, { source: 'runner' });
          throw new BrowserAccessBlockedError(browser!.page.url(), undefined, 'The human check was not passed in time; Rawstep does not answer checks itself.');
        }
      }
      const waitedMs = Date.now() - started;
      deadline += waitedMs;
      await withinBudget(() => settlePage(browser!.page));
      append('run.person-resumed', { step, waitedMs }, { source: 'runner' });
    };
    await waitForPerson(0);
    // Keys must reach the page, not browser UI or another window. A real user starts on the document with nothing focused
    // (unless the page uses autofocus), so the runner never moves focus to an element itself.
    const readInitialFocus = () => browser!.page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const element = active && active !== document.body && active !== document.documentElement ? active : null;
      return { documentHasFocus: document.hasFocus(), focused: element ? { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), autofocus: element.hasAttribute('autofocus') } : null };
    });
    // Best effort: a session that cannot evaluate scripts simply records nothing; cancellation and budgets still apply.
    const tryInitialFocus = async (): Promise<unknown> => { try { return await withinBudget(readInitialFocus); } catch (error) { if (controller.signal.aborted || evidenceFailure || error instanceof BudgetExceeded) throw error; return undefined; } };
    let initialFocus: unknown = await tryInitialFocus();
    if (initialFocus && typeof initialFocus === 'object' && (initialFocus as { documentHasFocus?: unknown }).documentHasFocus === false) {
      await withinBudget(() => browser!.page.evaluate(() => window.focus())).catch(error => { if (controller.signal.aborted || evidenceFailure || error instanceof BudgetExceeded) throw error; });
      const retried = await tryInitialFocus();
      initialFocus = retried && typeof retried === 'object' ? { ...retried, focusRequested: true } : initialFocus;
      // Native screen readers send real OS keys: without page focus they would land in browser UI or another window.
      if ((initialFocus as { documentHasFocus?: unknown }).documentHasFocus === false && options.backend.evidenceProvenance === 'native') throw new RawstepError('backend-precondition', 'The browser page does not have keyboard focus; native key presses would reach browser UI or another window.');
    }
    if (initialFocus && typeof initialFocus === 'object') append('browser.initial-focus', initialFocus, { source: 'browser-diagnostic' });
    trace.updateEnvironment({ browser: 'chromium', browserVersion: browser.browser?.version?.() ?? 'unknown' });
    if (task.profile) {
      if (!browser.appliedProfile) throw new Error('Browser factory did not verify the requested environment profile.');
      append('browser.profile', browser.appliedProfile, { source: 'browser-diagnostic' });
      trace.updateEnvironment({ profile: browser.appliedProfile });
      if (task.profile.at) {
        const actual = metadata && typeof metadata === 'object' ? (metadata as { environment?: Record<string, unknown> }).environment : undefined;
        const matches = actual?.atName === task.profile.at.name && (!task.profile.at.version || actual?.atVersion === task.profile.at.version) && (!task.profile.at.configuration || actual?.configuration === task.profile.at.configuration);
        append('browser.at-profile', { requested: task.profile.at, actual: actual ?? null, verified: matches }, { source: 'browser-diagnostic' });
        if (!matches && task.profile.requireApplied) throw new ProfileApplicationError({...browser.appliedProfile,supported:false,settings:[...browser.appliedProfile.settings,{name:'at',requested:task.profile.at,observed:actual??null,status:'mismatch',mechanism:'metadata',detail:'Requested AT name/version/configuration is not proved by the backend handshake.'}]});
      }
    }
    if (browser.observer) append('observer.metadata', { available: browser.observer.available, world: 'isolated', policyVisible: false, ...(browser.observer.unavailableReason ? { reason: browser.observer.unavailableReason } : {}), limitations: ['Accessible names are approximated in the page and truncated; form values are never read.', 'Cross-origin iframes running in another process are not observed.'] }, { source: 'browser-diagnostic' });
    append('browser.metadata', { name: 'chromium', version: browser.browser?.version?.() ?? 'unknown', headless: options.headless ?? false }, { source: 'browser-diagnostic' });
    append('run.started', { maxSteps: task.maxSteps, timeoutMs: task.timeoutMs, allowedActions });
    const observe = async (): Promise<Observation> => {
      stage = 'observation';
      if (task.profile) {
        const settings = await withinBudget(() => verifyLiveProfile(browser!.page, task.profile!));
        append('browser.profile-check', inputTainted ? { step: activeStep, verified:settings.every(s=>s.status==='applied'), details: '[REDACTED]' } : { step: activeStep, verified:settings.every(s=>s.status==='applied'), settings }, { source:'browser-diagnostic', redacted:inputTainted });
        if (task.profile.requireApplied && settings.some(s=>s.status==='mismatch')) throw new ProfileApplicationError({ ...browser!.appliedProfile!, settings, supported:false, verifiedAt:new Date().toISOString() });
      }
      if (task.profile?.diagnostics) {
        const diagnostic = await withinBudget(() => collectBrowserDiagnostics(browser!.page));
        append('browser.accessibility-diagnostic', inputTainted ? { step: activeStep, details: '[REDACTED]' } : { step: activeStep, diagnostic }, { source: 'browser-diagnostic', redacted: inputTainted });
      }
      const collected = await withinBudget(() => options.backend.observe({ signal: controller.signal }));
      if ((collected.kind ?? 'screenreader') !== observationKind) throw new Error('Backend returned an observation that does not match its declared modality.');
      if (collected.kind === 'keyboard') {
        if (options.backend.observationKind !== 'keyboard') throw new Error('A screen-reader backend cannot expose screenshots to its policy.');
        const observation: Observation = { kind: 'keyboard', screenshot: collected.screenshot,
          ...(collected.previousScreenshot ? { previousScreenshot: collected.previousScreenshot } : {}),
          window: { id: collected.windowId, startedAt: collected.startedAt, endedAt: collected.endedAt, reason: collected.reason } };
        append('keyboard.observation', inputTainted ? { kind: 'keyboard', window: observation.window, screenshot: '[REDACTED]' } : observation, {
          source: 'runner', redacted: inputTainted, collectionWindow: { startedAt: collected.startedAt, endedAt: collected.endedAt }
        });
        return observation;
      }
      const ids = collected.outputs.map(output => {
        let id = outputEventIds.get(output.sequence);
        if (!id) {
          id = append(`${speechSource}.output`, inputTainted ? { sequence: output.sequence, receivedAt: output.receivedAt, text: '[REDACTED]', raw: '[REDACTED]' } : output, { source: speechSource, timestamp: output.receivedAt, redacted: inputTainted }).id;
          outputEventIds.set(output.sequence, id);
        }
        return id;
      });
      const observation: Observation = { kind: 'screenreader', ...(options.backend.evidenceProvenance ? { provenance: options.backend.evidenceProvenance } : {}), speech: [...collected.speech], outputEventIds: ids, window: { id: collected.windowId, startedAt: collected.startedAt, endedAt: collected.endedAt, reason: collected.reason } };
      append(`${speechSource}.observation`, { ...observation, ...(inputTainted ? { speech: ['[REDACTED]'] } : {}), association: 'temporal-only', speechCompletionKnown: false }, { source: speechSource, redacted: inputTainted, collectionWindow: { startedAt: collected.startedAt, endedAt: collected.endedAt } });
      return observation;
    };
    let observation = await observe();
    drainObserver();
    /** A screenshot for people only (`policyVisible: false`), never after text entry. Step 0 is the page before the first action. */
    const diagnosticScreenshot = async (step: number) => {
      if (!options.diagnosticScreenshots) return;
      if (inputTainted) { append('browser.screenshot-redacted', { step, policyVisible: false, reason: 'Diagnostic screenshot omitted after text entry.' }, { source: 'browser-diagnostic', redacted: true }); return; }
      await mkdir(join(options.outDir, 'diagnostics'), { recursive: true });
      const path = join(options.outDir, 'diagnostics', `step-${step}.png`);
      await withinBudget(() => browser!.page.screenshot({ path }));
      append('browser.screenshot', { step, path: `diagnostics/step-${step}.png`, policyVisible: false }, { source: 'browser-diagnostic' });
    };
    const verify = async (step: number): Promise<VerificationRecord> => {
      stage = 'verification';
      drainObserver();
      const result = await withinBudget(() => (options.verifier ?? verifyTask)(task, browser!, { latestActivation, ...observedTimeline() }));
      const rules = result.rules?.map(({ witnesses, failure, ...rule }) => ({
        ...rule, ...(failure ? { failure: inputTainted ? 'Verification rule failed; details redacted after text entry.' : failure } : {}),
        evidenceEventIds: witnesses.map(witness => append('verifier.evidence', {
          step, ruleIndex: rule.ruleIndex, ruleType: rule.ruleType, passed: rule.passed,
          witness: inputTainted ? redactVerificationWitness(witness) : witness
        }, { source: 'verifier', redacted: inputTainted }).id)
      }));
      append('verifier.result', { step, passed: result.passed,
        failures: inputTainted ? result.failures.map(() => 'Verification rule failed; details redacted after text entry.') : result.failures,
        ...(rules ? { rules } : {})
      }, { source: 'verifier', redacted: inputTainted });
      return result;
    };
    // Baseline: which goal rules already hold before any action. Recorded for hints; it never decides the outcome.
    // Built-in verifier only: custom verifiers may have side effects or remote calls, and run only when deciding.
    if (!options.verifier) try {
      stage = 'verification';
      const baseline = await withinBudget(() => verifyTask(task, browser!, observedTimeline()));
      append('verifier.baseline', { passed: baseline.passed, rules: (baseline.rules ?? []).map(({ ruleIndex, ruleType, passed }) => ({ ruleIndex, ruleType, passed })) }, { source: 'verifier' });
    } catch (error) {
      if (controller.signal.aborted || evidenceFailure || error instanceof BudgetExceeded) throw error;
      // Error text can carry page URLs or echoed values; keep only its type.
      append('verifier.baseline', { error: error instanceof Error ? error.name : 'Error' }, { source: 'verifier' });
    }
    await diagnosticScreenshot(0);
    for (let step = 1; step <= task.maxSteps!; step++) {
      activeStep = step;
      stage = 'policy';
      const decision = await withinBudget(() => options.policy.decide({ goal: task.goal, observation: structuredClone(policyView(observation)), history: structuredClone(history.map(entry => ({ ...entry, observation: policyView(entry.observation) }))), allowedActions: structuredClone(allowedActions), inputs: inputDescriptors, signal: controller.signal }));
      for (const evidence of options.policy.takeDecisionEvidence?.() ?? []) {
        append('policy.evidence', inputTainted ? { step, details: '[REDACTED]', reason: 'Model evidence omitted after text entry.' } : { step, evidence }, { source: 'policy', redacted: inputTainted });
      }
      try { validateDecision(decision, allowedActions); }
      catch (error) {
        append('policy.rejected', { step, ...rejectedDecisionDetails(decision, inputTainted), reasonCode: 'action-not-allowed', reason: errorMessage(error) }, { source: 'policy', redacted: inputTainted });
        throw error;
      }
      steps = step;
      append('policy.decision', { step, decision: inputTainted ? ('action' in decision ? { action: decision.action } : { stop: decision.stop, ...(decision.stopSource ? { stopSource: decision.stopSource } : {}) }) : decision }, { source: 'policy', redacted: inputTainted });
      if ('stop' in decision) {
        const verification = await verify(step);
        outcome = verification.passed ? { status: 'success', reason: 'verified', policyStop: decision.stop } : { status: 'failure', reason: decision.stop === 'success' ? 'verification-failed' : decision.stop === 'uncertain' ? 'policy-uncertain' : 'policy-stuck' };
        if (!verification.passed && decision.stop === 'uncertain') outcome.status = 'inconclusive';
        if (decision.stopSource === 'model' || decision.stopSource === 'exploration-guard') outcome.policyStopSource = decision.stopSource;
        history.push({ step, decision, observation });
        break;
      }
      const action = decision.action;
      let execution: { ok: boolean; error?: string };
      try {
        stage = 'action';
        browser.observer?.setStep(step);
        if (action.kind === 'typeText' || action.kind === 'replaceText') {
          const editable = await withinBudget(() => isEditable(browser!));
          append('browser.input-gate', { step, editable }, { source: 'browser-diagnostic' });
          if (!editable) throw new Error('Text entry requires an editable focused field.');
          if (!options.includeSensitiveInputValues) {
            inputTainted = true;
            append('privacy.input-taint', { step, reason: 'Subsequent protocol payloads, speech and diagnostic screenshots are redacted because late input echoes cannot be attributed reliably.' }, { redacted: true });
          }
          await withinBudget(() => options.backend.execute({ kind: action.kind, text: task.input![action.input]!, sensitive: inputDescriptors[action.input]!.sensitive }, { signal: controller.signal }));
        } else await withinBudget(() => options.backend.execute(action, { signal: controller.signal }));
        execution = { ok: true };
      } catch (error) {
        // An error that names its own run outcome ends the run instead of becoming a failed action.
        if (error instanceof RawstepError && error.outcome) throw error;
        if (controller.signal.aborted || evidenceFailure || error instanceof BudgetExceeded) throw evidenceFailure ?? controller.signal.reason ?? error;
        execution = { ok: false, error: inputTainted ? 'Execution failed after text entry; raw error redacted.' : errorMessage(error) };
      }
      append('action.result', { step, action, ...execution });
      history.push({ step, decision, observation, execution });
      if (execution.ok) { stage = 'settling'; await withinBudget(() => settlePage(browser!.page)); }
      await waitForPerson(step);
      observation = await observe();
      // Character-by-character echoes of a sensitive value cannot be matched; withhold that step's speech from the policy.
      if (execution.ok && (action.kind === 'typeText' || action.kind === 'replaceText') && inputDescriptors[action.input]!.sensitive) withheldObservations.add(observation);
      if (execution.ok && isActivation(action)) latestActivation = { step, action, observation };
      drainObserver();
      for (const blocked of browser.takeBlockedNavigations()) recordBrowserDiagnostic('browser.navigation-blocked', blocked);
      for (const warning of browser.takeNavigationGuardWarnings()) recordBrowserDiagnostic('browser.navigation-warning', warning);
      await diagnosticScreenshot(step);
      if ((await verify(step)).passed) { outcome = { status: 'success', reason: 'verified' }; break; }
    }
  } catch (error) {
    bestEffortEvidence(() => {
    if (error instanceof BrowserSetupError) {
      for (const blocked of error.blockedNavigations) recordBrowserDiagnostic('browser.navigation-blocked', blocked);
      for (const warning of error.warnings) recordBrowserDiagnostic('browser.navigation-warning', warning);
    }
    });
    const accessError = error instanceof BrowserAccessBlockedError ? error : error instanceof Error && error.cause instanceof BrowserAccessBlockedError ? error.cause : undefined;
    if(accessError)bestEffortEvidence(()=>recordBrowserDiagnostic('browser.access-blocked',{url:accessError.url,status:accessError.status,reason:accessError.message}));
    const profileError = error instanceof ProfileApplicationError ? error : error instanceof Error && error.cause instanceof ProfileApplicationError ? error.cause : undefined;
    if (profileError) bestEffortEvidence(() => {
      // Profile measurements are page-derived and can contain arbitrary delayed or
      // encoded input echoes. Error paths follow the same taint rule as observe().
      const profile = inputTainted ? { supported: false, details: '[REDACTED]', reason: 'Profile details omitted after text entry.' } : profileError.appliedProfile;
      append('browser.profile', profile, { source: 'browser-diagnostic', redacted: inputTainted });
      trace.updateEnvironment({ profile }, { redacted: inputTainted });
    });
    if (error instanceof RunAborted && !evidenceFailure) {
      const cancellation = { signal: error.signal, stage, step: activeStep };
      outcome = { status: 'aborted', reason: 'aborted', stage, step: activeStep, cancellation };
      bestEffortEvidence(() => append('run.aborted', cancellation));
    } else {
      outcome = { status: error instanceof BudgetExceeded ? 'inconclusive' : 'failure', reason: error instanceof BudgetExceeded ? 'timeout' : 'error', stage, step: activeStep, error: inputTainted ? 'Run failed after text entry; raw error redacted.' : errorMessage(error) };
      const hint = findRawstepError(error, candidate => !!candidate.outcome)?.outcome;
      if (hint) outcome = { ...outcome, ...hint };
      bestEffortEvidence(() => append('run.error', { stage, step: activeStep, message: inputTainted ? 'Run failed after text entry; raw error redacted.' : errorMessage(error) }, { redacted: inputTainted }));
    }
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    bestEffortEvidence(() => {
    if (browser) {
      drainObserver();
      const dropped = browser.observer?.dropped() ?? {};
      if (Object.keys(dropped).length) append('observer.dropped', { perStep: dropped, reason: 'Per-step observer cap reached; later changes in those steps were not recorded.' }, { source: 'browser-diagnostic' });
      for (const blocked of browser.takeBlockedNavigations()) recordBrowserDiagnostic('browser.navigation-blocked', blocked);
      for (const warning of browser.takeNavigationGuardWarnings()) recordBrowserDiagnostic('browser.navigation-warning', warning);
    }
    });
    // Bound cleanup too. A server disconnect never turns an observed success into failure.
    for (const [name, close] of [['backend', () => options.backend.close()], ['browser', () => browser?.close()]] as const) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([Promise.resolve().then(close), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} cleanup timed out`)), name === 'backend' ? options.backend.cleanupTimeoutMs ?? RAWSTEP_DEFAULTS.cleanupTimeoutMs.default : RAWSTEP_DEFAULTS.cleanupTimeoutMs.default); })]); }
      catch (error) { bestEffortEvidence(() => append('run.cleanup-warning', { resource: name, message: inputTainted ? 'Cleanup failed; raw error redacted.' : errorMessage(error) }, { redacted: inputTainted })); }
      finally { if (timer) clearTimeout(timer); }
    }
    active = false;
    unsubscribe?.();
  }
  return trace.finalize(evidenceFailure ? { status: 'failure', reason: 'trace-persistence-error', stage, step: activeStep, steps } : { stage, step: activeStep, ...outcome, steps });
}

function resolveAllowedActions(task: Task, options: RunOptions): AllowedActions {
  const capabilities = options.backend.capabilities;
  const subset = (requested: readonly string[] | undefined, supported: readonly string[], label: string) => {
    const values = requested ?? supported;
    if (values.some(value => !supported.includes(value))) throw new Error(`Unsupported ${label} in allowedActions.`);
    return [...new Set(values)];
  };
  return {
    intents: subset(options.allowedActions?.intents, capabilities.intents, 'intent'),
    keys: subset(options.allowedActions?.keys, capabilities.keys, 'key'),
    inputKeys: capabilities.textEntry && (options.allowedActions?.typeText !== false || (capabilities.replaceText && options.allowedActions?.replaceText !== false)) ? subset(options.allowedActions?.inputKeys, Object.keys(task.input ?? {}), 'input key') : [],
    typeText: capabilities.textEntry && options.allowedActions?.typeText !== false,
    replaceText: capabilities.replaceText && options.allowedActions?.replaceText !== false
  };
}
export function validateDecision(decision: unknown, allowed: AllowedActions): asserts decision is Decision {
  if (!decision || typeof decision !== 'object') throw new Error('Policy returned an invalid decision.');
  const item = decision as Record<string, unknown>;
  if ('stop' in item && !('action' in item) && (item.stop === 'success' || item.stop === 'stuck' || item.stop === 'uncertain')) return;
  if ('stop' in item || !item.action || typeof item.action !== 'object') throw new Error('Policy decision must contain an action or stop.');
  const action = item.action as Record<string, unknown>;
  if (action.kind === 'intent' && typeof action.intent === 'string' && allowed.intents.includes(action.intent)) return;
  if (action.kind === 'key' && typeof action.key === 'string' && allowed.keys.includes(action.key)) return;
  if (((action.kind === 'typeText' && allowed.typeText !== false) || (action.kind === 'replaceText' && allowed.replaceText)) && typeof action.input === 'string' && allowed.inputKeys.includes(action.input)) return;
  throw new Error('Policy action is not allowed by the task and backend capabilities.');
}
function isActivation(action: PolicyAction): boolean { return (action.kind === 'intent' && action.intent === 'activate') || (action.kind === 'key' && ['Enter','Space'].includes(action.key)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function isEditable(browser: BrowserSession): Promise<boolean> {
  return browser.page.evaluate(() => {
    if (!document.hasFocus()) return false;
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active instanceof HTMLTextAreaElement) return !active.disabled && !active.readOnly;
    if (active instanceof HTMLInputElement) return !active.disabled && !active.readOnly && ['text','search','email','url','tel','password','number'].includes(active.type);
    return active instanceof HTMLElement && active.isContentEditable === true;
  });
}

function rejectedDecisionDetails(decision: unknown, tainted: boolean): Record<string, unknown> {
  if (!decision || typeof decision !== 'object') return { action: { kind: 'invalid' } };
  const candidate = (decision as Record<string, unknown>).action;
  if (!candidate || typeof candidate !== 'object') return { action: { kind: 'invalid' } };
  const action = candidate as Record<string, unknown>;
  const kind = ['key', 'intent', 'typeText', 'replaceText'].includes(String(action.kind)) ? action.kind : 'invalid';
  if (tainted) return { action: { kind, details: '[REDACTED]' } };
  return { action: { kind, ...Object.fromEntries(['key', 'intent', 'input'].filter(key => typeof action[key] === 'string').map(key => [key, action[key]])) } };
}

function redactObserverEvent(event: ObserverEvent): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...event };
  for (const key of ['name', 'text', 'value', 'url'] as const) if (safe[key] !== undefined && safe[key] !== null) safe[key] = '[REDACTED]';
  return safe;
}

function redactVerificationWitness(witness: VerificationWitness): Record<string, unknown> {
  const safe: Record<string, unknown> = { kind: witness.kind, details: '[REDACTED]' };
  if (witness.kind === 'response') { safe.status = witness.status; safe.ok = witness.ok; }
  if (witness.kind === 'visible-text') { safe.matchIndex = witness.matchIndex; safe.visible = witness.visible; if (witness.textSource) safe.textSource = witness.textSource; }
  if ('timestamp' in witness) safe.timestamp = witness.timestamp;
  if (witness.kind === 'observer-event') safe.event = { kind: witness.event.kind, step: witness.event.step, ...(witness.event.role !== undefined ? { role: witness.event.role } : {}) };
  if (witness.kind === 'activation-speech') {
    if (witness.provenance) safe.provenance = witness.provenance;
    safe.outputEventIds = witness.outputEventIds;
    safe.activationStep = witness.activationStep;
    safe.window = { id: witness.window.id, startedAt: witness.window.startedAt, endedAt: witness.window.endedAt };
    safe.association = witness.association;
  }
  return safe;
}
