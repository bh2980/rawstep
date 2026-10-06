import type { RunState } from '../../shared/config.js';
import { t } from '../i18n/index.js';
import { runStateLabel } from '../i18n/labels.js';

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
