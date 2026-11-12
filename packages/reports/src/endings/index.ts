/**
 * How a run ended, in the terms of the question Rawstep answers (can a first-time user do this task, and at what cost):
 * - `reached`: the goal was reached, as checked by Rawstep;
 * - `gave-up`: the user decided nothing they heard left another way to try;
 * - `mistaken`: the user said the goal was reached, and it was not;
 * - `unmeasured`: a limit or the harness ended the run first, so it says nothing about the user (`by` says which).
 * Pure and free of Node APIs, so a browser page can use it too.
 */
import type { RunOutcomeReason } from '@rawstep/core/trace';

export type RunEnding = 'reached' | 'gave-up' | 'mistaken' | 'unmeasured';
/**
 * Why a run was not measured: a cost limit (`planner-calls`, `max-steps`, `timeout`), the repetition guard, a profile that allows no
 * action the plan needs, a custom policy unsure, the planner not answering in time (`planner-timeout`), the site blocking the browser
 * (`blocked`: a bot check or an access error on the first page) or this computer not applying the page environment (`environment`).
 */
export type UnmeasuredBy = 'planner-calls' | 'no-allowed-action' | 'max-steps' | 'timeout' | 'repetition-guard' | 'model-uncertain'
  | 'planner-timeout' | 'blocked' | 'environment' | 'other';
export type EndingOf = { ending: RunEnding; by?: UnmeasuredBy };
/** A recorded outcome as the readers here take it: a trace's own, or the part of it a batch record keeps. Both name who stopped the run `policyStopSource`. */
export type EndedOutcome = { status: string; reason?: string; policyStopSource?: unknown };

/**
 * The run broke before it could say anything about the user or the page: it never produced an outcome (the browser, the model or the
 * screen reader did not start), was cancelled, hit a runtime error, or its trace could not be written. Such a run has no ending and
 * is never counted with the runs that have one. The one test for this: every reader (the summary, the CLI, the dashboard, the report)
 * asks here.
 */
export function runBroke(outcome: EndedOutcome | undefined): boolean {
  return !outcome || outcome.status === 'aborted' || outcome.reason === 'error' || outcome.reason === 'trace-persistence-error';
}
/** The ending of a finished run, or undefined for a run that broke (`runBroke`). Who stopped it is read from the outcome. */
export function runEnding(outcome: EndedOutcome | undefined): EndingOf | undefined {
  if (!outcome || runBroke(outcome)) return undefined;
  const stopSource = outcome.policyStopSource;
  if (outcome.status === 'success') return { ending: 'reached' };
  if (stopSource === 'user-gave-up') return { ending: 'gave-up' };
  if (stopSource === 'orchestration-limit') return { ending: 'unmeasured', by: 'planner-calls' };
  // The profile cannot do what the plan's task needs: the run measured the conditions, not the user.
  if (stopSource === 'no-allowed-action') return { ending: 'unmeasured', by: 'no-allowed-action' };
  if (stopSource === 'exploration-guard') return { ending: 'unmeasured', by: 'repetition-guard' };
  // A reason this Rawstep does not write (an older or newer trace) is read as an early stop of another cause.
  const reason = outcome.reason as RunOutcomeReason | undefined;
  switch (reason) {
    case 'verification-failed': return { ending: 'mistaken' };
    // A custom decision policy that stops as stuck gave up; one that stops as unsure did not say either way.
    case 'policy-stuck': return { ending: 'gave-up' };
    case 'policy-uncertain': return { ending: 'unmeasured', by: 'model-uncertain' };
    case 'maxSteps': return { ending: 'unmeasured', by: 'max-steps' };
    case 'timeout': return { ending: 'unmeasured', by: 'timeout' };
    case 'planner-timeout': return { ending: 'unmeasured', by: 'planner-timeout' };
    case 'access-blocked': return { ending: 'unmeasured', by: 'blocked' };
    case 'unsupported-profile': return { ending: 'unmeasured', by: 'environment' };
    // The page uses a pattern the simulated screen reader has no recorded speech for: the simulation stopped, not the user.
    case 'unsupported-pattern': return { ending: 'unmeasured', by: 'other' };
    // `verified` goes with a success status and the three below with a run that broke, both handled above; a trace that pairs them
    // otherwise is read as an early stop.
    case 'verified': case 'error': case 'aborted': case 'trace-persistence-error': case undefined: return { ending: 'unmeasured', by: 'other' };
    default: { const unknown: never = reason; void unknown; return { ending: 'unmeasured', by: 'other' }; }
  }
}
/** Whether an ending says something about the user (reached, gave up, said done when it was not): a run that was not measured does not. */
export const isMeasured = (ending: EndingOf | undefined): boolean => !!ending && ending.ending !== 'unmeasured';

/**
 * A run reached the goal with nothing to show the user knew. A note beside the ending, never the ending itself: the goal check is what
 * the person writing the task calls done. A task where the user has to hear it says so in the check (`activatedAnnouncementIncludes`).
 */
export const goalUnconfirmed = (outcome: { status: string; goalConfirmed?: unknown } | undefined): boolean => outcome?.status === 'success' && outcome.goalConfirmed === false;
/** The middle of a set of counts (moves, mostly): the mean of the two middle ones for an even set, null for an empty one. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
/** What a run cost in moves: up to where the goal check passed. Moves after it only watched whether the user noticed. */
export function runMoves(outcome: object | undefined): number | undefined {
  const { steps, goalStep } = (outcome ?? {}) as { steps?: unknown; goalStep?: unknown }, moves = goalStep ?? steps;
  return typeof moves === 'number' ? moves : undefined;
}

type BrokenDetail = { detail: Record<string, unknown> };
/**
 * An `expectation-broken` hint that marks a stuck place: the user pressed the object a moment before and it did not respond as they
 * expected. One that broke because the user came upon the goal while after something else (`goal-heard`) cost them nothing.
 */
export const isStuck = (hint: BrokenDetail) => hint.detail.trigger !== 'goal-heard' && typeof hint.detail.pressed === 'number';
/** An `expectation-broken` hint that was a guess about where something is, broken while moving: counted, not placed on an object. */
export const isWrongGuess = (hint: BrokenDetail) => hint.detail.trigger !== 'goal-heard' && typeof hint.detail.pressed !== 'number';
