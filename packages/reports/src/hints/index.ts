import { dirname, join } from 'node:path';
import { readTrace, traceFilePath, writeJsonAtomic, type RunOutcome, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import { goalLeads } from '@rawstep/policies/policy';

/**
 * Friction hints: places in a saved run worth a human look ("it succeeded, but took 23 Tabs").
 * Hints are pointers with evidence, never verdicts; reaching the goal is one signal among them.
 * Pure over the saved trace, so they can be recomputed later or extended with custom extractors.
 */
export const HINTS_SCHEMA_VERSION = '3.0' as const;
export type HintKind =
  | 'slow-run' | 'excess-keystrokes' | 'backtracking'
  | 'focus-lost' | 'focus-not-visible' | 'modal-focus-outside' | 'missing-announcement'
  | 'early-stop' | 'goal-met-at-start' | 'focus-left-page'
  | 'replan' | 'task-limit' | 'wanted-to-give-up' | 'goal-word-stretch' | 'expectation-broken';
/**
 * Where a hint comes from. page: the page itself behaved this way (focus, announcements, dialogs, tab order).
 * model: the simulated user wandered or stopped early, which may say more about the planner than the page.
 * run: about the run as a whole (length against the fastest run, goal already met at start), and orchestration events — a new
 * plan, a task running out of actions. These mark where the plan needed revising; the page may have made that point hard, or the
 * plan may have been wrong.
 * expectation-broken is a model hint too: the simulated user expected something of the page that did not hold. Whether the page
 * or the expectation was wrong is for a person to judge.
 */
export type HintSource = 'page' | 'model' | 'run';
/** The page element a hint is about, as the accessibility tree named it; name is absent when unnamed or redacted. */
export type HintTarget = { role: string; name?: string };
export const HINT_SOURCES: Readonly<Record<HintKind, HintSource>> = Object.freeze({
  'slow-run': 'run', 'goal-met-at-start': 'run', 'replan': 'run', 'task-limit': 'run',
  'wanted-to-give-up': 'run', 'goal-word-stretch': 'run',
  'excess-keystrokes': 'page', 'focus-lost': 'page', 'focus-left-page': 'page', 'focus-not-visible': 'page',
  'modal-focus-outside': 'page', 'missing-announcement': 'page',
  'backtracking': 'model', 'early-stop': 'model', 'expectation-broken': 'model',
});
export type Hint = {
  kind: HintKind;
  source: HintSource;
  target?: HintTarget;
  /** observed: directly recorded. suspected: inferred from indirect signals and may be wrong. */
  certainty: 'observed' | 'suspected';
  steps: number[];
  summary: string;
  detail: Record<string, unknown>;
  /** Trace event ids the hint was derived from. */
  evidence: string[];
};
export type RunSummary = { runId: string; steps: number; durationMs: number | null; goalReached: boolean };
export type HintReport = RunSummary & {
  schemaVersion: typeof HINTS_SCHEMA_VERSION;
  taskId: string;
  outcome?: Pick<RunOutcome, 'status' | 'reason'>;
  reference?: RunSummary;
  hints: Hint[];
  limitations: string[];
};
export type HintThresholds = {
  /** slow-run when steps >= reference × ratio and at least minExtraSteps more. */
  slowRunStepRatio: number; slowRunMinExtraSteps: number;
  /** Navigation keys pressed between two activations. */
  keystrokesToTarget: number;
  /** Direction reversals such as Tab followed by Shift+Tab. */
  backtrackReversals: number;
};
export const DEFAULT_HINT_THRESHOLDS: Readonly<HintThresholds> = Object.freeze({
  slowRunStepRatio: 1.5, slowRunMinExtraSteps: 3, keystrokesToTarget: 10, backtrackReversals: 2,
});
export type HintOptions = { reference?: Readonly<RunTrace>; thresholds?: Partial<HintThresholds> };

/** A press this many actions or fewer before an expectation broke is what broke it: the user may move a little to check first. */
const PRESS_WINDOW = 3;
const NAVIGATION_KEYS = ['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
const FORWARD = ['Tab', 'ArrowDown', 'ArrowRight', 'next'], BACKWARD = ['Shift+Tab', 'ArrowUp', 'ArrowLeft', 'previous'];
const ANNOUNCING_SURFACES = ['alert', 'alertdialog', 'dialog', 'status', 'log'];
const REDACTED = '[REDACTED]';

type Action = { step: number; eventId: string; key?: string; intent?: string; text?: boolean; ok?: boolean };
type ObserverRecord = { id: string; step: number; kind: string; role?: string | null; name?: string; visible?: boolean; inViewport?: boolean; modalOpen?: boolean; inDialog?: boolean; reason?: string; sameDocument?: boolean; attr?: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (o: { role?: string | null; name?: string }) => o.name && o.name !== REDACTED ? `${o.role ?? 'element'} "${o.name}"` : (o.role ?? 'element');
const keyOf = (a: Action) => a.key ?? a.intent;
const targetOf = (o: { role?: string | null; name?: string } | undefined): HintTarget | undefined =>
  o ? { role: o.role ?? 'element', ...(o.name && o.name !== REDACTED ? { name: o.name } : {}) } : undefined;
const isActivation = (a: Action) => a.key === 'Enter' || a.key === 'Space' || a.intent === 'activate';
const isNavigation = (a: Action) => (a.key !== undefined && NAVIGATION_KEYS.includes(a.key)) || a.intent === 'next' || a.intent === 'previous';

export function summarizeRun(trace: Readonly<RunTrace>): RunSummary {
  const started = Date.parse(trace.startedAt), ended = trace.endedAt ? Date.parse(trace.endedAt) : NaN;
  return { runId: trace.runId, steps: typeof trace.outcome?.steps === 'number' ? trace.outcome.steps : 0,
    durationMs: Number.isFinite(ended) ? ended - started : null, goalReached: trace.outcome?.status === 'success' };
}

/** Shortest run that reached the goal; the comparison baseline for slow-run hints. */
export function selectReference(traces: readonly Readonly<RunTrace>[]): Readonly<RunTrace> | undefined {
  return traces.filter(t => t.outcome?.status === 'success').sort((a, b) => summarizeRun(a).steps - summarizeRun(b).steps)[0];
}

function collect(trace: Readonly<RunTrace>) {
  const actions: Action[] = [], observer: ObserverRecord[] = [], evidence: { step: number; id: string; data: Record<string, unknown> }[] = [], diagnostics: { step: number; id: string; data: Record<string, unknown> }[] = [];
  let step = 0;
  for (const event of trace.events as readonly TraceEvent[]) {
    const data = record(event.data) ? event.data : {};
    if (event.type === 'policy.decision' && typeof data.step === 'number') {
      step = data.step;
      const action = record(data.decision) && record(data.decision.action) ? data.decision.action : undefined;
      if (action) actions.push({ step, eventId: event.id, ...(typeof action.key === 'string' ? { key: action.key } : {}), ...(typeof action.intent === 'string' ? { intent: action.intent } : {}), ...(action.kind === 'typeText' || action.kind === 'replaceText' ? { text: true } : {}) });
    } else if (event.type === 'action.result' && typeof data.step === 'number') {
      const action = actions.find(a => a.step === data.step); if (action) action.ok = data.ok === true;
    } else if (event.type.startsWith('observer.') && typeof data.step === 'number' && typeof data.kind === 'string') {
      observer.push({ ...(data as Omit<ObserverRecord, 'id'>), id: event.id });
    } else if (event.type === 'policy.evidence' && typeof data.step === 'number' && record(data.evidence)) {
      evidence.push({ step: data.step, id: event.id, data: data.evidence });
    } else if (event.type === 'browser.accessibility-diagnostic' && typeof data.step === 'number' && record(data.diagnostic)) {
      diagnostics.push({ step: data.step, id: event.id, data: data.diagnostic });
    }
  }
  return { actions, observer, evidence, diagnostics };
}

export function extractHints(trace: Readonly<RunTrace>, options: HintOptions = {}): HintReport {
  const t = { ...DEFAULT_HINT_THRESHOLDS, ...options.thresholds };
  const run = summarizeRun(trace), { actions, observer, evidence, diagnostics } = collect(trace);
  const hints: Hint[] = [];
  const add = (hint: Omit<Hint, 'source' | 'target'>, target?: { role?: string | null; name?: string }) => {
    const element = targetOf(target);
    hints.push({ ...hint, source: HINT_SOURCES[hint.kind], ...(element ? { target: element } : {}) });
  };
  const focusBefore = (step: number) => [...observer].reverse().find(o => o.kind === 'focus' && o.step <= step);
  const at = (step: number) => observer.filter(o => o.step === step);

  const reference = options.reference ? summarizeRun(options.reference) : undefined;
  if (reference?.goalReached && run.steps >= reference.steps * t.slowRunStepRatio && run.steps - reference.steps >= t.slowRunMinExtraSteps) add({
    kind: 'slow-run', certainty: 'observed', steps: [], evidence: [],
    summary: `${run.steps} steps against a ${reference.steps}-step reference run (+${run.steps - reference.steps}).`,
    detail: { steps: run.steps, referenceSteps: reference.steps, durationMs: run.durationMs, referenceDurationMs: reference.durationMs, referenceRunId: reference.runId },
  });

  // Navigation presses between consecutive activations, attributed to the focus target that was activated.
  let segment: Action[] = [];
  for (const action of actions) {
    if (isNavigation(action)) { segment.push(action); continue; }
    if (isActivation(action) && segment.length >= t.keystrokesToTarget) {
      const target = [...observer].reverse().find(o => o.kind === 'focus' && o.step < action.step);
      add({ kind: 'excess-keystrokes', certainty: 'observed', steps: [segment[0]!.step, action.step],
        summary: `${segment.length} navigation keys before activating ${target ? label(target) : 'the focused control'}.`,
        detail: { count: segment.length, keys: countBy(segment.map(a => keyOf(a)!)), ...(target ? { target: { role: target.role, name: target.name } } : {}) },
        evidence: [...segment.map(a => a.eventId), action.eventId, ...(target ? [target.id] : [])] }, target);
    }
    segment = [];
  }

  const reversals: Action[] = [];
  for (let i = 1; i < actions.length; i++) {
    const a = keyOf(actions[i - 1]!), b = keyOf(actions[i]!);
    if (a && b && ((FORWARD.includes(a) && BACKWARD.includes(b)) || (BACKWARD.includes(a) && FORWARD.includes(b)))) reversals.push(actions[i]!);
  }
  if (reversals.length >= t.backtrackReversals) add({ kind: 'backtracking', certainty: 'observed', steps: reversals.map(a => a.step),
    summary: `Navigation direction reversed ${reversals.length} times.`, detail: { reversals: reversals.length }, evidence: reversals.map(a => a.eventId) }, focusBefore(reversals[0]!.step - 1));

  for (const lost of observer.filter(o => o.kind === 'focus-lost' && o.step > 0)) {
    const action = actions.find(a => a.step === lost.step);
    add({ kind: 'focus-lost', certainty: 'observed', steps: [lost.step],
      summary: `Focus fell back to the page after ${action ? keyOf(action) ?? 'the action' : 'an action'} ${lost.reason === 'removed' ? 'removed' : 'left'} ${label(lost)}.`,
      detail: { from: { role: lost.role, name: lost.name }, reason: lost.reason, ...(action ? { action: keyOf(action) } : {}) }, evidence: [lost.id, ...(action ? [action.eventId] : [])] }, lost);
  }

  for (const left of observer.filter(o => o.kind === 'page-blur' && o.step > 0)) {
    const action = actions.find(a => a.step === left.step);
    add({ kind: 'focus-left-page', certainty: 'observed', steps: [left.step],
      summary: `Keyboard focus left the page${action ? ` after ${keyOf(action)}` : ''} (browser UI or another window).`,
      detail: action ? { action: keyOf(action) } : {}, evidence: [left.id, ...(action ? [action.eventId] : [])] }, focusBefore(left.step));
  }

  for (const focus of observer.filter(o => o.kind === 'focus' && o.step > 0 && (o.visible === false || o.inViewport === false))) add({
    kind: 'focus-not-visible', certainty: 'observed', steps: [focus.step],
    summary: `Focus moved to ${label(focus)}, which was ${focus.visible === false ? 'hidden' : 'outside the viewport'}.`,
    detail: { target: { role: focus.role, name: focus.name }, visible: focus.visible, inViewport: focus.inViewport }, evidence: [focus.id] }, focus);
  for (const d of diagnostics) {
    const focus = record(d.data.focus) ? d.data.focus : {};
    if (focus.centerOccluded === true || focus.indicator === 'not-detected') add({ kind: 'focus-not-visible', certainty: 'suspected', steps: [d.step],
      summary: focus.centerOccluded === true ? 'Another element may cover the focused control.' : 'No outline or box-shadow focus indicator was detected.',
      detail: { centerOccluded: focus.centerOccluded, indicator: focus.indicator }, evidence: [d.id] }, focusBefore(d.step));
  }

  for (const focus of observer.filter(o => o.kind === 'focus' && o.modalOpen === true && o.inDialog === false)) add({
    kind: 'modal-focus-outside', certainty: 'observed', steps: [focus.step],
    summary: `A modal dialog was open while focus moved to ${label(focus)} behind it.`, detail: { target: { role: focus.role, name: focus.name } }, evidence: [focus.id] }, focus);
  for (const dialog of observer.filter(o => o.kind === 'appeared' && (o.role === 'dialog' || o.role === 'alertdialog') && o.step > 0)) {
    if (!at(dialog.step).some(o => o.kind === 'focus')) add({ kind: 'modal-focus-outside', certainty: 'suspected', steps: [dialog.step],
      summary: `${label(dialog)} opened but focus did not move into it.`, detail: { dialog: { role: dialog.role, name: dialog.name } }, evidence: [dialog.id] }, dialog);
  }

  // A page change with nothing a screen reader would announce: no live region, surface, focus move or page load.
  for (const action of actions.filter(a => isActivation(a) && a.ok !== false)) {
    const events = at(action.step);
    const domChanged = events.some(o => o.kind === 'state' || o.kind === 'navigation' || o.kind === 'appeared' || o.kind === 'disappeared');
    const lastFocus = [...observer].reverse().find(o => o.kind === 'focus' && o.step <= action.step);
    const announced = events.some(o => o.kind === 'live-region' || o.kind === 'focus' || o.kind === 'focus-lost'
      || (o.kind === 'appeared' && ANNOUNCING_SURFACES.includes(String(o.role)))
      || (o.kind === 'navigation' && o.sameDocument === false)
      || (o.kind === 'state' && !!lastFocus && o.name === lastFocus.name && o.role === lastFocus.role));
    // Attributed to the control that was activated (focused before this step), the element whose result went unannounced.
    if (domChanged && !announced && observer.length) add({ kind: 'missing-announcement', certainty: 'suspected', steps: [action.step],
      summary: `${keyOf(action)} changed the page, but no announcement, focus move or page load was recorded.`,
      detail: { changes: events.map(o => o.kind === 'state' ? `${o.attr} on ${label(o)}` : o.kind) },
      evidence: [action.eventId, ...events.map(o => o.id)] }, focusBefore(action.step - 1));
  }

  for (const item of evidence.filter(e => e.data.kind === 'orchestration-plan')) {
    const trigger = item.data.trigger, version = item.data.version;
    if (trigger === 'failures' || trigger === 'no-change' || trigger === 'oscillation') add({ kind: 'replan', certainty: 'observed', steps: [item.step],
      summary: trigger === 'failures' ? `Actions kept failing, so the planner wrote plan v${String(version)}.` : trigger === 'oscillation' ? `The cursor kept going back and forth between the same two items, so the planner wrote plan v${String(version)}.` : `Actions kept changing nothing, so the planner wrote plan v${String(version)}.`,
      detail: { trigger, version }, evidence: [item.id] }, focusBefore(item.step - 1));
    else if (trigger === 'task-limit') add({ kind: 'task-limit', certainty: 'observed', steps: [item.step],
      summary: `A task used up its actions, so the planner wrote plan v${String(version)}.`, detail: { trigger, version }, evidence: [item.id] }, focusBefore(item.step - 1));
  }
  // The user wanted to give up but named no approach that had failed: Rawstep asked for another plan. The wish itself is part of the cost.
  for (const item of evidence.filter(e => e.data.kind === 'orchestration-give-up' && e.data.accepted === false)) add({
    kind: 'wanted-to-give-up', certainty: 'observed', steps: [item.step],
    summary: `The user wanted to give up (${String(item.data.reason ?? '')}), but ${String(item.data.refused ?? 'without a failed approach')}; the run went on.`,
    detail: { reason: item.data.reason, refused: item.data.refused, effort: item.data.effort }, evidence: [item.id] });

  // Where the user's expectations broke: each assumption the planner marked broken. When the user had pressed something in the few
  // actions before (`pressed`), the expectation was about how that object responds, and the hint is on it, with where it sat on the
  // page. Otherwise it was a guess about where something is, broken wherever the cursor happened to be. The run's give-up names the
  // broken assumptions it rests on.
  const finalGiveUp = [...evidence].reverse().find(e => e.data.kind === 'orchestration-give-up' && e.data.accepted === true);
  const triedIds = new Set(Array.isArray(finalGiveUp?.data.tried) ? finalGiveUp.data.tried.filter((id): id is string => typeof id === 'string') : []);
  let cursorObject: { role?: string; name?: string } | undefined, cursorAt: Record<string, unknown> | undefined, observedAt = 0;
  // The object under the cursor, and where it was, when each step's action was decided: what a press acted on.
  const cursorAtDecision = new Map<number, { object: typeof cursorObject; at: typeof cursorAt }>();
  for (const event of trace.events as readonly TraceEvent[]) {
    const data = record(event.data) ? event.data : {};
    if (event.type === 'policy.decision' && typeof data.step === 'number') { observedAt = data.step; cursorAtDecision.set(data.step, { object: cursorObject, at: cursorAt }); }
    else if (event.type === 'backend.output' && record(data.output) && record(data.output.raw) && record(data.output.raw.semantic)) {
      const semantic = data.output.raw.semantic;
      cursorObject = { ...(typeof semantic.role === 'string' ? { role: semantic.role } : {}), ...(typeof semantic.name === 'string' && semantic.name ? { name: semantic.name } : {}) };
    } else if (event.type === 'simulation.observation' || event.type === 'screen-reader.observation') cursorAt = record(data.cursor) ? { ...data.cursor, step: observedAt } : undefined;
    else if (event.type === 'policy.evidence' && typeof data.step === 'number' && record(data.evidence) && data.evidence.kind === 'orchestration-plan') {
      const revision = record(data.evidence.revision) ? data.evidence.revision : undefined, doc = record(data.evidence.document) ? data.evidence.document : undefined;
      const broken = Array.isArray(revision?.broken) ? revision.broken.filter((id): id is string => typeof id === 'string') : [];
      const assumptions = Array.isArray(doc?.assumptions) ? doc.assumptions.filter(record) : [];
      const step = data.step, press = actions.filter(a => a.step < step).slice(-PRESS_WINDOW).reverse().find(isActivation);
      const on = press ? cursorAtDecision.get(press.step) : { object: cursorObject, at: cursorAt };
      for (const id of broken) {
        const text = assumptions.find(a => a.id === id)?.text;
        add({ kind: 'expectation-broken', certainty: 'observed', steps: [data.step],
          summary: `The user's expectation ${id} broke${typeof text === 'string' ? `: "${text}"` : ''}${press ? ` after pressing at step ${press.step}` : ''}; the planner wrote plan v${String(revision?.version ?? '')}.`,
          detail: { assumption: { id, ...(typeof text === 'string' ? { text } : {}) }, version: revision?.version, trigger: revision?.trigger, ...(triedIds.has(id) ? { gaveUpOn: true } : {}),
            ...(press ? { pressed: press.step } : {}), ...(on?.at ? { location: on.at } : {}) }, evidence: [event.id, ...(press ? [press.eventId] : [])] }, on?.object);
      }
    }
  }

  // The longest stretch of moves without hearing a word of the goal that still means something (one said on every card does not):
  // where a listener had nothing to go on. A measure, not a verdict: whoever reads it decides how long a user would keep going.
  const goal = trace.task.goal;
  if (goal) {
    const lead = goalLeads(goal);
    let after = 0, current: { from: number; to: number; ids: string[] } | undefined, longest: typeof current;
    for (const event of trace.events as readonly TraceEvent[]) {
      const data = record(event.data) ? event.data : {};
      if (event.type === 'policy.decision' && typeof data.step === 'number') { after = data.step; continue; }
      if ((event.type !== 'simulation.observation' && event.type !== 'screen-reader.observation') || after === 0) continue;
      const item = Array.isArray(data.speech) ? [...data.speech].reverse().find((line): line is string => typeof line === 'string' && !!line.trim()) : undefined;
      if (lead(item)) { current = undefined; continue; }
      current = current ? { ...current, to: after, ids: [...current.ids, event.id] } : { from: after, to: after, ids: [event.id] };
      if (!longest || current.to - current.from > longest.to - longest.from) longest = current;
    }
    if (longest) add({ kind: 'goal-word-stretch', certainty: 'observed', steps: [longest.from, longest.to],
      summary: `${longest.to - longest.from + 1} moves in a row (steps ${longest.from}–${longest.to}) without hearing a word of the goal.`,
      detail: { moves: longest.to - longest.from + 1, from: longest.from, to: longest.to }, evidence: longest.ids.slice(0, 20) });
  }

  // Goal rules that already held before any action make "reached the goal" weak evidence. `not` rules hold at start by design.
  const baseline = (trace.events as readonly TraceEvent[]).find(e => e.type === 'verifier.baseline');
  const baseRules = baseline && record(baseline.data) && Array.isArray(baseline.data.rules) ? (baseline.data.rules as { ruleIndex?: number; ruleType?: string; passed?: boolean }[]).filter(r => r.passed === true && r.ruleType !== 'not') : [];
  if (baseline && baseRules.length) {
    const all = record(baseline.data) && baseline.data.passed === true;
    add({ kind: 'goal-met-at-start', certainty: all ? 'observed' : 'suspected', steps: [0],
      summary: all ? 'Every goal rule already held before the first action.' : `${baseRules.length} goal rule(s) already held before the first action.`,
      detail: { rules: baseRules.map(r => ({ ruleIndex: r.ruleIndex, ruleType: r.ruleType })) }, evidence: [baseline.id] });
  }

  const outcome = trace.outcome;
  const ruleStop = outcome?.policyStopSource === 'exploration-guard' || outcome?.policyStopSource === 'orchestration-limit' || outcome?.policyStopSource === 'user-gave-up';
  const gaveUp = [...evidence].reverse().find(e => e.data.kind === 'orchestration-give-up' && e.data.accepted === true);
  if (outcome && (outcome.reason === 'policy-stuck' || outcome.reason === 'policy-uncertain' || ruleStop)) add({
    kind: 'early-stop', certainty: 'observed', steps: typeof outcome.step === 'number' ? [outcome.step] : [],
    summary: outcome.policyStopSource === 'exploration-guard' ? 'The repetition guard stopped the run.'
      : outcome.policyStopSource === 'orchestration-limit' ? 'The run reached its planner-call limit before the user reached the goal or gave up: not measured.'
      : outcome.policyStopSource === 'user-gave-up' ? `The user gave up: ${String(gaveUp?.data.reason ?? '')}`
      : `The model stopped as ${outcome.reason === 'policy-stuck' ? 'stuck' : 'uncertain'}.`,
    detail: { reason: outcome.reason, ...(outcome.policyStopSource ? { stopSource: outcome.policyStopSource } : {}),
      ...(outcome.policyStopSource === 'user-gave-up' && gaveUp ? { giveUp: { reason: gaveUp.data.reason, tried: gaveUp.data.tried, effort: gaveUp.data.effort } } : {}) }, evidence: gaveUp ? [gaveUp.id] : [] });

  hints.sort((a, b) => (a.steps[0] ?? -1) - (b.steps[0] ?? -1));
  const limitations = ['Hints point to steps worth reviewing; they do not establish accessibility defects or conformance.'];
  if (!observer.length) limitations.push('No page observer events were recorded, so focus, announcement and dialog hints are unavailable.');
  if (observer.some(o => o.name === REDACTED)) limitations.push('Names and text after text entry are redacted; those hints keep structure only.');
  return { schemaVersion: HINTS_SCHEMA_VERSION, ...run, taskId: String(trace.task.id),
    ...(outcome ? { outcome: { status: outcome.status, ...(outcome.reason ? { reason: outcome.reason } : {}) } } : {}),
    ...(reference ? { reference } : {}), hints, limitations };
}

/** Reads a saved trace (and optional reference), extracts hints and writes hints.json next to the trace. */
export async function writeHints(pathOrOutDir: string, options: { reference?: string; thresholds?: Partial<HintThresholds> } = {}): Promise<{ path: string; report: HintReport }> {
  const trace = await readTrace(pathOrOutDir), reference = options.reference ? await readTrace(options.reference) : undefined;
  const report = extractHints(trace, { ...(reference ? { reference } : {}), ...(options.thresholds ? { thresholds: options.thresholds } : {}) });
  const path = join(dirname(await traceFilePath(pathOrOutDir)), 'hints.json');
  await writeJsonAtomic(path, report);
  return { path, report };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/**
 * The same kind of hint about the same page element, gathered across runs of one task. A person reads these to
 * decide what the page needs; nothing here concludes that the page is wrong.
 */
export type HintFinding = {
  kind: HintKind;
  source: HintSource;
  target?: HintTarget;
  /** Runs with at least one such hint, out of `totalRuns` reports given. */
  runs: number;
  totalRuns: number;
  /** Every occurrence, so a reader can open the step it points at. */
  occurrences: { runId: string; steps: number[]; certainty: Hint['certainty']; detail: Record<string, unknown> }[];
  /** Kind-specific numbers across occurrences: for excess-keystrokes, the navigation key counts. */
  counts?: { min: number; max: number; mean: number };
};

const findingKey = (hint: Hint) => JSON.stringify([hint.kind, hint.target?.role ?? null, hint.target?.name ?? null]);

/**
 * Groups hints from several runs of one task by kind and target element. run-level hints (slow-run,
 * goal-met-at-start) are left out: they describe runs, not the page. Sorted by how many runs show them.
 */
export function aggregateHints(reports: readonly Pick<HintReport, 'runId' | 'hints'>[]): HintFinding[] {
  const groups = new Map<string, HintFinding>();
  for (const report of reports) {
    const seen = new Set<string>();
    for (const hint of report.hints) {
      if (hint.source === 'run') continue;
      const key = findingKey(hint);
      const finding = groups.get(key) ?? { kind: hint.kind, source: hint.source, ...(hint.target ? { target: hint.target } : {}), runs: 0, totalRuns: reports.length, occurrences: [] };
      finding.occurrences.push({ runId: report.runId, steps: hint.steps, certainty: hint.certainty, detail: hint.detail });
      if (!seen.has(key)) { finding.runs++; seen.add(key); }
      groups.set(key, finding);
    }
  }
  for (const finding of groups.values()) {
    const values = finding.kind === 'excess-keystrokes' ? finding.occurrences.map(o => o.detail.count).filter((v): v is number => typeof v === 'number') : [];
    if (values.length) finding.counts = { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length };
  }
  return [...groups.values()].sort((a, b) => b.runs - a.runs || b.occurrences.length - a.occurrences.length || (a.source === b.source ? 0 : a.source === 'page' ? -1 : 1));
}
