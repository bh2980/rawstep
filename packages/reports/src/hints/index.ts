import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readTrace, traceFilePath, writeJsonAtomic, type RunOutcome, type RunTrace, type TraceEvent } from '@rawstep/core/trace';

/**
 * Friction hints: places in a saved run worth a human look ("it succeeded, but took 23 Tabs").
 * Hints are pointers with evidence, never verdicts; reaching the goal is one signal among them.
 * Pure over the saved trace, so they can be recomputed later or extended with custom extractors.
 */
export const HINTS_SCHEMA_VERSION = '1.0' as const;
export type HintKind =
  | 'slow-run' | 'excess-keystrokes' | 'backtracking' | 'repeated-state'
  | 'focus-lost' | 'focus-not-visible' | 'modal-focus-outside' | 'missing-announcement'
  | 'invisible-focus-change' | 'model-hesitation' | 'early-stop' | 'goal-met-at-start';
export type Hint = {
  kind: HintKind;
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
  /** Visits to the same screenshot state. */
  repeatedStateVisits: number;
  /** Model choice probability below this, or margin over the runner-up below hesitationMargin. */
  hesitationProbability: number; hesitationMargin: number;
};
export const DEFAULT_HINT_THRESHOLDS: Readonly<HintThresholds> = Object.freeze({
  slowRunStepRatio: 1.5, slowRunMinExtraSteps: 3, keystrokesToTarget: 10, backtrackReversals: 2,
  repeatedStateVisits: 3, hesitationProbability: 0.5, hesitationMargin: 0.1,
});
export type HintOptions = { reference?: Readonly<RunTrace>; thresholds?: Partial<HintThresholds> };

const NAVIGATION_KEYS = ['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
const FORWARD = ['Tab', 'ArrowDown', 'ArrowRight', 'next'], BACKWARD = ['Shift+Tab', 'ArrowUp', 'ArrowLeft', 'previous'];
const ANNOUNCING_SURFACES = ['alert', 'alertdialog', 'dialog', 'status', 'log'];
const REDACTED = '[REDACTED]';

type Action = { step: number; eventId: string; key?: string; intent?: string; text?: boolean; ok?: boolean };
type ObserverRecord = { id: string; step: number; kind: string; role?: string | null; name?: string; visible?: boolean; inViewport?: boolean; modalOpen?: boolean; inDialog?: boolean; reason?: string; sameDocument?: boolean; attr?: string };
type Screen = { step: number; eventId: string; sha256: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (o: { role?: string | null; name?: string }) => o.name && o.name !== REDACTED ? `${o.role ?? 'element'} "${o.name}"` : (o.role ?? 'element');
const keyOf = (a: Action) => a.key ?? a.intent;
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
  const actions: Action[] = [], observer: ObserverRecord[] = [], screens: Screen[] = [], evidence: { step: number; id: string; data: Record<string, unknown> }[] = [], diagnostics: { step: number; id: string; data: Record<string, unknown> }[] = [];
  let step = 0;
  for (const event of trace.events as readonly TraceEvent[]) {
    const data = record(event.data) ? event.data : {};
    if (event.type === 'policy.decision' && typeof data.step === 'number') {
      step = data.step;
      const action = record(data.decision) && record(data.decision.action) ? data.decision.action : undefined;
      if (action) actions.push({ step, eventId: event.id, ...(typeof action.key === 'string' ? { key: action.key } : {}), ...(typeof action.intent === 'string' ? { intent: action.intent } : {}), ...(action.kind === 'typeText' || action.kind === 'replaceText' ? { text: true } : {}) });
    } else if (event.type === 'action.result' && typeof data.step === 'number') {
      const action = actions.find(a => a.step === data.step); if (action) action.ok = data.ok === true;
    } else if (event.type === 'keyboard.observation' && record(data.screenshot) && typeof data.screenshot.pngBase64 === 'string') {
      screens.push({ step, eventId: event.id, sha256: createHash('sha256').update(Buffer.from(data.screenshot.pngBase64, 'base64')).digest('hex') });
    } else if (event.type.startsWith('observer.') && typeof data.step === 'number' && typeof data.kind === 'string') {
      observer.push({ ...(data as Omit<ObserverRecord, 'id'>), id: event.id });
    } else if (event.type === 'policy.evidence' && typeof data.step === 'number' && record(data.evidence)) {
      evidence.push({ step: data.step, id: event.id, data: data.evidence });
    } else if (event.type === 'browser.accessibility-diagnostic' && typeof data.step === 'number' && record(data.diagnostic)) {
      diagnostics.push({ step: data.step, id: event.id, data: data.diagnostic });
    }
  }
  return { actions, observer, screens, evidence, diagnostics };
}

export function extractHints(trace: Readonly<RunTrace>, options: HintOptions = {}): HintReport {
  const t = { ...DEFAULT_HINT_THRESHOLDS, ...options.thresholds };
  const run = summarizeRun(trace), { actions, observer, screens, evidence, diagnostics } = collect(trace);
  const hints: Hint[] = [];
  const at = (step: number) => observer.filter(o => o.step === step);
  const screenAt = (step: number) => screens.find(s => s.step === step);
  const previousScreen = (step: number) => [...screens].reverse().find(s => s.step < step);

  const reference = options.reference ? summarizeRun(options.reference) : undefined;
  if (reference?.goalReached && run.steps >= reference.steps * t.slowRunStepRatio && run.steps - reference.steps >= t.slowRunMinExtraSteps) hints.push({
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
      hints.push({ kind: 'excess-keystrokes', certainty: 'observed', steps: [segment[0]!.step, action.step],
        summary: `${segment.length} navigation keys before activating ${target ? label(target) : 'the focused control'}.`,
        detail: { count: segment.length, keys: countBy(segment.map(a => keyOf(a)!)), ...(target ? { target: { role: target.role, name: target.name } } : {}) },
        evidence: [...segment.map(a => a.eventId), action.eventId, ...(target ? [target.id] : [])] });
    }
    segment = [];
  }

  const reversals: Action[] = [];
  for (let i = 1; i < actions.length; i++) {
    const a = keyOf(actions[i - 1]!), b = keyOf(actions[i]!);
    if (a && b && ((FORWARD.includes(a) && BACKWARD.includes(b)) || (BACKWARD.includes(a) && FORWARD.includes(b)))) reversals.push(actions[i]!);
  }
  if (reversals.length >= t.backtrackReversals) hints.push({ kind: 'backtracking', certainty: 'observed', steps: reversals.map(a => a.step),
    summary: `Navigation direction reversed ${reversals.length} times.`, detail: { reversals: reversals.length }, evidence: reversals.map(a => a.eventId) });

  const visits = new Map<string, Screen[]>();
  for (const screen of screens) visits.set(screen.sha256, [...(visits.get(screen.sha256) ?? []), screen]);
  for (const [sha256, seen] of visits) if (seen.length >= t.repeatedStateVisits) hints.push({ kind: 'repeated-state', certainty: 'observed', steps: seen.map(s => s.step),
    summary: `The same screen was seen ${seen.length} times.`, detail: { visits: seen.length, sha256 }, evidence: seen.map(s => s.eventId) });

  for (const lost of observer.filter(o => o.kind === 'focus-lost' && o.step > 0)) {
    const action = actions.find(a => a.step === lost.step);
    hints.push({ kind: 'focus-lost', certainty: 'observed', steps: [lost.step],
      summary: `Focus fell back to the page after ${action ? keyOf(action) ?? 'the action' : 'an action'} ${lost.reason === 'removed' ? 'removed' : 'left'} ${label(lost)}.`,
      detail: { from: { role: lost.role, name: lost.name }, reason: lost.reason, ...(action ? { action: keyOf(action) } : {}) }, evidence: [lost.id, ...(action ? [action.eventId] : [])] });
  }

  for (const focus of observer.filter(o => o.kind === 'focus' && o.step > 0 && (o.visible === false || o.inViewport === false))) hints.push({
    kind: 'focus-not-visible', certainty: 'observed', steps: [focus.step],
    summary: `Focus moved to ${label(focus)}, which was ${focus.visible === false ? 'hidden' : 'outside the viewport'}.`,
    detail: { target: { role: focus.role, name: focus.name }, visible: focus.visible, inViewport: focus.inViewport }, evidence: [focus.id] });
  for (const d of diagnostics) {
    const focus = record(d.data.focus) ? d.data.focus : {};
    if (focus.centerOccluded === true || focus.indicator === 'not-detected') hints.push({ kind: 'focus-not-visible', certainty: 'suspected', steps: [d.step],
      summary: focus.centerOccluded === true ? 'Another element may cover the focused control.' : 'No outline or box-shadow focus indicator was detected.',
      detail: { centerOccluded: focus.centerOccluded, indicator: focus.indicator }, evidence: [d.id] });
  }

  for (const focus of observer.filter(o => o.kind === 'focus' && o.modalOpen === true && o.inDialog === false)) hints.push({
    kind: 'modal-focus-outside', certainty: 'observed', steps: [focus.step],
    summary: `A modal dialog was open while focus moved to ${label(focus)} behind it.`, detail: { target: { role: focus.role, name: focus.name } }, evidence: [focus.id] });
  for (const dialog of observer.filter(o => o.kind === 'appeared' && (o.role === 'dialog' || o.role === 'alertdialog') && o.step > 0)) {
    if (!at(dialog.step).some(o => o.kind === 'focus')) hints.push({ kind: 'modal-focus-outside', certainty: 'suspected', steps: [dialog.step],
      summary: `${label(dialog)} opened but focus did not move into it.`, detail: { dialog: { role: dialog.role, name: dialog.name } }, evidence: [dialog.id] });
  }

  // A visible change with nothing a screen reader would announce: no live region, surface, focus move or page load.
  for (const action of actions.filter(a => isActivation(a) && a.ok !== false)) {
    const events = at(action.step), screen = screenAt(action.step), before = previousScreen(action.step);
    const pixelsChanged = !!screen && !!before && screen.sha256 !== before.sha256;
    const domChanged = events.some(o => o.kind === 'state' || o.kind === 'navigation' || o.kind === 'appeared' || o.kind === 'disappeared');
    const lastFocus = [...observer].reverse().find(o => o.kind === 'focus' && o.step <= action.step);
    const announced = events.some(o => o.kind === 'live-region' || o.kind === 'focus' || o.kind === 'focus-lost'
      || (o.kind === 'appeared' && ANNOUNCING_SURFACES.includes(String(o.role)))
      || (o.kind === 'navigation' && o.sameDocument === false)
      || (o.kind === 'state' && !!lastFocus && o.name === lastFocus.name && o.role === lastFocus.role));
    if ((pixelsChanged || domChanged) && !announced && observer.length) hints.push({ kind: 'missing-announcement', certainty: 'suspected', steps: [action.step],
      summary: `${keyOf(action)} changed the page, but no announcement, focus move or page load was recorded.`,
      detail: { pixelsChanged, changes: events.map(o => o.kind === 'state' ? `${o.attr} on ${label(o)}` : o.kind) },
      evidence: [action.eventId, ...events.map(o => o.id), ...(screen ? [screen.eventId] : [])] });
  }

  for (const action of actions.filter(isNavigation)) {
    const screen = screenAt(action.step), before = previousScreen(action.step), focus = at(action.step).find(o => o.kind === 'focus');
    if (screen && before && focus && screen.sha256 === before.sha256) hints.push({ kind: 'invisible-focus-change', certainty: 'observed', steps: [action.step],
      summary: `Focus moved to ${label(focus)} but the screen did not change.`, detail: { target: { role: focus.role, name: focus.name } }, evidence: [action.eventId, focus.id, screen.eventId] });
  }

  for (const item of evidence.filter(e => e.data.kind === 'model-inference' && Array.isArray(e.data.probabilities) && Array.isArray(e.data.choices))) {
    const probabilities = item.data.probabilities as number[], choices = item.data.choices as { id?: string }[];
    const index = choices.findIndex(c => c.id === item.data.choiceId); if (index < 0) continue;
    const chosen = probabilities[index]!, runnerUp = Math.max(0, ...probabilities.filter((_, i) => i !== index));
    if (chosen < t.hesitationProbability || chosen - runnerUp < t.hesitationMargin) hints.push({ kind: 'model-hesitation', certainty: 'suspected', steps: [item.step],
      summary: `The model chose ${String(item.data.choiceId)} with ${(chosen * 100).toFixed(0)}% (runner-up ${(runnerUp * 100).toFixed(0)}%).`,
      detail: { choiceId: item.data.choiceId, probability: chosen, runnerUp }, evidence: [item.id] });
  }

  // Goal rules that already held before any action make "reached the goal" weak evidence. `not` rules hold at start by design.
  const baseline = (trace.events as readonly TraceEvent[]).find(e => e.type === 'verifier.baseline');
  const baseRules = baseline && record(baseline.data) && Array.isArray(baseline.data.rules) ? (baseline.data.rules as { ruleIndex?: number; ruleType?: string; passed?: boolean }[]).filter(r => r.passed === true && r.ruleType !== 'not') : [];
  if (baseline && baseRules.length) {
    const all = record(baseline.data) && baseline.data.passed === true;
    hints.push({ kind: 'goal-met-at-start', certainty: all ? 'observed' : 'suspected', steps: [0],
      summary: all ? 'Every goal rule already held before the first action.' : `${baseRules.length} goal rule(s) already held before the first action.`,
      detail: { rules: baseRules.map(r => ({ ruleIndex: r.ruleIndex, ruleType: r.ruleType })) }, evidence: [baseline.id] });
  }

  const outcome = trace.outcome;
  if (outcome && (outcome.reason === 'policy-stuck' || outcome.reason === 'policy-uncertain' || outcome.policyStopSource === 'exploration-guard')) hints.push({
    kind: 'early-stop', certainty: 'observed', steps: typeof outcome.step === 'number' ? [outcome.step] : [],
    summary: outcome.policyStopSource === 'exploration-guard' ? 'The repetition guard stopped the run.' : `The model stopped as ${outcome.reason === 'policy-stuck' ? 'stuck' : 'uncertain'}.`,
    detail: { reason: outcome.reason, ...(outcome.policyStopSource ? { stopSource: outcome.policyStopSource } : {}) }, evidence: [] });

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
