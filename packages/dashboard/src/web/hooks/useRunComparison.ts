import { useEffect, useRef, useState } from 'react';
import type { RunComparison } from '../../shared/api';
import { api } from '../api';
import { useLiveBus } from './useLiveEvents';

type State = { data?: RunComparison; error: string; loading: boolean };

/**
 * How each of these runs ended and what it cost, side by side. Refetched, debounced, when the server reports a change (a run
 * finished). `key` identifies the set of runs, so a new array of the same runs does not fetch again.
 */
export function useRunComparison(runs: readonly { experiment: string; run: string }[]): State {
  const bus = useLiveBus();
  const [state, setState] = useState<State>({ error: '', loading: runs.length > 0 });
  const sequence = useRef(0);
  const key = runs.map(ref => `${ref.experiment}:${ref.run}`).join(',');
  useEffect(() => {
    if (!key) { setState({ error: '', loading: false }); return; }
    const body = { runs: key.split(',').map(item => { const [experiment, run] = item.split(':'); return { experiment: experiment!, run: run! }; }) };
    setState(previous => ({ ...previous, error: '', loading: true }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const ticket = ++sequence.current;
      api<RunComparison>('/runs/compare', { method: 'POST', body })
        .then(data => { if (ticket === sequence.current) setState({ data, error: '', loading: false }); })
        .catch(error => { if (ticket === sequence.current) setState(previous => ({ ...previous, error: (error as Error).message, loading: false })); });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    load();
    const off = bus.onChanged(schedule);
    return () => { sequence.current += 1; clearTimeout(timer); off(); };
  }, [key, bus.onChanged]);
  return state;
}
