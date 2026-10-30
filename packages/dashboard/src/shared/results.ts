import type { RunRecord } from './config.js';

/**
 * How a run ended, in the terms of the question Rawstep answers (can a first-time user do this task, and at what cost):
 * - `reached`: the goal was reached, as checked by Rawstep;
 * - `gave-up`: the user decided nothing they heard left another way to try;
 * - `mistaken`: the user said the goal was reached, and it was not;
 * - `unmeasured`: a limit or the harness ended the run first, so it says nothing about the user (`by` says which).
 */
export type RunEnding = 'reached' | 'gave-up' | 'mistaken' | 'unmeasured';
export type UnmeasuredBy = 'planner-calls' | 'max-steps' | 'timeout' | 'repetition-guard' | 'model-uncertain' | 'other';
export type EndingOf = { ending: RunEnding; by?: UnmeasuredBy };

/** The ending of a finished run from its outcome; `stopSource` falls back to the one a run's hints recorded (older runs keep none). */
export function runEnding(outcome: RunRecord['outcome'], stopSource = outcome?.stopSource): EndingOf | undefined {
  if (!outcome) return undefined;
  if (outcome.status === 'success') return { ending: 'reached' };
  if (stopSource === 'user-gave-up') return { ending: 'gave-up' };
  if (stopSource === 'orchestration-limit') return { ending: 'unmeasured', by: 'planner-calls' };
  if (stopSource === 'exploration-guard') return { ending: 'unmeasured', by: 'repetition-guard' };
  switch (outcome.reason) {
    case 'verification-failed': return { ending: 'mistaken' };
    // A model that stops as stuck without a plan (keyboard runs) gave up; one that stops as unsure did not say either way.
    case 'policy-stuck': return { ending: 'gave-up' };
    case 'policy-uncertain': return { ending: 'unmeasured', by: 'model-uncertain' };
    case 'maxSteps': return { ending: 'unmeasured', by: 'max-steps' };
    case 'timeout': return { ending: 'unmeasured', by: 'timeout' };
    default: return { ending: 'unmeasured', by: 'other' };
  }
}
