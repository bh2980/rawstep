import type { Hint, StepView } from '../../shared/api.js';
import { t } from '../i18n/index.js';
import { intentLabel } from '../i18n/labels.js';

/** Human label for the action or stop recorded at a step. */
export function describeStep(step: Pick<StepView, 'step' | 'action' | 'stop'>): string {
  if (step.step === 0 && !step.action && !step.stop) return t('steps.start');
  if (step.stop) return t('steps.stop', { reason: step.stop.stop });
  const action = step.action;
  if (!action) return t('steps.unknownAction');
  if (action.kind === 'typeText') return action.input ? t('steps.typeTextNamed', { name: action.input }) : t('steps.typeText');
  if (action.kind === 'replaceText') return action.input ? t('steps.replaceTextNamed', { name: action.input }) : t('steps.replaceText');
  if (action.key) return action.key;
  if (action.intent) return intentLabel(action.intent);
  return t('steps.unknownAction');
}

const REDACTED = '[REDACTED]';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function target(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const name = str(value.name);
  const role = str(value.role) ?? t('hints.text.element');
  return name && name !== REDACTED ? t('hints.text.targetNamed', { role, name }) : role;
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
  switch (hint.kind) {
    case 'slow-run': {
      const steps = num(d.steps), reference = num(d.referenceSteps);
      if (steps === undefined || reference === undefined) break;
      const duration = num(d.durationMs), referenceDuration = num(d.referenceDurationMs);
      const text = t('hints.text.slowRun', { steps, referenceSteps: reference, extra: steps - reference });
      return duration !== undefined && referenceDuration !== undefined
        ? `${text} ${t('hints.text.slowRunDuration', { duration: (duration / 1000).toFixed(1), referenceDuration: (referenceDuration / 1000).toFixed(1) })}`
        : text;
    }
    case 'excess-keystrokes': {
      const count = num(d.count);
      if (count === undefined) break;
      const subject = target(d.target) ?? t('hints.text.focusedControl'), keys = keyCounts(d.keys);
      return keys ? t('hints.text.excessKeystrokesWithKeys', { target: subject, n: count, keys }) : t('hints.text.excessKeystrokes', { target: subject, n: count });
    }
    case 'backtracking': {
      const reversals = num(d.reversals);
      if (reversals === undefined) break;
      return t('hints.text.backtracking', { n: reversals });
    }
    case 'repeated-state': {
      const visits = num(d.visits);
      if (visits === undefined) break;
      return t('hints.text.repeatedState', { n: visits });
    }
    case 'focus-lost': {
      if (str(d.reason) === undefined && !isRecord(d.from)) break;
      const params = { from: target(d.from) ?? t('hints.text.focusedElement'), action: str(d.action) ?? t('hints.text.action') };
      return str(d.reason) === 'removed' ? t('hints.text.focusLostRemoved', params) : t('hints.text.focusLostLeft', params);
    }
    case 'focus-not-visible': {
      const subject = target(d.target);
      if (subject && (d.visible === false || d.inViewport === false)) return t(d.visible === false ? 'hints.text.focusNotVisibleHidden' : 'hints.text.focusNotVisibleViewport', { target: subject });
      if (d.centerOccluded === true) return t('hints.text.focusCovered');
      if (d.indicator === 'not-detected') return t('hints.text.focusNoIndicator');
      break;
    }
    case 'modal-focus-outside': {
      const dialog = target(d.dialog), subject = target(d.target);
      if (dialog) return t('hints.text.dialogFocusNotMoved', { dialog });
      if (subject) return t('hints.text.modalFocusOutside', { target: subject });
      break;
    }
    case 'missing-announcement': {
      if (d.pixelsChanged === undefined && !Array.isArray(d.changes)) break;
      return t('hints.text.missingAnnouncement', { action: str(d.action) ?? t('hints.text.action') });
    }
    case 'invisible-focus-change': {
      const subject = target(d.target);
      if (!subject) break;
      return t('hints.text.invisibleFocusChange', { target: subject });
    }
    case 'model-hesitation': {
      const choice = str(d.choiceId), probability = num(d.probability), runnerUp = num(d.runnerUp);
      if (!choice || probability === undefined || runnerUp === undefined) break;
      return t('hints.text.modelHesitation', { choiceId: choiceLabel(choice), score: probability.toFixed(2), runnerUp: runnerUp.toFixed(2) });
    }
    case 'early-stop': {
      if (str(d.stopSource) === 'exploration-guard') return t('hints.text.earlyStopGuard');
      if (str(d.reason) === 'policy-stuck') return t('hints.text.earlyStopStuck');
      if (str(d.reason) === 'policy-uncertain') return t('hints.text.earlyStopUncertain');
      break;
    }
    case 'goal-met-at-start': {
      if (!Array.isArray(d.rules)) break;
      // The report marks the hint observed only when every goal rule held; otherwise it is suspected.
      return hint.certainty === 'observed' ? t('hints.text.goalMetAll') : t('hints.text.goalMetSome', { n: d.rules.length });
    }
    case 'focus-left-page': {
      const action = str(d.action);
      return action ? t('hints.text.focusLeftPageAfter', { action }) : t('hints.text.focusLeftPage');
    }
  }
  return hint.summary;
}

/** Candidate ids look like `key:Tab` or `intent:next`; people read the key or command. */
export function choiceLabel(id: string): string {
  const [kind, value] = id.split(/:(.*)/s);
  return value && (kind === 'key' || kind === 'intent') ? value : id;
}
