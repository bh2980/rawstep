import { useEffect, useRef, useState } from 'react';
import type { BatchSummary } from '@rawstep/reports/compare';
import { api, ApiError } from '../api';
import { useLiveBus } from './useLiveEvents';

/** `waiting` is a batch with runs still going: its summary is written when the last one ends. `missing` is a batch that does not exist (any more). */
type State = { data?: BatchSummary; error: string; waiting: boolean; missing: boolean; loading: boolean };

/**
 * A batch summed up per task and run profile. Refetched, debounced, when the server reports a change (a run ended). Nothing is fetched
 * while `batch` is undefined.
 */
export function useBatchSummary(batch: string | undefined): State {
  const bus = useLiveBus();
  const [state, setState] = useState<State>({ error: '', waiting: false, missing: false, loading: !!batch });
  const sequence = useRef(0);
  useEffect(() => {
    if (!batch) { setState({ error: '', waiting: false, missing: false, loading: false }); return; }
    setState({ error: '', waiting: false, missing: false, loading: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const ticket = ++sequence.current;
      api<BatchSummary>(`/experiments/${encodeURIComponent(batch)}/summary`)
        .then(data => { if (ticket === sequence.current) setState({ data, error: '', waiting: false, missing: false, loading: false }); })
        .catch((error: unknown) => {
          if (ticket !== sequence.current) return;
          const code = error instanceof ApiError ? error.code : undefined;
          setState(previous => ({ ...previous, error: code === 'summary-not-ready' || code === 'experiment-not-found' ? '' : (error as Error).message,
            waiting: code === 'summary-not-ready', missing: code === 'experiment-not-found', loading: false, ...(code === 'summary-not-ready' || code === 'experiment-not-found' ? { data: undefined } : {}) }));
        });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    load();
    const off = bus.onChanged(schedule);
    return () => { sequence.current += 1; clearTimeout(timer); off(); };
  }, [batch, bus.onChanged]);
  return state;
}
