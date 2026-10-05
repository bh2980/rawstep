import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunHintsView, RunStepsView } from '../../shared/api';
import { api } from '../api';
import { runPath } from '../lib/runs';
import { useRunRefresh } from './useLiveEvents';

type Loaded<T> = { data?: T; error: string; loading: boolean };

/** Fetches one run resource and refetches (debounced) on SSE messages for that run. */
function useRunResource<T>(experimentId: string, runId: string, resource: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ error: '', loading: true });
  const sequence = useRef(0);
  const load = useCallback(() => {
    const ticket = ++sequence.current;
    api<T>(`${runPath(experimentId, runId)}/${resource}`)
      .then(data => { if (ticket === sequence.current) setState({ data, error: '', loading: false }); })
      .catch(error => { if (ticket === sequence.current) setState(previous => ({ ...previous, error: (error as Error).message, loading: false })); });
  }, [experimentId, runId, resource]);
  useEffect(() => { setState({ error: '', loading: true }); load(); return () => { sequence.current += 1; }; }, [load]);
  useRunRefresh(experimentId, runId, load);
  return state;
}

export const useRunSteps = (experimentId: string, runId: string) => useRunResource<RunStepsView>(experimentId, runId, 'steps');
export const useRunHints = (experimentId: string, runId: string) => useRunResource<RunHintsView>(experimentId, runId, 'hints');
export const useRunEvents = (experimentId: string, runId: string) => useRunResource<RawEvent[]>(experimentId, runId, 'events');

export type RawEvent = { id: string; seq: number; type: string; timestamp: string; data: unknown; redacted: boolean };
