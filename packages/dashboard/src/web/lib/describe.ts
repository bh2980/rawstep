import type { Hint, StepView } from '../../shared/api.js';
import { ko } from '../i18n/ko.js';

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

const REDACTED = '[REDACTED]';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function target(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const name = str(value.name);
  return ko.hints.text.target(str(value.role), name && name !== REDACTED ? name : undefined);
}

function keyCounts(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  return entries.length ? entries.sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ×${count}`).join(', ') : undefined;
}

/**
 * Korean sentence for a friction hint, built from its kind and structured detail.
 * Falls back to the English summary for unknown kinds or when a needed detail field is missing.
 */
export function describeHint(hint: Pick<Hint, 'kind' | 'summary' | 'detail'> & Partial<Pick<Hint, 'certainty'>>): string {
  const d: Record<string, unknown> = isRecord(hint.detail) ? hint.detail : {};
  const t = ko.hints.text;
  switch (hint.kind) {
    case 'slow-run': {
      const steps = num(d.steps), reference = num(d.referenceSteps);
      if (steps === undefined || reference === undefined) break;
      return t.slowRun(steps, reference, num(d.durationMs), num(d.referenceDurationMs));
    }
    case 'excess-keystrokes': {
      const count = num(d.count);
      if (count === undefined) break;
      return t.excessKeystrokes(count, target(d.target), keyCounts(d.keys));
    }
    case 'backtracking': {
      const reversals = num(d.reversals);
      if (reversals === undefined) break;
      return t.backtracking(reversals);
    }
    case 'repeated-state': {
      const visits = num(d.visits);
      if (visits === undefined) break;
      return t.repeatedState(visits);
    }
    case 'focus-lost': {
      if (str(d.reason) === undefined && !isRecord(d.from)) break;
      return t.focusLost(target(d.from), str(d.reason), str(d.action));
    }
    case 'focus-not-visible': {
      const subject = target(d.target);
      if (subject && (d.visible === false || d.inViewport === false)) return t.focusNotVisibleTarget(subject, d.visible === false);
      if (d.centerOccluded === true) return t.focusCovered;
      if (d.indicator === 'not-detected') return t.focusNoIndicator;
      break;
    }
    case 'modal-focus-outside': {
      const dialog = target(d.dialog), subject = target(d.target);
      if (dialog) return t.dialogFocusNotMoved(dialog);
      if (subject) return t.modalFocusOutside(subject);
      break;
    }
    case 'missing-announcement': {
      if (d.pixelsChanged === undefined && !Array.isArray(d.changes)) break;
      return t.missingAnnouncement(str(d.action));
    }
    case 'invisible-focus-change': {
      const subject = target(d.target);
      if (!subject) break;
      return t.invisibleFocusChange(subject);
    }
    case 'model-hesitation': {
      const choice = str(d.choiceId), probability = num(d.probability), runnerUp = num(d.runnerUp);
      if (!choice || probability === undefined || runnerUp === undefined) break;
      return t.modelHesitation(choice, probability, runnerUp);
    }
    case 'early-stop': {
      if (str(d.stopSource) === 'exploration-guard') return t.earlyStopGuard;
      if (str(d.reason) === 'policy-stuck') return t.earlyStopStuck;
      if (str(d.reason) === 'policy-uncertain') return t.earlyStopUncertain;
      break;
    }
    case 'goal-met-at-start': {
      if (!Array.isArray(d.rules)) break;
      // The report marks the hint observed only when every goal rule held; otherwise it is suspected.
      return hint.certainty === 'observed' ? t.goalMetAll : t.goalMetSome(d.rules.length);
    }
    case 'focus-left-page': return t.focusLeftPage(str(d.action));
  }
  return hint.summary;
}
