import type { RunRecord } from '../../shared/config.js';
import { goalUnconfirmed, runEnding, type RunEnding, type UnmeasuredBy } from '@rawstep/reports/endings';

/** How a finished run ended (reached, gave up, mistaken, not measured); undefined while it runs or when it stopped on an error. */
export function finishedEnding(run: Pick<RunRecord, 'state' | 'outcome'>): ReturnType<typeof runEnding> {
  return ['success', 'failure', 'inconclusive'].includes(run.state) ? runEnding(run.outcome) : undefined;
}

/** The finished runs of one task, the newest `limit` of them, oldest first, ready for a run strip. */
export function recentRuns<T extends { run: Pick<RunRecord, 'taskId' | 'state'> }>(runs: readonly T[], taskId: string, limit = 10): T[] {
  return runs.filter(ref => ref.run.taskId === taskId && ['success', 'failure', 'inconclusive'].includes(ref.run.state)).slice(0, limit).reverse();
}

/** What a status mark shows: how a finished run ended, `error` for one that stopped on the tool's side, or where an unfinished run is. */
export type RunStatus = RunEnding | 'error' | 'running' | 'queued' | 'cancelled';

/**
 * What is said beside a status: what ended a run that was not measured first, or, for a run that reached the goal, that nothing
 * showed the user knew (`unconfirmed`: a note beside the ending, never an ending). Each has its words under `taskPage.results.by`.
 */
export type StatusNote = UnmeasuredBy | 'unconfirmed';
/** The status of a run, and the note to say beside it (`StatusNote`). */
export function runStatus(run: Pick<RunRecord, 'state' | 'outcome'>): { status: RunStatus; by?: StatusNote } {
  if (run.state === 'queued' || run.state === 'running' || run.state === 'cancelled') return { status: run.state };
  const ended = finishedEnding(run);
  if (ended) return { status: ended.ending, ...(ended.by ? { by: ended.by } : goalUnconfirmed(run.outcome) ? { by: 'unconfirmed' as const } : {}) };
  return { status: 'error' };
}
