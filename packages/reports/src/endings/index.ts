/**
 * How a run ended, in the terms of the question Rawstep answers (can a first-time user do this task, and at what cost):
 * - `reached`: the goal was reached, as checked by Rawstep;
 * - `gave-up`: the user decided nothing they heard left another way to try;
 * - `mistaken`: the user said the goal was reached, and it was not;
 * - `unmeasured`: a limit or the harness ended the run first, so it says nothing about the user (`by` says which).
 * Pure and free of Node APIs, so a browser page can use it too.
 */
export type RunEnding = 'reached' | 'gave-up' | 'mistaken' | 'unmeasured';
export type UnmeasuredBy = 'planner-calls' | 'no-allowed-action' | 'max-steps' | 'timeout' | 'repetition-guard' | 'model-uncertain' | 'other';
export type EndingOf = { ending: RunEnding; by?: UnmeasuredBy };

/** The ending of a finished run from its outcome and who stopped it (the trace's `policyStopSource`). */
export function runEnding(outcome: { status: string; reason?: string } | undefined, stopSource?: string): EndingOf | undefined {
  if (!outcome) return undefined;
  if (outcome.status === 'success') return { ending: 'reached' };
  if (stopSource === 'user-gave-up') return { ending: 'gave-up' };
  if (stopSource === 'orchestration-limit') return { ending: 'unmeasured', by: 'planner-calls' };
  // The profile cannot do what the plan's task needs: the run measured the conditions, not the user.
  if (stopSource === 'no-allowed-action') return { ending: 'unmeasured', by: 'no-allowed-action' };
  if (stopSource === 'exploration-guard') return { ending: 'unmeasured', by: 'repetition-guard' };
  switch (outcome.reason) {
    case 'verification-failed': return { ending: 'mistaken' };
    // A custom decision policy that stops as stuck gave up; one that stops as unsure did not say either way.
    case 'policy-stuck': return { ending: 'gave-up' };
    case 'policy-uncertain': return { ending: 'unmeasured', by: 'model-uncertain' };
    case 'maxSteps': return { ending: 'unmeasured', by: 'max-steps' };
    case 'timeout': return { ending: 'unmeasured', by: 'timeout' };
    default: return { ending: 'unmeasured', by: 'other' };
  }
}

type BrokenDetail = { detail: Record<string, unknown> };
/**
 * An `expectation-broken` hint that marks a stuck place: the user pressed the object a moment before and it did not respond as they
 * expected. One that broke because the user came upon the goal while after something else (`goal-heard`) cost them nothing.
 */
export const isStuck = (hint: BrokenDetail) => hint.detail.trigger !== 'goal-heard' && typeof hint.detail.pressed === 'number';
/** An `expectation-broken` hint that was a guess about where something is, broken while moving: counted, not placed on an object. */
export const isWrongGuess = (hint: BrokenDetail) => hint.detail.trigger !== 'goal-heard' && typeof hint.detail.pressed !== 'number';
