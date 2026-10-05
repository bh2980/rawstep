import type { StepView } from '../../shared/api';
import { ko } from '../i18n/ko';

/** Human label for the action or stop recorded at a step. */
export function describeStep(step: Pick<StepView, 'step' | 'action' | 'stop'>): string {
  if (step.step === 0 && !step.action && !step.stop) return ko.steps.start;
  if (step.stop) return ko.steps.stop(step.stop.stop);
  const action = step.action;
  if (!action) return ko.steps.unknownAction;
  if (action.kind === 'typeText') return ko.steps.typeText(action.input ?? '');
  if (action.kind === 'replaceText') return ko.steps.replaceText(action.input ?? '');
  if (action.key) return ko.steps.keyAction(action.key);
  if (action.intent) return ko.steps.intents[action.intent] ?? action.intent;
  return ko.steps.unknownAction;
}
