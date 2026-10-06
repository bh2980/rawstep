import type { HintFinding } from '../../shared/api.js';
import { t } from '../i18n/index.js';
import { formatSteps } from './format.js';

type Detail = Record<string, unknown>;
const isRecord = (value: unknown): value is Detail => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** The numbers recorded under `key` in every occurrence of a finding. */
const numbers = (finding: Pick<HintFinding, 'occurrences'>, key: string): number[] =>
  finding.occurrences.flatMap(occurrence => isRecord(occurrence.detail) && typeof occurrence.detail[key] === 'number' && Number.isFinite(occurrence.detail[key]) ? [occurrence.detail[key] as number] : []);
const first = (finding: Pick<HintFinding, 'occurrences'>): Detail => isRecord(finding.occurrences[0]?.detail) ? finding.occurrences[0]!.detail : {};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * What a recurring finding says in plain Korean, from the details of its occurrences. The element it is about is
 * shown next to this text, so the sentence does not repeat it. Returns `undefined` for a kind without a sentence.
 */
export function describeFinding(finding: Pick<HintFinding, 'kind' | 'counts' | 'occurrences'>): string | undefined {
  const detail = first(finding);
  switch (finding.kind) {
    case 'excess-keystrokes':
      if (!finding.counts) return t('findings.excessKeystrokesPlain');
      return finding.counts.min === finding.counts.max
        ? t('findings.excessKeystrokesOnce', { count: finding.counts.min })
        : t('findings.excessKeystrokes', { mean: formatSteps(Math.round(finding.counts.mean * 10) / 10), min: finding.counts.min, max: finding.counts.max });
    case 'focus-lost': return str(detail.reason) === 'removed' ? t('findings.focusLostRemoved') : t('findings.focusLostLeft');
    case 'focus-left-page': return t('findings.focusLeftPage');
    case 'focus-not-visible':
      if (detail.visible === false) return t('findings.focusNotVisibleHidden');
      if (detail.inViewport === false) return t('findings.focusNotVisibleViewport');
      if (detail.centerOccluded === true) return t('findings.focusCovered');
      return detail.indicator === 'not-detected' ? t('findings.focusNoIndicator') : undefined;
    case 'modal-focus-outside': return isRecord(detail.dialog) ? t('findings.dialogFocusNotMoved') : t('findings.modalFocusOutside');
    case 'missing-announcement': return t('findings.missingAnnouncement');
    case 'invisible-focus-change': return t('findings.invisibleFocusChange');
    case 'backtracking': {
      const reversals = numbers(finding, 'reversals');
      return reversals.length ? t('findings.backtracking', { max: Math.max(...reversals) }) : t('findings.backtrackingPlain');
    }
    case 'repeated-state': {
      const visits = numbers(finding, 'visits');
      return visits.length ? t('findings.repeatedState', { max: Math.max(...visits) }) : undefined;
    }
    case 'model-hesitation': {
      const probabilities = numbers(finding, 'probability');
      return probabilities.length ? t('findings.modelHesitation', { percent: Math.round(mean(probabilities) * 100) }) : t('findings.modelHesitationPlain');
    }
    case 'early-stop':
      if (str(detail.stopSource) === 'exploration-guard') return t('findings.earlyStopGuard');
      if (str(detail.reason) === 'policy-stuck') return t('findings.earlyStopStuck');
      return str(detail.reason) === 'policy-uncertain' ? t('findings.earlyStopUncertain') : undefined;
    default: return undefined;
  }
}

/** The first occurrence of a finding, as the run and action to open: the earliest step it points at, if any. */
export function firstOccurrence(finding: Pick<HintFinding, 'occurrences'>): { runId: string; steps: number[] } | undefined {
  const occurrence = finding.occurrences[0];
  return occurrence ? { runId: occurrence.runId, steps: [...new Set(occurrence.steps)].sort((a, b) => a - b) } : undefined;
}

/** `1–9` for several actions, `4` for one, nothing when the finding does not point at an action. */
export function stepRange(steps: readonly number[]): string | undefined {
  if (!steps.length) return undefined;
  const from = steps[0]!, to = steps[steps.length - 1]!;
  return from === to ? String(from) : `${from}–${to}`;
}
