import { useEffect, useRef, useState } from 'react';
import type { TaskFindings } from '../../shared/api';
import { api } from '../api';
import { useLiveBus } from './useLiveEvents';

type State = { data?: TaskFindings; error: string; loading: boolean };

/**
 * Facts and recurring findings of one batch of a task (the newest when `batch` is not given). Refetched, debounced, when the server
 * reports a change (a run finished). Nothing is fetched while `enabled` is false.
 */
export function useTaskFindings(taskId: string, batch?: string, enabled = true): State {
  const bus = useLiveBus();
  const [state, setState] = useState<State>({ error: '', loading: enabled });
  const sequence = useRef(0);
  useEffect(() => {
    if (!enabled) { setState({ error: '', loading: false }); return; }
    setState({ error: '', loading: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const ticket = ++sequence.current;
      api<TaskFindings>(`/tasks/${encodeURIComponent(taskId)}/findings${batch ? `?batch=${encodeURIComponent(batch)}` : ''}`)
        .then(data => { if (ticket === sequence.current) setState({ data, error: '', loading: false }); })
        .catch(error => { if (ticket === sequence.current) setState(previous => ({ ...previous, error: (error as Error).message, loading: false })); });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    load();
    const off = bus.onChanged(schedule);
    return () => { sequence.current += 1; clearTimeout(timer); off(); };
  }, [taskId, batch, enabled, bus.onChanged]);
  return state;
}
