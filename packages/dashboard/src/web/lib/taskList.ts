/**
 * What the moves-per-profile cell says when it has no measured rows.
 * `neverRun` until a run of this task has finished. Runs that ended on an error are left out of `byProfile`,
 * but the task still has them (`lastRunAt`, or a finished run already in the list). A queued or running run does not count.
 */
export function profileMovesPlaceholder(input: {
  byProfile: readonly unknown[];
  lastRunAt: string | null | undefined;
  /** The run list already has a finished run of this task. */
  listed: boolean;
}): 'neverRun' | 'noMeasured' | undefined {
  if (input.byProfile.length > 0) return undefined;
  return input.lastRunAt || input.listed ? 'noMeasured' : 'neverRun';
}
