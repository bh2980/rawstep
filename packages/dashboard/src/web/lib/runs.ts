import type { Experiment, RunRecord } from '../../shared/config.js';

export type RunRef = { experiment: Experiment; run: RunRecord };

export const isLive = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
export const isFinished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';

export function runStartedAt(ref: RunRef): number {
  const time = Date.parse(ref.run.startedAt ?? ref.experiment.createdAt);
  return Number.isFinite(time) ? time : 0;
}

/** Every run of every experiment, newest first. */
export function flattenRuns(experiments: readonly Experiment[]): RunRef[] {
  return experiments
    .flatMap(experiment => experiment.runs.map(run => ({ experiment, run })))
    .sort((a, b) => runStartedAt(b) - runStartedAt(a) || b.run.repeat - a.run.repeat);
}

export function findRun(runs: readonly RunRef[], runId: string | undefined): RunRef | undefined {
  return runId ? runs.find(ref => ref.run.id === runId) : undefined;
}

export function durationSeconds(run: RunRecord): number | undefined {
  if (!run.startedAt || !run.endedAt) return undefined;
  const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : undefined;
}

export function runStepCount(run: RunRecord): number | undefined {
  return typeof run.outcome?.steps === 'number' ? run.outcome.steps : undefined;
}

export function runPath(experimentId: string, runId: string): string {
  return `/experiments/${experimentId}/runs/${runId}`;
}

export function screenshotUrl(experimentId: string, runId: string, eventId: string): string {
  return `/api${runPath(experimentId, runId)}/png/${encodeURIComponent(eventId)}`;
}

/** Name of a run profile by id; the id itself when the profile no longer exists. */
export function profileName(profiles: readonly { id: string; name: string }[], id: string): string {
  return profiles.find(profile => profile.id === id)?.name ?? id;
}

/** The profile name a run executed with: the name recorded in its snapshot, else the current profile name, else the id. */
export function runProfileName(profiles: readonly { id: string; name: string }[], run: Pick<RunRecord, 'profileId' | 'snapshot'>): string {
  return run.snapshot.runProfile?.name ?? profileName(profiles, run.profileId);
}

/** "Run #n" numbers of one task's runs: 1 is the oldest. Runs of other tasks are ignored. */
export function taskRunNumbers(runs: readonly RunRef[], taskId: string): Map<string, number> {
  const mine = runs.filter(ref => ref.run.taskId === taskId).sort((a, b) => runStartedAt(a) - runStartedAt(b) || a.run.repeat - b.run.repeat);
  return new Map(mine.map((ref, index) => [ref.run.id, index + 1]));
}

/** The finished run that reached the goal in the fewest actions; the first one wins a tie. */
export function fastestRun(runs: readonly RunRef[]): { ref: RunRef; steps: number } | undefined {
  let best: { ref: RunRef; steps: number } | undefined;
  for (const ref of runs) {
    const steps = runStepCount(ref.run);
    if (ref.run.state === 'success' && steps !== undefined && (!best || steps < best.steps)) best = { ref, steps };
  }
  return best;
}
