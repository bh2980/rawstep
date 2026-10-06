import { useEffect, useRef, useState } from 'react';
import type { TaskFindings } from '../../shared/api';
import { api } from '../api';
import { useLiveBus } from './useLiveEvents';

type State = { data?: TaskFindings; error: string; loading: boolean };

/** Facts and recurring findings of one task. Refetched, debounced, when the server reports a change (a run finished). */
export function useTaskFindings(taskId: string): State {
  const bus = useLiveBus();
  const [state, setState] = useState<State>({ error: '', loading: true });
  const sequence = useRef(0);
  useEffect(() => {
    setState({ error: '', loading: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const ticket = ++sequence.current;
      api<TaskFindings>(`/tasks/${encodeURIComponent(taskId)}/findings`)
        .then(data => { if (ticket === sequence.current) setState({ data, error: '', loading: false }); })
        .catch(error => { if (ticket === sequence.current) setState(previous => ({ ...previous, error: (error as Error).message, loading: false })); });
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    load();
    const off = bus.onChanged(schedule);
    return () => { sequence.current += 1; clearTimeout(timer); off(); };
  }, [taskId, bus.onChanged]);
  return state;
}
