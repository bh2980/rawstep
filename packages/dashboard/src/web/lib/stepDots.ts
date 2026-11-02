import type { Hint, RunStepsView, StepView } from '../../shared/api.js';
import { describeStep } from './describe.js';
import { t } from '../i18n/index.js';
import { targetLabel } from '../i18n/labels.js';
import { planMark } from './plan.js';

const NAVIGATION_KEYS = new Set(['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const NAVIGATION_INTENTS = new Set(['next', 'previous', 'heading.next', 'heading.previous', 'form.next', 'form.previous', 'link.next', 'link.previous']);

/** `move`: a navigation key or intent, nothing else happened. `press`: the start, a stop, an activation, typing or a page change. */
export type DotKind = 'move' | 'press';

export function dotKind(step: Pick<StepView, 'step' | 'action' | 'stop' | 'observed'>): DotKind {
  const action = step.action;
  if (!action || step.stop) return 'press';
  if (step.observed.some(change => change.kind === 'navigation')) return 'press';
  if (action.kind === 'key' && action.key && NAVIGATION_KEYS.has(action.key)) return 'move';
  return action.kind === 'intent' && action.intent && NAVIGATION_INTENTS.has(action.intent) ? 'move' : 'press';
}

/** What a step is drawn as on the rails: `inspect` (◎, a hint points at it) wins over `press` (●) and `move` (·). The step's accessible label always names every one that applies. */
export type StepGlyph = 'move' | 'press' | 'inspect';

export function stepGlyph(step: Pick<StepView, 'step' | 'action' | 'stop' | 'observed' | 'hints'>): StepGlyph {
  return step.hints.length > 0 ? 'inspect' : dotKind(step);
}

/** The step the arrow keys, Home and End move to from `index` in a rail of `total` steps, or `undefined` for any other key. */
export function railKeyTarget(key: string, index: number, total: number): number | undefined {
  if (total <= 0) return undefined;
  const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: total - 1 }[key];
  return next === undefined ? undefined : Math.min(total - 1, Math.max(0, next));
}

/** The step a run page shows when the address names none: the newest, whether the run is live or finished. */
export function defaultStep(view: Pick<RunStepsView, 'steps' | 'live'>): number | undefined {
  const steps = view.steps;
  if (!steps.length) return undefined;
  // A finished run opens at its end too: opening at a step in the middle was read as where the run stopped.
  return steps[steps.length - 1]!.step;
}

/** What a screen reader hears for a step on the rail: `행동 7: Tab, 살펴볼 지점, 다시 계획`. */
export function dotLabel(step: StepView): string {
  const parts = [step.step === 0 ? describeStep(step) : t('runPage.dotLabel', { n: step.step, action: describeStep(step) })];
  if (step.hints.length) parts.push(t('runPage.dotHints'));
  const mark = planMark(step);
  if (mark) parts.push(t(mark === 'replan' ? 'runPage.dotReplan' : mark === 'broken' ? 'runPage.dotBroken' : 'runPage.dotLimit'));
  return parts.join(', ');
}

/** One line announced when a step arrives during a live run. */
export function announcement(step: StepView): string {
  return t('runPage.announce', { n: step.step, action: describeStep(step) });
}

/** What a live run is doing now: the action and, when focus landed somewhere, where (`Tab → 버튼 “배송지 변경”`). */
export function liveCurrentLine(step: Pick<StepView, 'step' | 'action' | 'stop' | 'observed'>): string {
  const action = describeStep(step);
  const focus = step.observed.find(change => change.kind === 'focus');
  if (!focus) return action;
  return t('runHeader.liveCurrentAction', { action, target: targetLabel({ role: focus.role || t('observed.element'), ...(focus.name ? { name: focus.name } : {}) }) });
}

/** The words a step's screen reader said, as one line; empty when nothing was recorded. */
export const speechText = (step: Pick<StepView, 'speech'> | undefined): string => step?.speech?.lines.join(' ').trim() ?? '';

/** Whether a step heard exactly what the step before it heard (both with recorded speech): the move changed nothing a listener could notice. */
export function sameSpeech(step: Pick<StepView, 'speech'>, before: Pick<StepView, 'speech'> | undefined): boolean {
  const now = speechText(step);
  return !!now && now === speechText(before);
}

/**
 * The step at which a word of the goal was heard right after the longest stretch without one (the goal-word-stretch hint). The stretch
 * ends only on speech that held a goal word, so the next step with recorded speech is that step. Undefined when the stretch ran to the end.
 */
export function goalWordHeardAt(steps: readonly Pick<StepView, 'step' | 'speech'>[], hints: readonly Pick<Hint, 'kind' | 'detail'>[]): number | undefined {
  const to = hints.find(hint => hint.kind === 'goal-word-stretch')?.detail.to;
  if (typeof to !== 'number') return undefined;
  const next = steps.find(step => step.step === to + 1);
  return next && speechText(next) ? next.step : undefined;
}

/** A bracket under the rail: the longest stretch without a goal word, or a stretch where every move heard the same thing. */
export type RailSpan = { kind: 'goal-stretch' | 'same-speech'; from: number; to: number; count: number; speech?: string };

/** The brackets under the rail, by first step. Same-speech stretches count the first step that heard it, and need `minSame` steps. */
export function railSpans(steps: readonly Pick<StepView, 'step' | 'speech'>[], hints: readonly Pick<Hint, 'kind' | 'detail'>[], minSame = 3): RailSpan[] {
  const spans: RailSpan[] = [];
  const stretch = hints.find(hint => hint.kind === 'goal-word-stretch')?.detail;
  if (stretch && typeof stretch.from === 'number' && typeof stretch.to === 'number') spans.push({ kind: 'goal-stretch', from: stretch.from, to: stretch.to, count: typeof stretch.moves === 'number' ? stretch.moves : stretch.to - stretch.from + 1 });
  const acted = steps.filter(step => step.step > 0);
  for (let i = 0; i < acted.length;) {
    let j = i + 1;
    while (j < acted.length && acted[j]!.step === acted[j - 1]!.step + 1 && sameSpeech(acted[j]!, acted[j - 1])) j++;
    if (j - i >= minSame) spans.push({ kind: 'same-speech', from: acted[i]!.step, to: acted[j - 1]!.step, count: j - i, speech: acted[i]!.speech!.lines.at(-1) ?? speechText(acted[i]) });
    i = j;
  }
  return spans.sort((a, b) => a.from - b.from);
}

/** Which plan version each stretch of steps followed: a version starts at the step it was written before and runs until the next. */
export type PlanSegment = { version: number; from: number; to: number };

export function planSegments(versions: readonly { version: number; step: number }[], lastStep: number): PlanSegment[] {
  const sorted = [...versions].sort((a, b) => a.step - b.step || a.version - b.version);
  const segments: PlanSegment[] = [];
  sorted.forEach((version, index) => {
    const from = Math.max(1, version.step), next = sorted[index + 1], to = Math.min(lastStep, next ? Math.max(1, next.step) - 1 : lastStep);
    if (to < from) return;
    segments.push({ version: version.version, from, to });
  });
  return segments;
}

/** Lines for labels that must not overlap: each `[start, end)` goes on the first line whose last label ended before it starts. */
export function stackRows(items: readonly { start: number; end: number }[], gap = 0): number[] {
  const ends: number[] = [], rows = new Array<number>(items.length).fill(0);
  [...items.keys()].sort((a, b) => items[a]!.start - items[b]!.start).forEach(index => {
    const item = items[index]!;
    let row = ends.findIndex(end => end + gap <= item.start);
    if (row < 0) { row = ends.length; ends.push(item.end); } else ends[row] = item.end;
    rows[index] = row;
  });
  return rows;
}

/**
 * A step as the action list sees it. `marks` are what the row shows besides the action and speech (failed, plan version, a goal word,
 * hint kinds); `same` is whether it heard what the step before heard; `notable` whether anything points at it (a mark, a bracket, a
 * hint), so it is never folded away as an uneventful move.
 */
export type StepItem = { step: number; action: string; speech: string; same: boolean; marks: readonly string[]; notable: boolean };
export type StepRow = { kind: 'step'; step: number; collapse?: string } | { kind: 'group'; id: string; mode: 'same' | 'quiet'; steps: number[] };

/**
 * The rows of the action list. With grouping on, a run of `quietMin` or more uneventful moves of the same action folds into one row
 * (`1–13 · 다음 항목 ×13`), and consecutive steps with the same action, speech and marks fold into one (`24–27 · 다음 항목 ×4`). A group
 * opens when it holds the selected step or the person opened it; a group the person opened offers to fold on its first row.
 */
export function stepRows(items: readonly StepItem[], options: { grouped: boolean; selected?: number | undefined; expanded: ReadonlySet<string>; quietMin?: number }): StepRow[] {
  if (!options.grouped) return items.map(item => ({ kind: 'step', step: item.step }));
  const quietMin = options.quietMin ?? 5, rows: StepRow[] = [];
  const quiet = (item: StepItem) => item.step > 0 && !item.notable && item.marks.length === 0;
  const key = (item: StepItem) => [item.action, item.speech, ...item.marks].join('\u0000');
  const next = (a: StepItem, b: StepItem) => b.step === a.step + 1;
  const emit = (mode: 'same' | 'quiet', group: readonly StepItem[]) => {
    const steps = group.map(item => item.step), id = `${mode}:${steps[0]}`;
    const holds = options.selected !== undefined && steps.includes(options.selected);
    if (!holds && !options.expanded.has(id)) { rows.push({ kind: 'group', id, mode, steps }); return; }
    steps.forEach((step, index) => rows.push(index === 0 && !holds ? { kind: 'step', step, collapse: id } : { kind: 'step', step }));
  };
  const sameGroups = (part: readonly StepItem[]) => {
    for (let i = 0; i < part.length;) {
      let j = i + 1;
      while (j < part.length && part[i]!.step > 0 && next(part[j - 1]!, part[j]!) && key(part[j]!) === key(part[i]!)) j++;
      if (j - i >= 2) emit('same', part.slice(i, j)); else rows.push({ kind: 'step', step: part[i]!.step });
      i = j;
    }
  };
  let pending: StepItem[] = [];
  for (let i = 0; i < items.length;) {
    let j = i;
    if (quiet(items[i]!)) { j = i + 1; while (j < items.length && quiet(items[j]!) && next(items[j - 1]!, items[j]!) && items[j]!.action === items[i]!.action) j++; }
    if (j - i >= quietMin) { sameGroups(pending); pending = []; emit('quiet', items.slice(i, j)); i = j; }
    else { pending.push(items[i]!); i++; }
  }
  sameGroups(pending);
  return rows;
}
