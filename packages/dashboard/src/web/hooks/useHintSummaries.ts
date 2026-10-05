import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Hint, RunHintsView } from '../../shared/api';
import { api } from '../api';
import { runPath } from '../lib/runs';

export type HintCount = { kind: Hint['kind']; count: number };

const cache = new Map<string, HintCount[]>();
const pending = new Set<string>();
const waiting: { experimentId: string; runId: string }[] = [];
const listeners = new Set<() => void>();
let version = 0, active = 0;
const MAX_CONCURRENT = 3;

function emit() { version += 1; listeners.forEach(listener => listener()); }

export function summarize(hints: readonly Pick<Hint, 'kind'>[]): HintCount[] {
  const counts = new Map<Hint['kind'], number>();
  for (const hint of hints) counts.set(hint.kind, (counts.get(hint.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    const { experimentId, runId } = waiting.shift()!;
    active += 1;
    api<RunHintsView>(`${runPath(experimentId, runId)}/hints`)
      .then(view => cache.set(runId, summarize(view.hints)))
      // A run without a readable trace simply has no hint badges.
      .catch(() => cache.set(runId, []))
      .finally(() => { active -= 1; pending.delete(runId); emit(); pump(); });
  }
}

/** Loads hint counts lazily for finished runs, three requests at a time; results are kept for the session. */
export function requestHintSummary(experimentId: string, runId: string) {
  if (cache.has(runId) || pending.has(runId)) return;
  pending.add(runId); waiting.push({ experimentId, runId }); pump();
}

/** Seeds the cache from a hints view the page already has, so the open run costs no extra request. */
export function rememberHintSummary(runId: string, hints: readonly Pick<Hint, 'kind'>[]) {
  cache.set(runId, summarize(hints)); emit();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useHintSummaries() {
  const current = useSyncExternalStore(subscribe, () => version);
  // A new function per version lets memoised consumers notice newly loaded summaries.
  return useMemo(() => (runId: string) => cache.get(runId), [current]);
}

/** Requests summaries for the given runs while mounted. */
export function useRequestHintSummaries(runs: readonly { experimentId: string; runId: string }[]) {
  const key = runs.map(run => run.runId).join(',');
  useEffect(() => { for (const run of runs) requestHintSummary(run.experimentId, run.runId); }, [key]);
}
