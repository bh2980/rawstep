import type { RunStepsView, StepView } from '../../shared/api.js';
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

/** How many steps the detail rail shows at once. */
export const DETAIL_RAIL_SIZE = 15;

/**
 * The part of the rail the detail rail shows: `size` places around `current`, kept inside `0..total`.
 * `start` is inclusive and `end` exclusive; all of them when there are no more than `size`.
 */
export function railWindow(total: number, current: number, size: number = DETAIL_RAIL_SIZE): { start: number; end: number } {
  const count = Math.max(0, Math.floor(total)), width = Math.max(1, Math.floor(size));
  if (count <= width) return { start: 0, end: count };
  const at = Math.min(count - 1, Math.max(0, Math.floor(current)));
  const start = Math.min(count - width, Math.max(0, at - Math.floor(width / 2)));
  return { start, end: start + width };
}

/** The step the arrow keys, Home and End move to from `index` in a rail of `total` steps, or `undefined` for any other key. */
export function railKeyTarget(key: string, index: number, total: number): number | undefined {
  if (total <= 0) return undefined;
  const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: total - 1 }[key];
  return next === undefined ? undefined : Math.min(total - 1, Math.max(0, next));
}

/** The step a run page shows when the address names none: the newest while live, otherwise the first one with a hint, otherwise the last. */
export function defaultStep(view: Pick<RunStepsView, 'steps' | 'live'>): number | undefined {
  const steps = view.steps;
  if (!steps.length) return undefined;
  if (view.live) return steps[steps.length - 1]!.step;
  return (steps.find(step => step.hints.length > 0) ?? steps[steps.length - 1]!).step;
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
