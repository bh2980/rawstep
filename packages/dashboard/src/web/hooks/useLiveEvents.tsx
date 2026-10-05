import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RunEventMessage } from '../../shared/api';

type Listener<T> = (value: T) => void;
type Bus = {
  connected: boolean;
  onChanged: (listener: Listener<void>) => () => void;
  onRunEvent: (listener: Listener<RunEventMessage>) => () => void;
};

const noop = () => () => undefined;
const LiveContext = createContext<Bus>({ connected: false, onChanged: noop, onRunEvent: noop });

/** One EventSource for the whole dashboard; `changed` and `run-event` fan out to subscribers. */
export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const changed = useRef(new Set<Listener<void>>());
  const runEvents = useRef(new Set<Listener<RunEventMessage>>());
  useEffect(() => {
    const source = new EventSource('/api/events');
    const notifyChanged = () => changed.current.forEach(listener => listener());
    source.onopen = () => { setConnected(true); notifyChanged(); };
    source.onerror = () => setConnected(false);
    source.addEventListener('changed', notifyChanged);
    source.addEventListener('run-event', event => {
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as RunEventMessage;
        runEvents.current.forEach(listener => listener(message));
      } catch { /* a malformed message is not worth interrupting the page */ }
    });
    return () => source.close();
  }, []);
  const bus = useMemo<Bus>(() => ({
    connected,
    onChanged: listener => { changed.current.add(listener); return () => { changed.current.delete(listener); }; },
    onRunEvent: listener => { runEvents.current.add(listener); return () => { runEvents.current.delete(listener); }; },
  }), [connected]);
  return <LiveContext.Provider value={bus}>{children}</LiveContext.Provider>;
}

export const useLiveBus = () => useContext(LiveContext);

/** Calls `refetch` once, shortly after the last `changed` or matching `run-event` message. */
export function useRunRefresh(experimentId: string, runId: string, refetch: () => void, delayMs = 300) {
  const bus = useLiveBus();
  const latest = useRef(refetch);
  useEffect(() => { latest.current = refetch; });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => latest.current(), delayMs); };
    const offChanged = bus.onChanged(schedule);
    const offRun = bus.onRunEvent(message => { if (message.experimentId === experimentId && message.runId === runId) schedule(); });
    return () => { clearTimeout(timer); offChanged(); offRun(); };
  }, [bus.onChanged, bus.onRunEvent, experimentId, runId, delayMs]);
}
