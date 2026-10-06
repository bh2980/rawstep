import type { ModelKind } from '@rawstep/project/config';
import type { RunStepsView, StepView } from '../../shared/api.js';
import { describeStep } from './describe.js';
import { t } from '../i18n/index.js';

const NAVIGATION_KEYS = new Set(['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const NAVIGATION_INTENTS = new Set(['next', 'previous', 'heading.next', 'heading.previous', 'form.next']);

/** `move`: a navigation key or intent, nothing else happened. `press`: the start, a stop, an activation, typing or a page change. */
export type DotKind = 'move' | 'press';

export function dotKind(step: Pick<StepView, 'step' | 'action' | 'stop' | 'observed'>): DotKind {
  const action = step.action;
  if (!action || step.stop) return 'press';
  if (step.observed.some(change => change.kind === 'navigation')) return 'press';
  if (action.kind === 'key' && action.key && NAVIGATION_KEYS.has(action.key)) return 'move';
  return action.kind === 'intent' && action.intent && NAVIGATION_INTENTS.has(action.intent) ? 'move' : 'press';
}

/** Below this score a Decision model's pick is drawn hollow. */
export const UNSURE_BELOW = 0.5;

/**
 * Whether the model's chosen option scored under 0.5, for a Decision model. LLMs give no scores, so they are never unsure here;
 * a step without a recorded choice or score is not either.
 */
export function isUnsure(step: Pick<StepView, 'model'>, modelKind: ModelKind): boolean {
  if (modelKind !== 'decision' || !step.model) return false;
  const chosen = step.model.candidates?.find(candidate => candidate.id === step.model!.choiceId);
  return chosen?.probability !== undefined && chosen.probability < UNSURE_BELOW;
}

/** The step a run page shows when the address names none: the newest while live, otherwise the first one with a hint, otherwise the last. */
export function defaultStep(view: Pick<RunStepsView, 'steps' | 'live'>): number | undefined {
  const steps = view.steps;
  if (!steps.length) return undefined;
  if (view.live) return steps[steps.length - 1]!.step;
  return (steps.find(step => step.hints.length > 0) ?? steps[steps.length - 1]!).step;
}

/** What a screen reader hears for a dot: the step number, the action and, when the step has hints, that it is worth a look. */
export function dotLabel(step: StepView, unsure: boolean): string {
  const base = step.step === 0 ? describeStep(step) : t('runPage.dotLabel', { n: step.step, action: describeStep(step) });
  return base + (step.hints.length ? t('runPage.dotHints') : '') + (unsure ? t('runPage.dotUnsure') : '');
}

/** One line announced when a step arrives during a live run. */
export function announcement(step: StepView): string {
  return t('runPage.announce', { n: step.step, action: describeStep(step) });
}
