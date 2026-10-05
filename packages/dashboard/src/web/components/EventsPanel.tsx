import { useState } from 'react';
import { screenshotUrl } from '../lib/runs';
import { ko } from '../i18n/ko';
import { useRunEvents } from '../hooks/useRunData';
import type { RunRecord } from '../../shared/config';
import { Button } from './ui/button';

const PAGE = 100;

/** Raw trace events. No polling: refetched when the server reports a new event for this run. */
export function EventsPanel({ experimentId, run }: { experimentId: string; run: RunRecord }) {
  const { data: events, error, loading } = useRunEvents(experimentId, run.id);
  const [limit, setLimit] = useState(PAGE);
  if (!events) return <p role={error ? 'alert' : 'status'} className="text-sm text-muted-foreground">{error ? `${ko.events.loadFailed} ${error}` : loading ? '…' : ''}</p>;
  const shown = events.slice(0, limit);
  return <div className="grid gap-4">
    <div>
      <h3 className="text-sm font-medium">{ko.events.title(events.length)}</h3>
      <p className="text-xs text-muted-foreground">{ko.events.description}</p>
    </div>
    <details>
      <summary className="cursor-pointer text-sm font-medium">{ko.events.settings}</summary>
      <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
        {JSON.stringify({ ...run.snapshot, promptSource: run.promptSource ?? 'client', analysisInstructions: run.analysisInstructions, permissions: run.permissions, permissionSource: run.permissionSource }, null, 2)}
      </pre>
    </details>
    {events.length === 0 && <p className="text-sm text-muted-foreground">{ko.events.empty}</p>}
    <div className="grid gap-2">
      {shown.map(event => <details key={event.id} className="rounded-md border p-3">
        <summary className="cursor-pointer text-xs">{event.seq} · {event.type} · {event.redacted ? ko.events.redacted : new Date(event.timestamp).toLocaleTimeString()}</summary>
        {event.type === 'keyboard.observation' && !event.redacted
          && <img className="my-3 w-full max-w-2xl rounded-md" loading="lazy" src={screenshotUrl(experimentId, run.id, event.id)} alt={ko.events.keyboardObservation(event.seq)} />}
        <pre className="mt-3 overflow-auto text-xs">{JSON.stringify(event.data, null, 2)}</pre>
      </details>)}
    </div>
    {events.length > limit && <Button variant="outline" className="justify-self-start" onClick={() => setLimit(limit + PAGE)}>{ko.events.showMore(Math.min(PAGE, events.length - limit))}</Button>}
  </div>;
}
