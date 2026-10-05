import type { Mode } from '@rawstep/project/config';
import type { Experiment, RunRecord } from '../../shared/config';

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

export function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function runPath(experimentId: string, runId: string): string {
  return `/experiments/${experimentId}/runs/${runId}`;
}

export function screenshotUrl(experimentId: string, runId: string, eventId: string): string {
  return `/api${runPath(experimentId, runId)}/png/${encodeURIComponent(eventId)}`;
}

export function modeOf(run: RunRecord): Mode {
  return run.snapshot.mode;
}

/** Name of a run profile by id; the id itself when the profile no longer exists. */
export function profileName(profiles: readonly { id: string; name: string }[], id: string): string {
  return profiles.find(profile => profile.id === id)?.name ?? id;
}

/** The profile name a run executed with: the name recorded in its snapshot, else the current profile name, else the id. */
export function runProfileName(profiles: readonly { id: string; name: string }[], run: Pick<RunRecord, 'profileId' | 'snapshot'>): string {
  return run.snapshot.runProfile?.name ?? profileName(profiles, run.profileId);
}
