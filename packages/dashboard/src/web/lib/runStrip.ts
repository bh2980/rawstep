import type { RunRecord, RunState } from '../../shared/config.js';
import { t } from '../i18n/index.js';
import { runStateLabel } from '../i18n/labels.js';
import { runEnding, type RunEnding } from '@rawstep/reports/endings';

/** What a run is drawn as: a filled square when the goal was reached, a striped one when not, a hollow one when it is undecided or ended early. */
export type RunGlyphKind = 'reached' | 'missed' | 'inconclusive' | 'live';

export function runGlyphKind(state: RunState): RunGlyphKind {
  if (state === 'success') return 'reached';
  if (state === 'failure') return 'missed';
  return state === 'queued' || state === 'running' ? 'live' : 'inconclusive';
}

/** `실행 #12: 목표 도달, 행동 11번`. The action count is left out while it is unknown. */
export function runStripLabel(number: number | undefined, state: RunState, steps: number | undefined): string {
  const label = runStateLabel(state), n = number ?? '?';
  return steps === undefined ? t('runStrip.itemNoSteps', { number: n, state: label }) : t('runStrip.item', { number: n, state: label, steps });
}

/** A run that ended on an error says nothing about the goal, so it is drawn and worded as undecided whatever state it was recorded in. */
export function displayState(run: Pick<RunRecord, 'state' | 'outcome'>): RunState {
  const reason = run.outcome?.reason;
  return run.state === 'failure' && (reason === 'error' || reason === 'trace-persistence-error') ? 'inconclusive' : run.state;
}

/** How a finished run ended (reached, gave up, mistaken, not measured); undefined while it runs or when it stopped on an error. */
export function finishedEnding(run: Pick<RunRecord, 'state' | 'outcome'>): ReturnType<typeof runEnding> {
  const reason = run.outcome?.reason;
  if (!['success', 'failure', 'inconclusive'].includes(run.state) || reason === 'error' || reason === 'trace-persistence-error') return undefined;
  return runEnding(run.outcome, run.outcome?.stopSource);
}
export const endingGlyph = (ending: RunEnding): RunGlyphKind => ending === 'reached' ? 'reached' : ending === 'unmeasured' ? 'inconclusive' : 'missed';

/** The result of a run in words: how it ended, or, for a run that stopped on an error, that it ended on an error. */
export function resultLabel(run: Pick<RunRecord, 'state' | 'outcome'>): string {
  const reason = run.outcome?.reason, ended = finishedEnding(run);
  if (ended) return t(`taskPage.results.endings.${ended.ending}`) + (ended.by ? ` (${t(`taskPage.results.by.${ended.by}`)})` : '');
  return run.state === 'failure' && (reason === 'error' || reason === 'trace-persistence-error') ? t('runStrip.errored') : runStateLabel(run.state);
}

/** The finished runs of one task, the newest `limit` of them, oldest first, ready for a run strip. */
export function recentRuns<T extends { run: Pick<RunRecord, 'taskId' | 'state'> }>(runs: readonly T[], taskId: string, limit = 10): T[] {
  return runs.filter(ref => ref.run.taskId === taskId && ['success', 'failure', 'inconclusive'].includes(ref.run.state)).slice(0, limit).reverse();
}
