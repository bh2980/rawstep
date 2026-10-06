import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigView, Experiment } from '../../shared/config';
import type { TaskSummary } from '../../shared/api';
import { api } from '../api';
import { useLiveBus } from './useLiveEvents';

/** Project state, experiments and the per-task summaries. Refetched on the SSE `changed` event; there is no polling. */
export function useDashboardData() {
  const bus = useLiveBus();
  const [view, setView] = useState<ConfigView>();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [summaries, setSummaries] = useState<TaskSummary[]>([]);
  const [summaryError, setSummaryError] = useState('');
  const [loadError, setLoadError] = useState('');
  const disposed = useRef(false);
  const refresh = useCallback(async () => {
    const [state, history] = await Promise.all([api<ConfigView>('/state'), api<Experiment[]>('/experiments')]);
    if (disposed.current) return;
    setView(state); setExperiments(history); setLoadError('');
    api<TaskSummary[]>('/tasks-summary')
      .then(rows => { if (!disposed.current) { setSummaries(rows); setSummaryError(''); } })
      .catch(error => { if (!disposed.current) setSummaryError((error as Error).message); });
  }, []);
  useEffect(() => {
    disposed.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void refresh().catch(error => { if (!disposed.current) setLoadError((error as Error).message); });
    const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 150); };
    load();
    const off = bus.onChanged(schedule);
    return () => { disposed.current = true; clearTimeout(timer); off(); };
  }, [refresh, bus.onChanged]);
  return { view, setView, experiments, summaries, summaryError, loadError, refresh, connected: bus.connected };
}
