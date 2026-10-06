import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { List } from 'lucide-react';
import type { Connection } from '@rawstep/project/config';
import type { DiscoveredModel } from '@rawstep/project/discover';
import { api } from '../api';
import { describeApiError, type ErrorView } from '../lib/errors';
import { providerTextKey } from '../lib/connections';
import { cn } from '../lib/utils';
import { Choice, Field } from './forms';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';

const VISIBLE_LIMIT = 100;

type Props = {
  label: string;
  connections: readonly Connection[];
  connectionId: string | undefined; modelId: string;
  /** A model picked from the list also brings what it takes, when the provider says so. */
  onChange: (next: { connectionId: string; modelId: string; picked?: DiscoveredModel }) => void;
  /** The option that means "no model", e.g. rule-based analysis only. */
  none?: string;
  onNone?: () => void;
};

/**
 * A model on a connection: the connection, then the model ID, typed or picked from the connection's list. The list is read only when
 * a person asks for it (it calls the provider), never on its own.
 */
export function ModelPicker({ label, connections, connectionId, modelId, onChange, none, onNone }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [models, setModels] = useState<{ connectionId: string; list: DiscoveredModel[] }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState<ErrorView>();
  const [filter, setFilter] = useState('');
  const connection = connections.find(c => c.id === connectionId);
  const NONE = '__none__';
  async function load() {
    if (!connection) return;
    setLoading(true); setError(undefined);
    try { setModels({ connectionId: connection.id, list: await api<DiscoveredModel[]>('/connections/models', { method: 'POST', body: { connectionId: connection.id } }) }); setFilter(''); }
    catch (e) { setError(describeApiError(e)); }
    finally { setLoading(false); }
  }
  const list = models && models.connectionId === connectionId ? models.list : undefined;
  const lower = filter.trim().toLowerCase();
  const matches = list?.filter(m => !lower || m.name.toLowerCase().includes(lower) || m.modelId.toLowerCase().includes(lower)) ?? [];
  const shown = matches.slice(0, VISIBLE_LIMIT);
  const name = (c: Connection) => `${c.name} · ${t(`connections.kinds.${c.kind}.name`)}`;
  return <fieldset className="grid gap-3">
    <legend className="mb-3 text-sm font-semibold">{label}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <Choice label={t('modelPicker.connection')} value={connection?.id ?? (none ? NONE : '')}
        onChange={next => { if (next === NONE) onNone?.(); else onChange({ connectionId: next, modelId: next === connectionId ? modelId : '' }); setModels(undefined); setError(undefined); }}
        options={[...(none ? [{ id: NONE, name: none }] : []), ...connections.map(c => ({ id: c.id, name: name(c) }))]} />
      {connection && <Field label={t('modelPicker.modelId')} value={modelId} onChange={next => onChange({ connectionId: connection.id, modelId: next })} placeholder={t('modelPicker.modelIdPlaceholder')} />}
    </div>
    {connection && <>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()} aria-controls={id + '-list'}><List aria-hidden="true" />{loading ? t('modelPicker.loading') : list ? t('modelPicker.reload') : t('modelPicker.load')}</Button>
        <p className="text-xs leading-5 text-muted-foreground">{t('modelPicker.loadNote', { provider: t(`connections.providers.${providerTextKey(connection.kind, connection.provider)}.name`) })}</p>
      </div>
      {error && <ErrorState alert view={error} />}
      {list && (list.length === 0
        ? <p className="border-y border-edge py-2.5 pl-3 text-sm text-muted-foreground">{t('modelPicker.empty')}</p>
        : <div id={id + '-list'} className="grid gap-2">
          <Field label={t('modelPicker.filter')} value={filter} onChange={setFilter} placeholder={t('modelPicker.filterPlaceholder')} hint={t('modelPicker.summary', { total: list.length, shown: shown.length })} />
          <div role="group" aria-label={t('modelPicker.listLabel')} className="grid max-h-64 divide-y divide-edge overflow-y-auto border-y border-edge-strong">
            {shown.map(m => <button key={m.modelId} type="button" aria-pressed={m.modelId === modelId} data-selected={m.modelId === modelId}
              onClick={() => onChange({ connectionId: connection.id, modelId: m.modelId, picked: m })}
              className={cn('row-rail rail-divider grid min-w-0 gap-0.5 py-2.5 pr-4 pl-5 text-left', m.modelId === modelId ? 'bg-trace-soft' : 'hover:bg-raised')}>
              <span className="font-medium break-all">{m.name}</span>
              <span className="font-mono text-xs break-all text-muted-foreground">{m.modelId}</span>
            </button>)}
            {!shown.length && <p className="py-2.5 pl-3 text-sm text-muted-foreground">{t('modelPicker.noMatch')}</p>}
          </div>
        </div>)}
    </>}
  </fieldset>;
}
