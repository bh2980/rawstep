/** The fewest and most runs that can go at once (`machine.parallelRuns`). */
export const MIN_PARALLEL_RUNS = 1;
export const MAX_PARALLEL_RUNS = 8;

/** The number typed for "runs at once", or nothing when it is not a whole number from 1 to 8. */
export function parseParallelRuns(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= MIN_PARALLEL_RUNS && value <= MAX_PARALLEL_RUNS ? value : undefined;
}
