import { REDACTED } from '../redacted.js';
import { isActivation } from '../actions.js';
import { RAWSTEP_DEFAULTS } from '../defaults.js';
import { resolveEnvironmentProfile } from '../profiles/schema.js';
import type { EnvironmentProfile } from '../profiles/types.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { describeInputs, flattenVerifyRules, resolveTask, STOP_SOURCES, type ActionExecution, type AllowedActions, type Backend, type BackendEvent, type BackendReceipt, type Decision, type DecisionPolicy, type HistoryEntry, type Observation, type Task, type VerificationRecord, type VerificationWitness, type VerifyRule } from '../contracts/index.js';
import { TraceRecorder, createRedactor, type RunOutcome, type RunStage, type RunTrace, type TraceEvent } from '../trace/index.js';
import { RawstepError, findRawstepError } from '../errors.js';
import type { Surface, SurfaceContext, SurfaceOpener, SurfaceVerificationContext } from './surface.js';
export type { Surface, SurfaceContext, SurfaceOpener, SurfaceVerificationContext } from './surface.js';

export type RunOptions = {
  backend: Backend;
  /** Where the run takes place: a web page (`webSurface` from `@rawstep/browser/surface`) or another surface. */
  surface: SurfaceOpener;
  profile?: EnvironmentProfile | string;
  /** Cooperative cancellation; already dispatched native commands cannot be undone. */
  signal?: AbortSignal;
  policy: DecisionPolicy;
  outDir: string;
  allowedActions?: { intents?: readonly string[]; keys?: readonly string[]; inputKeys?: readonly string[]; typeText?: boolean; replaceText?: boolean };
  diagnosticScreenshots?: boolean;
  /**
   * Screen reader runs: actions the run goes on after the goal is reached when nothing the user heard said so (default 0: stop at
   * once). The page may show "Added to cart" without announcing it; stopping there would hide the user's not knowing. Within the
   * grace the policy may stop, and the run ends when it runs out; `goal.reached` records the step and whether it was heard, `goal.heard`
   * a confirmation heard later. The outcome is decided by the goal check either way: `goalConfirmed: false` notes that nothing showed
   * the user knew, and `goalStep` where the goal check passed when the run went on after it.
   */
  confirmationGrace?: number;
  /**
   * How long to keep listening when a press said nothing, in milliseconds (default 0). A person waits a moment before deciding nothing
   * happened, and the answer can come later than one collection window. No key is pressed, so it costs no move.
   */
  silentPressWaitMs?: number;
  /** Explicit opt-in: raw input keystrokes and echoed speech may expose secrets. */
  includeSensitiveInputValues?: boolean;
  /**
   * How long one decision may take, in milliseconds. Waiting for the policy is not page time, so the task's time limit does not bound
   * it; this does, for a policy that hangs. Default 30 minutes: a planner call is already bounded by its connection's limit.
   */
  policyTimeoutMs?: number;
  /** Receives every stored (redacted) trace event as it is recorded, e.g. for a live dashboard. */
  onEvent?: (event: TraceEvent) => void;
  /** The experiment conditions this run was made with (model combo, action set, environments, run rules), recorded at `run.started`. */
  conditions?: Record<string, unknown>;
};
/** The longest one policy decision may take (see `policyTimeoutMs`). */
const POLICY_TIMEOUT_MS = 30 * 60_000;
const SILENCE_POLL_MS = 250;
/** Text entry found no editable focused field; recorded as the `not-editable` failure the model may see. */
class NotEditableError extends Error { constructor() { super('Text entry requires an editable focused field.'); this.name = 'NotEditableError'; } }
class BudgetExceeded extends Error { constructor() { super('Run time budget exceeded.'); this.name = 'BudgetExceeded'; } }
class RunAborted extends Error { constructor(readonly signal: 'SIGINT' | 'SIGTERM' | 'requested') { super(`Run cancelled (${signal}).`); this.name = 'RunAborted'; } }

/** The runner owns budgets, action restrictions and independent completion verification; the surface owns the place it runs in. */
export async function runWithPolicy(source: Task, options: RunOptions): Promise<RunTrace> {
  const task = resolveTask({ ...source, ...(options.profile ? { profile: resolveEnvironmentProfile(options.profile) } : {}) });
  const simulation = options.backend.evidenceProvenance === 'simulation';
  const speechSource = simulation ? 'simulation' : 'screen-reader';
  const observationProvenance = options.backend.evidenceProvenance ?? 'unspecified';
  if (!options.policy || typeof options.policy.decide !== 'function') throw new Error('A DecisionPolicy is required.');
  if (!options.surface || typeof options.surface.open !== 'function') throw new Error('A surface is required: where the run takes place.');
  const allowedActions = resolveAllowedActions(task, options);
  const inputDescriptors = describeInputs(task);
  // What the policy observes: sensitive values are masked here.
  // Values under 4 characters cannot be hidden by substring matching without destroying unrelated speech; the withheld typing step covers their echo.
  const sensitiveValues = Object.entries(task.input ?? {}).filter(([name, value]) => inputDescriptors[name]!.sensitive && value.length >= 4).map(([, value]) => value);
  const maskForPolicy = createRedactor(sensitiveValues);
  // Every secret, however short, for checking whether the page shows one before a screenshot.
  const secretValues = Object.entries(task.input ?? {}).filter(([name, value]) => inputDescriptors[name]!.sensitive && value).map(([, value]) => value);
  const withheldObservations = new WeakSet<Observation>();
  // The title gets the same masking as speech: a site can reflect typed text in it as well.
  const policyView = (value: Observation): Observation => {
    const { title, ...rest } = value;
    if (withheldObservations.has(value)) { const { announcements: _withheld, ...bare } = rest; return { ...bare, speech: ['[typed input withheld]'] }; }
    return { ...rest, speech: value.speech.map(line => maskForPolicy(line).value), ...(title ? { title: maskForPolicy(title).value } : {}), ...(value.announcements ? { announcements: value.announcements.map(line => maskForPolicy(line).value) } : {}) };
  };
  /** Titles the screen reader has actually spoken; only those reach the policy, never one read from the surface unheard. */
  const heardTitles = new Set<string>();
  const trace = new TraceRecorder({ ...task, id: task.id ?? randomUUID() }, options.outDir, { includeSensitiveInputValues: options.includeSensitiveInputValues, environment: { observationProvenance }, ...(options.onEvent ? { onEvent: options.onEvent } : {}) });
  await trace.initialize();
  const controller = new AbortController();
  // Page time only: moved later by the time a person spends passing a human check and the time spent waiting for the policy.
  let deadline = Date.now() + task.timeoutMs!;
  let stage: RunStage = 'initialization';
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
  /**
   * Time that is not page time (waiting for the policy, a person passing a check): the deadline moves by that wait. Cancellation still
   * stops it, and `limitMs`, when given, bounds it.
   */
  const offClock = async <T>(work: () => Promise<T> | T, limitMs?: number): Promise<T> => {
    throwIfStopped();
    const started = Date.now();
    try {
      return await new Promise<T>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(evidenceFailure ?? controller.signal.reason); };
        const timer = limitMs === undefined ? undefined : setTimeout(() => controller.abort(new BudgetExceeded()), limitMs);
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(work).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      });
    } finally { deadline += Date.now() - started; }
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
  /** What ends the run whatever it was doing: a cancel, the time budget, or a trace that can no longer be written. */
  const endsRun = (error: unknown): boolean => controller.signal.aborted || !!evidenceFailure || error instanceof BudgetExceeded;
  /**
   * A look the run can do without (the title, where focus is, whether a check is showing): when it fails the run goes on with
   * `fallback`. What ends the run is never swallowed with it. The one rule for every such look.
   */
  const bestEffort = <T, F>(work: () => Promise<T> | T, fallback: F): Promise<T | F> => withinBudget(work).catch((error: unknown) => { if (endsRun(error)) throw error; return fallback; });
  let surface: Surface | undefined;
  let unsubscribe: (() => void) | undefined;
  let active = true;
  /**
   * Set while a secret is being typed: everything recorded then (keystroke payloads, the character echo, surface diagnostics) is
   * withheld, because those echoes cannot be matched as whole values. The trace masks the secret's whole value everywhere on its own,
   * so with the simulation, whose speech is exact text, the record opens again once the typing step's speech has been taken. A real
   * screen reader can echo late and in its own words, so there it stays withheld for the rest of the run.
   */
  let inputTainted = false;
  /** A secret has been typed: screenshots from then on hide form fields, and are left out when the screen shows the secret. */
  let secretTyped = false;
  let outcome: RunOutcome = { status: 'inconclusive', reason: 'maxSteps' };
  /** The goal as of its last check, and whether the user heard so. An action that undoes it clears it. */
  let reached: { step: number; heard: boolean | undefined } | undefined;
  /**
   * The goal holds, so the run reached it. Whether the user knew is a note beside that: a stop for any reason but saying they were done,
   * or a confirmation never heard, leaves `goalConfirmed: false`. Moves after the goal check passed are not its cost, so `goalStep` keeps where it did.
   */
  const goalHolds = (stop?: string): RunOutcome => ({ status: 'success', reason: 'verified', ...(stop ? { policyStop: stop } : {}), ...((stop ? stop !== 'success' : reached?.heard === false) ? { goalConfirmed: false } : {}), ...(reached && reached.step < steps ? { goalStep: reached.step } : {}) });
  let steps = 0;
  const history: HistoryEntry[] = [];
  let latestActivation: SurfaceVerificationContext['latestActivation'];
  const outputEventIds = new Map<number, string>();
  let backendEnvironment: SurfaceContext['backend']['environment'];
  const context: SurfaceContext = {
    outDir: options.outDir, signal: controller.signal, append, tainted: () => inputTainted,
    updateEnvironment: (fields, appendOptions) => { trace.updateEnvironment(fields, appendOptions); },
    withinBudget, bestEffort, offClock: work => offClock(work),
    backend: {
      attach: async session => { await options.backend.attachSession?.(session); },
      get environment() { return backendEnvironment; },
      native: options.backend.evidenceProvenance === 'native',
    },
  };
  try {
    unsubscribe = options.backend.subscribe(event => {
      if (!active) return;
      try {
      const data: Partial<BackendEvent> = event && typeof event === 'object' ? event : {};
      const storedEvent = inputTainted ? {
        type: data.type ?? 'event', sequence: data.sequence, timestamp: data.timestamp,
        commandId: data.commandId, windowId: data.windowId, method: data.method,
        payload: REDACTED, reason: 'Possible input keystroke or asynchronous input echo'
      } : event;
      const entry = append(`backend.${String(data.type ?? 'event')}`, storedEvent, {
        source: speechSource,
        ...(typeof data.commandId === 'string' || typeof data.commandId === 'number' ? { commandId: String(data.commandId) } : {}),
        ...(typeof data.timestamp === 'number' ? { timestamp: new Date(data.timestamp).toISOString() } : {}),
        redacted: inputTainted
      });
      // The piece of speech an event carries, in either shape the contract allows.
      const said = data.output && typeof data.output === 'object' ? data.output : data;
      if (typeof said.sequence === 'number' && typeof said.text === 'string') outputEventIds.set(said.sequence, entry.id);
      } catch (error) { recordEvidenceFailure(error); }
    });
    stage = 'backend-start';
    const metadata = await withinBudget(() => options.backend.start({ signal: controller.signal }));
    append('backend.metadata', metadata, { source: 'runner' });
    // Each backend owns its host, visibility and pairing rules; the runner only supplies the facts.
    await withinBudget(() => options.backend.preflight?.({ platform: process.platform, surface: options.surface.facts }));
    // A backend written outside TypeScript can still return anything: only an object's `environment` is read.
    const reader = metadata && typeof metadata === 'object' && metadata.environment && typeof metadata.environment === 'object' ? metadata.environment : undefined;
    backendEnvironment = reader;
    if (reader) trace.updateEnvironment({
      screenReader: typeof reader.atName === 'string' ? reader.atName : 'unknown',
      screenReaderVersion: typeof reader.atVersion === 'string' ? reader.atVersion : 'unknown',
      ...(simulation ? { simulationEnvironment: reader } : { native: reader })
    });
    // An open that completes after the deadline still owns resources: the surface closes itself when the run was stopped.
    stage = 'surface-start';
    surface = await withinBudget(() => options.surface.open(task, context));
    const opened = surface;
    await opened.prepare();
    append('run.started', { maxSteps: task.maxSteps, timeoutMs: task.timeoutMs, allowedActions, ...(options.conditions ? { conditions: structuredClone(options.conditions) } : {}) });
    /** A surface that cannot answer (navigating, closed) has no focused field. */
    const focusInField = () => bestEffort(() => opened.focusIsEditable(), false);
    /** `pressed`: if the press said nothing, keep listening without pressing anything. A press that put focus in a field has no more to say. */
    const observe = async (pressed = false): Promise<Observation> => {
      stage = 'observation';
      await opened.inspect?.(activeStep);
      let collected = await withinBudget(() => options.backend.observe({ signal: controller.signal }));
      const silent = () => !collected.speech.some(line => line.trim());
      if (pressed && options.silentPressWaitMs && silent() && !await focusInField()) {
        for (const until = Date.now() + options.silentPressWaitMs; silent() && Date.now() < until;) {
          await withinBudget(() => new Promise(resolve => setTimeout(resolve, Math.min(SILENCE_POLL_MS, until - Date.now()))));
          collected = await withinBudget(() => options.backend.observe({ signal: controller.signal }));
        }
      }
      const ids = collected.outputs.map(output => {
        let id = outputEventIds.get(output.sequence);
        if (!id) {
          id = append(`${speechSource}.output`, inputTainted ? { sequence: output.sequence, receivedAt: output.receivedAt, text: REDACTED, raw: REDACTED } : output, { source: speechSource, timestamp: output.receivedAt, redacted: inputTainted }).id;
          outputEventIds.set(output.sequence, id);
        }
        return id;
      });
      // A screen reader announces the title when a document loads. The title is passed on only once it was heard in the speech, so the
      // planner never knows more than the simulated user; a surface that cannot answer (navigating, closed) simply has none.
      const surfaceTitle = (await bestEffort(() => opened.title(), undefined))?.trim();
      if (surfaceTitle && collected.speech.some(line => line.includes(surfaceTitle))) heardTitles.add(surfaceTitle);
      const title = surfaceTitle && heardTitles.has(surfaceTitle) ? surfaceTitle : undefined;
      // The simulation marks what a live region said; a real screen reader's output does not say.
      const announcements = collected.outputs.filter(output => output.announcement === 'live-region').map(output => output.text);
      const observation: Observation = { kind: 'screenreader', ...(options.backend.evidenceProvenance ? { provenance: options.backend.evidenceProvenance } : {}), speech: [...collected.speech], outputEventIds: ids, window: { id: collected.windowId, startedAt: collected.startedAt, endedAt: collected.endedAt, reason: collected.reason },
        ...(title ? { title: title.slice(0, 300) } : {}), ...(announcements.length ? { announcements } : {}) };
      // Where the cursor sat is for people reading the run: it goes into the trace, never into the observation a policy gets.
      append(`${speechSource}.observation`, { ...observation, ...(inputTainted ? { speech: [REDACTED], ...(title ? { title: REDACTED } : {}), ...(announcements.length ? { announcements: [REDACTED] } : {}) } : collected.cursor ? { cursor: collected.cursor } : {}), association: 'temporal-only', speechCompletionKnown: false }, { source: speechSource, redacted: inputTainted, collectionWindow: { startedAt: collected.startedAt, endedAt: collected.endedAt } });
      return observation;
    };
    /**
     * VoiceOver's cursor can stay on the browser's own controls when a page loads, and nothing in the page can be reached until it goes
     * in. That is the browser's doing, not the page's, so it is not one of the user's moves. Whether the cursor is already in (the page
     * moved focus, or VoiceOver went in by itself) is the backend's to tell: page focus says nothing about where VoiceOver's cursor is.
     * Each new document is looked at once; one that cannot answer yet is looked at after the next action.
     */
    let enteredDocument: string | number | undefined;
    const enterPage = async (step: number) => {
      if (!options.backend.enterPage) return;
      const loaded = await bestEffort(() => opened.documentId(), undefined);
      if (loaded === undefined || loaded === enteredDocument) return;
      enteredDocument = loaded;
      stage = 'page-entry';
      const entry = await withinBudget(() => options.backend.enterPage!({ signal: controller.signal }));
      append('screen-reader.page-entry', { step, ...entry }, { source: speechSource });
    };
    await enterPage(0);
    let observation = await observe();
    opened.flush();
    /** A screenshot for people only (`policyVisible: false`), never after text entry. Step 0 is the screen before the first action. */
    const diagnosticScreenshot = async (step: number) => {
      if (!options.diagnosticScreenshots || !opened.screenshot) return;
      const omitted = (reason: string) => append('surface.screenshot-omitted', { step, policyVisible: false, reason }, { source: 'surface', redacted: true });
      if (inputTainted) { omitted('Diagnostic screenshot omitted while a secret was being typed.'); return; }
      // The screen's text is compared here, not on the surface, so the secret never reaches page scripts.
      if (secretTyped && await secretOnScreen()) { omitted('Diagnostic screenshot omitted: the screen shows a typed secret.'); return; }
      const path = `diagnostics/step-${step}.png`;
      await withinBudget(async () => { await mkdir(join(options.outDir, 'diagnostics'), { recursive: true }); await opened.screenshot!(join(options.outDir, path), { maskFields: secretTyped }); });
      append('surface.screenshot', { step, path, policyVisible: false }, { source: 'surface' });
    };
    /** A surface that cannot say what it shows is treated as showing the secret. */
    const secretOnScreen = async (): Promise<boolean> => {
      if (!secretValues.length) return false;
      const text = opened.visibleText ? await bestEffort(() => opened.visibleText!(), undefined) : undefined;
      return typeof text !== 'string' || secretValues.some(value => text.includes(value));
    };
    const verify = async (step: number): Promise<VerificationRecord> => {
      stage = 'verification';
      const result = await withinBudget(() => opened.verify({ latestActivation }));
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
    if (opened.baseline) try {
      stage = 'verification';
      const baseline = await withinBudget(() => opened.baseline!());
      append('verifier.baseline', { passed: baseline.passed, rules: (baseline.rules ?? []).map(({ ruleIndex, ruleType, passed }) => ({ ruleIndex, ruleType, passed })) }, { source: 'verifier' });
    } catch (error) {
      if (endsRun(error)) throw error;
      // Error text can carry page URLs or echoed values; keep only its type.
      append('verifier.baseline', { error: error instanceof Error ? error.name : 'Error' }, { source: 'verifier' });
    }
    await diagnosticScreenshot(0);
    if (options.diagnosticScreenshots && !inputTainted && opened.startScreenshot) {
      const path = 'diagnostics/start.png';
      const picture = await withinBudget(async () => { await mkdir(join(options.outDir, 'diagnostics'), { recursive: true }); return opened.startScreenshot!(join(options.outDir, path)); });
      if (picture) append('surface.start-screenshot', { ...picture, path, policyVisible: false }, { source: 'surface' });
    }
    const grace = Math.max(0, Math.floor(options.confirmationGrace ?? 0));
    for (let step = 1; step <= task.maxSteps!; step++) {
      activeStep = step;
      stage = 'policy';
      const onPlannerCall = ({ trigger }: { trigger: string }) => bestEffortEvidence(() => append('policy.planner-call', { step, trigger: /^[a-z-]{1,40}$/.test(trigger) ? trigger : 'other' }, { source: 'policy' }));
      // What the policy did on the way to this decision (plans written, cues checked) is recorded whether or not it got to one: a
      // planner that fails part-way must not take the record of what came before it down with it.
      const recordEvidence = () => {
        for (const evidence of options.policy.takeDecisionEvidence?.() ?? []) {
          append('policy.evidence', inputTainted ? { step, details: REDACTED, reason: 'Model evidence omitted after text entry.', summary: evidenceSummary(evidence) } : { step, evidence }, { source: 'policy', redacted: inputTainted });
        }
      };
      const deciding = offClock(() => options.policy.decide({ goal: task.goal, ...(task.context ? { context: task.context } : {}), observation: structuredClone(policyView(observation)), history: structuredClone(history.map(entry => ({ ...entry, observation: policyView(entry.observation) }))), allowedActions: structuredClone(allowedActions), inputs: inputDescriptors, signal: controller.signal, onPlannerCall }), options.policyTimeoutMs ?? POLICY_TIMEOUT_MS);
      const decision = await deciding.catch((error: unknown) => { bestEffortEvidence(recordEvidence); throw error; });
      recordEvidence();
      try { validateDecision(decision, allowedActions); }
      catch (error) {
        append('policy.rejected', { step, ...rejectedDecisionDetails(decision, inputTainted), reasonCode: 'action-not-allowed', reason: errorMessage(error) }, { source: 'policy', redacted: inputTainted });
        throw error;
      }
      steps = step;
      append('policy.decision', { step, decision: inputTainted ? ('action' in decision ? { action: decision.action } : { stop: decision.stop, ...(decision.stopSource ? { stopSource: decision.stopSource } : {}) }) : decision }, { source: 'policy', redacted: inputTainted });
      if ('stop' in decision) {
        const verification = await verify(step);
        outcome = verification.passed ? goalHolds(decision.stop) : { status: 'failure', reason: decision.stop === 'success' ? 'verification-failed' : decision.stop === 'uncertain' ? 'policy-uncertain' : 'policy-stuck' };
        if (!verification.passed && decision.stop === 'uncertain') outcome.status = 'inconclusive';
        if (decision.stopSource && STOP_SOURCES.includes(decision.stopSource)) outcome.policyStopSource = decision.stopSource;
        history.push({ step, decision, observation });
        break;
      }
      const action = decision.action;
      let execution: ActionExecution, receipt: BackendReceipt | void = undefined;
      // Told before the action, so what starts at the moment of the press (a request) counts.
      opened.beforeAction(step, action);
      try {
        stage = 'action';
        if (action.kind === 'typeText' || action.kind === 'replaceText') {
          const editable = await withinBudget(() => opened.focusIsEditable());
          append('action.input-gate', { step, editable }, { source: 'runner' });
          if (!editable) throw new NotEditableError();
          // Only a secret's echo has to be hidden; typing a value marked not sensitive (a search term) keeps the record readable.
          if (!options.includeSensitiveInputValues && inputDescriptors[action.input]!.sensitive) {
            inputTainted = secretTyped = true;
            append('privacy.input-taint', { step, until: simulation ? 'end-of-step' : 'end-of-run', reason: simulation
              ? 'The typing step\'s protocol payloads, speech and diagnostics are withheld; afterwards only the value is masked.'
              : 'A real screen reader can echo input late and in its own words, so payloads, speech and diagnostics are withheld from here on.' }, { redacted: true });
          }
          await withinBudget(() => options.backend.execute({ kind: action.kind, text: task.input![action.input]! }, { signal: controller.signal }));
        } else receipt = await withinBudget(() => options.backend.execute(action, { signal: controller.signal }));
        execution = { ok: true };
      } catch (error) {
        // An error that names its own run outcome ends the run instead of becoming a failed action.
        if (error instanceof RawstepError && error.outcome) throw error;
        if (endsRun(error)) throw evidenceFailure ?? controller.signal.reason ?? error;
        execution = { ok: false, error: inputTainted ? 'Execution failed after text entry; raw error redacted.' : errorMessage(error), failure: error instanceof NotEditableError ? 'not-editable' : 'backend' };
      }
      // A press is an action that names one, unless the backend says it pressed nothing (`activate` picking from an open rotor list).
      const namesPress = execution.ok && isActivation(action), pressed = namesPress && !(receipt && typeof receipt === 'object' && receipt.pressed === false);
      append('action.result', { step, action, ...execution, ...(namesPress && !pressed ? { pressed: false } : {}) });
      history.push({ step, decision, observation, execution });
      // An activation may start a change that shows a moment later: the surface settles on what it does, not on a fixed wait.
      if (execution.ok) stage = 'settling';
      await opened.afterAction(step, execution.ok);
      if (execution.ok) await enterPage(step);
      observation = await observe(pressed);
      // Character-by-character echoes of a sensitive value cannot be matched; withhold that step's speech from the policy.
      if (execution.ok && (action.kind === 'typeText' || action.kind === 'replaceText') && inputDescriptors[action.input]!.sensitive) withheldObservations.add(observation);
      if (pressed) latestActivation = { step, action, observation };
      opened.flush();
      await diagnosticScreenshot(step);
      const verification = await verify(step);
      if (inputTainted && simulation) { inputTainted = false; append('privacy.input-taint-ended', { step }, { source: 'runner' }); }
      if (verification.passed) {
        // Reached: stop unless the user could not have heard it, then give them a few actions to notice (or not).
        if (reached === undefined) {
          const heard = confirmationHeard(task, observation);
          reached = { step, heard };
          append('goal.reached', { step, heard: heard ?? 'unknown', grace: heard === false ? grace : 0 });
        } else if (reached.heard === false && confirmationHeard(task, observation)) {
          // The grace is there for this: the user came upon the confirmation after all, so they know.
          reached.heard = true;
          append('goal.heard', { step, reachedAt: reached.step });
        }
        if (reached.heard !== false || step - reached.step >= grace) { outcome = goalHolds(); break; }
      } else if (reached !== undefined) {
        // An action in the grace undid the goal (a second press unchecked the box): the run goes on as before it was reached.
        append('goal.lost', { step, reachedAt: reached.step });
        reached = undefined;
      }
    }
    // The step limit cut the grace short: the goal still held at the last check, so the run reached it.
    if (reached !== undefined && outcome.reason === 'maxSteps') outcome = goalHolds();
  } catch (error) {
    bestEffortEvidence(() => options.surface.recordFailure?.(error, context));
    if (error instanceof RunAborted && !evidenceFailure) {
      const cancellation = { signal: error.signal, stage, step: activeStep };
      outcome = { status: 'aborted', reason: 'aborted', stage, step: activeStep, cancellation };
      bestEffortEvidence(() => append('run.aborted', cancellation));
    } else {
      outcome = { status: error instanceof BudgetExceeded ? 'inconclusive' : 'failure', reason: error instanceof BudgetExceeded ? 'timeout' : 'error', stage, step: activeStep, error: inputTainted ? 'Run failed after text entry; raw error redacted.' : errorMessage(error) };
      const hint = findRawstepError(error, candidate => !!candidate.outcome)?.outcome;
      if (hint) outcome = { ...outcome, ...hint };
      // The time limit cut the grace short: the goal still held at the last check, like the step limit below.
      if (error instanceof BudgetExceeded && reached !== undefined) outcome = goalHolds();
      // Why a model reply was not used is kept with the error; after text entry the reply itself is left out, like the message.
      const failure = findRawstepError(error, candidate => !!candidate.detail?.modelFailure)?.detail?.modelFailure as Record<string, unknown> | undefined;
      const modelFailure = failure && (inputTainted ? (({ reply: _reply, ...rest }) => rest)(failure) : failure);
      bestEffortEvidence(() => append('run.error', { stage, step: activeStep, message: inputTainted ? 'Run failed after text entry; raw error redacted.' : errorMessage(error), ...(modelFailure ? { modelFailure } : {}) }, { redacted: inputTainted }));
    }
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    bestEffortEvidence(() => surface?.flush({ final: true }));
    // Bound cleanup too. A server disconnect never turns an observed success into failure.
    for (const [name, close] of [['backend', () => options.backend.close()], ['surface', () => surface?.close()]] as const) {
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
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,64}$/;
/**
 * What survives of policy evidence after a secret was typed: the evidence kind, role, plan bookkeeping (versions, task ids and
 * statuses, triggers, counts) and the chosen candidate id — opaque tokens and numbers only, never plan wording or speech.
 */
function evidenceSummary(evidence: unknown): Record<string, unknown> {
  if (!evidence || typeof evidence !== 'object') return {};
  const source = evidence as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const key of ['kind', 'role', 'trigger', 'reason', 'taskId', 'fromStatus', 'toStatus', 'choiceId', 'verified']) if (typeof source[key] === 'string' && SAFE_TOKEN.test(source[key] as string)) out[key] = source[key];
  for (const key of ['version', 'planVersion', 'plannerCalls', 'maxPlannerCalls', 'actions']) if (typeof source[key] === 'number') out[key] = source[key];
  if (typeof source.accepted === 'boolean') out.accepted = source.accepted;
  const ending = source.ending;
  if (ending && typeof ending === 'object') {
    const e = ending as Record<string, unknown>;
    out.ending = Object.fromEntries(Object.entries({ reason: e.reason, step: e.step, verified: e.verified }).filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && SAFE_TOKEN.test(v))));
  }
  return out;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function rejectedDecisionDetails(decision: unknown, tainted: boolean): Record<string, unknown> {
  if (!decision || typeof decision !== 'object') return { action: { kind: 'invalid' } };
  const candidate = (decision as Record<string, unknown>).action;
  if (!candidate || typeof candidate !== 'object') return { action: { kind: 'invalid' } };
  const action = candidate as Record<string, unknown>;
  const kind = ['key', 'intent', 'typeText', 'replaceText'].includes(String(action.kind)) ? action.kind : 'invalid';
  if (tainted) return { action: { kind, details: REDACTED } };
  return { action: { kind, ...Object.fromEntries(['key', 'intent', 'input'].filter(key => typeof action[key] === 'string').map(key => [key, action[key]])) } };
}

function redactVerificationWitness(witness: VerificationWitness): Record<string, unknown> {
  const safe: Record<string, unknown> = { kind: witness.kind, details: REDACTED };
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

/**
 * The words of a task's text goal rules (what the page shows or says when the goal is reached), from rules nested in `any` too. What a
 * `not` rule names must not show, so it is not a word of the goal.
 */
function goalTexts(rules: readonly VerifyRule[]): string[] {
  return flattenVerifyRules(rules, { negated: false }).flatMap(rule => {
    const r = rule as Record<string, unknown>;
    return ['textVisible', 'textVisibleExact', 'activatedAnnouncementIncludes', 'titleIncludes'].flatMap(key => typeof r[key] === 'string' ? [r[key] as string] : []);
  });
}
/**
 * Whether the speech after the action that reached the goal said so: one of the goal's texts was spoken. Undefined when the goal has
 * no text to listen for (a URL or a script).
 */
export function confirmationHeard(task: Pick<Task, 'verify'>, observation: Observation): boolean | undefined {
  const texts = goalTexts(task.verify.all ?? []).map(t => t.toLowerCase().trim()).filter(Boolean);
  if (!texts.length) return undefined;
  const said = observation.speech.join('\n').toLowerCase();
  return texts.some(text => said.includes(text));
}
