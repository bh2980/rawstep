import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunRecord } from '../../shared/config';
import { currentLanguage } from '../i18n';
import { useRunEvents } from '../hooks/useRunData';
import { eventsByStep } from '../lib/rawEvents';

/** The trace events recorded for one step, as they were written, plus the settings the run used. Fetched only when this is open. */
export function RawRecord({ experimentId, run, step }: { experimentId: string; run: RunRecord; step: number }) {
  const { t } = useTranslation();
  const { data: events, error, loading } = useRunEvents(experimentId, run.id);
  const mine = useMemo(() => eventsByStep(events ?? []).get(step) ?? [], [events, step]);
  if (!events) return <p role={error ? 'alert' : 'status'} className="text-sm text-ink-2">{error ? `${t('events.loadFailed')} ${error}` : loading ? t('runPage.rawLoading') : ''}</p>;
  return <div className="grid gap-2">
    <p className="text-sm text-ink-2">{t('runPage.rawDescription', { count: mine.length })}</p>
    {mine.map(event => <details key={event.id} className="border-b border-edge py-1.5">
      <summary className="cursor-pointer text-sm tabular-nums">{event.seq} · {event.type} · {event.redacted ? t('events.redacted') : new Date(event.timestamp).toLocaleTimeString(currentLanguage())}</summary>
      <pre className="mt-2 max-h-72 overflow-auto text-xs leading-5">{JSON.stringify(event.data, null, 2)}</pre>
    </details>)}
    <details className="border-b border-edge py-1.5">
      <summary className="cursor-pointer text-sm">{t('events.settings')}</summary>
      <pre className="mt-2 max-h-72 overflow-auto text-xs leading-5">{JSON.stringify({ ...run.snapshot, analysisInstructions: run.analysisInstructions }, null, 2)}</pre>
    </details>
  </div>;
}
