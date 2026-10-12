import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { agentOf, type Connection } from '@rawstep/project/config';
import type { DiscoveredModel } from '@rawstep/project/discover';
import { api } from '../api';
import { describeApiError, type ErrorView } from '../lib/errors';
import { kindLabelKey } from '../lib/connections';
import { cn } from '../lib/utils';
import { Choice } from './forms';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const VISIBLE_LIMIT = 100;
const DEFAULT_EFFORT = '__default__';

/** The reasoning effort of a picker change as a config fragment: present only when set, since configs do not take `undefined`. */
export const effortOf = (next: { reasoningEffort?: string | undefined }) => next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {};

/** One request per connection, shared by every picker on the screen. A failed or reloaded entry is dropped so the next ask goes out again. */
const cache = new Map<string, Promise<DiscoveredModel[]>>();
function listModels(connectionId: string, fresh?: boolean) {
  if (fresh) cache.delete(connectionId);
  let p = cache.get(connectionId);
  if (!p) {
    p = api<DiscoveredModel[]>('/connections/models', { method: 'POST', body: { connectionId } });
    cache.set(connectionId, p);
    p.catch(() => { if (cache.get(connectionId) === p) cache.delete(connectionId); });
  }
  return p;
}

type Props = {
  label: string;
  connections: readonly Connection[];
  connectionId: string | undefined; modelId: string;
  /** The level the agent thinks at; unset is the agent's own default. */
  reasoningEffort?: string | undefined;
  /** A model picked from the list also brings what it takes, when the provider says so. `reasoningEffort` is absent when unset. */
  onChange: (next: { connectionId: string; modelId: string; reasoningEffort?: string | undefined; picked?: DiscoveredModel }) => void;
  /** The option that means "no model", e.g. rule-based analysis only. */
  none?: string;
  onNone?: () => void;
};

/**
 * A model on a connection: the connection, then one searchable field for the model (an editable combobox with list autocomplete).
 * The connection's model list is read as soon as a connection is chosen. That asks the provider for its list, which costs nothing, and
 * for a coding-agent CLI connection starts the CLI without prompting it. Whatever is typed is the model ID, listed or not.
 */
export function ModelPicker({ label, connections, connectionId, modelId, reasoningEffort, onChange, none, onNone }: Props) {
  const { t } = useTranslation();
  const id = useId(), listId = id + '-list';
  const connection = connections.find(c => c.id === connectionId);
  const cid = connection?.id;
  const [loaded, setLoaded] = useState<{ connectionId: string; list: DiscoveredModel[] }>();
  const [failed, setFailed] = useState<{ connectionId: string; view: ErrorView }>();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false), [typed, setTyped] = useState(false), [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null), listRef = useRef<HTMLDivElement>(null);
  const NONE = '__none__';

  function load(fresh?: boolean) {
    if (!cid) return () => {};
    let live = true;
    setLoading(true); setFailed(undefined);
    listModels(cid, fresh).then(
      list => { if (live) { setLoaded({ connectionId: cid, list }); setLoading(false); } },
      e => { if (live) { setFailed({ connectionId: cid, view: describeApiError(e) }); setLoading(false); } });
    return () => { live = false; };
  }
  useEffect(() => load(), [cid]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = loaded && loaded.connectionId === cid ? loaded.list : undefined;
  const error = failed && failed.connectionId === cid ? failed.view : undefined;
  const query = typed ? modelId.trim().toLowerCase() : '';
  const matches = useMemo(() => list?.filter(m => !query || m.name.toLowerCase().includes(query) || m.modelId.toLowerCase().includes(query)) ?? [], [list, query]);
  const shown = matches.slice(0, VISIBLE_LIMIT);
  const current = list?.find(m => m.modelId === modelId);
  const levels = list?.find(m => m.efforts?.length);
  const efforts = levels?.efforts ?? [];
  const effortOptions = [
    { id: DEFAULT_EFFORT, name: levels?.defaultEffort ? t('modelPicker.effortDefaultWith', { effort: levels.defaultEffort }) : t('modelPicker.effortDefault') },
    ...efforts.map(e => ({ id: e, name: e })),
    ...(reasoningEffort && !efforts.includes(reasoningEffort) ? [{ id: reasoningEffort, name: `${reasoningEffort} ${t('modelPicker.effortUnoffered')}` }] : []),
  ];
  const optionId = (i: number) => `${id}-opt-${i}`;
  const popup = open && !!connection;

  useEffect(() => { setActive(-1); }, [query, cid]);
  useEffect(() => { if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' }); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(m: DiscoveredModel) {
    if (!connection) return;
    onChange({ connectionId: connection.id, modelId: m.modelId, ...effortOf({ reasoningEffort }), picked: m });
    setOpen(false); setTyped(false); setActive(-1);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (!open) { setOpen(true); setActive(step === 1 ? 0 : shown.length - 1); return; }
      setActive(a => (a + step + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      const m = popup ? shown[active] : undefined;
      if (m) { e.preventDefault(); pick(m); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); }
    }
  }
  const emptyText = loading ? t('modelPicker.loadingList') : error ? undefined : list ? (list.length ? t('modelPicker.noMatch') : t('modelPicker.empty')) : undefined;
  const placeholder = t(connection && agentOf(connection) ? 'modelPicker.modelIdPlaceholderAgent' : 'modelPicker.modelIdPlaceholder');
  const name = (c: Connection) => `${c.name} · ${t(`connections.kinds.${kindLabelKey(c)}.name`)}`;
  return <fieldset className="grid gap-3">
    <legend className="mb-3 text-sm font-semibold">{label}</legend>
    {/* Top-aligned so a hint under one field does not stretch the others. */}
    <div className={cn('grid items-start gap-3 sm:grid-cols-2 [&>*]:min-w-0', connection && levels && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,11rem)]')}>
      <Choice label={t('modelPicker.connection')} value={connection?.id ?? (none ? NONE : '')}
        onChange={next => { if (next === NONE) onNone?.(); else onChange(next === connectionId ? { connectionId: next, modelId, ...effortOf({ reasoningEffort }) } : { connectionId: next, modelId: '' }); setOpen(false); }}
        options={[...(none ? [{ id: NONE, name: none }] : []), ...connections.map(c => ({ id: c.id, name: name(c) }))]} />
      {connection && <div className="grid gap-2">
        <Label htmlFor={id}>{t('modelPicker.modelId')}</Label>
        <div ref={box} className="relative"
          onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); setTyped(false); setActive(-1); } }}>
          <Input id={id} role="combobox" aria-expanded={popup} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
            aria-activedescendant={popup && active >= 0 ? optionId(active) : undefined}
            autoComplete="off" spellCheck={false} value={modelId} placeholder={placeholder} className="pr-9"
            onChange={e => { onChange({ connectionId: connection.id, modelId: e.target.value, ...effortOf({ reasoningEffort }) }); setTyped(true); setOpen(true); }}
            onClick={() => setOpen(true)} onKeyDown={onKeyDown} />
          <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground" disabled={loading} aria-label={t('modelPicker.reload')} title={t('modelPicker.reload')} onClick={() => load(true)}>
            <RefreshCw aria-hidden="true" className={cn(loading && 'animate-spin')} />
          </Button>
          {popup && <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-edge-strong bg-popover text-popover-foreground shadow-md">
            <div ref={listRef} id={listId} role="listbox" aria-label={t('modelPicker.modelId')} aria-busy={loading} className="max-h-64 overflow-y-auto p-1">
              {shown.map((m, i) => <div key={m.modelId} id={optionId(i)} role="option" aria-selected={m.modelId === modelId} data-active={i === active}
                onMouseDown={e => e.preventDefault()} onClick={() => pick(m)} onMouseMove={() => active !== i && setActive(i)}
                className={cn('grid min-w-0 cursor-pointer gap-0.5 rounded-md px-2 py-1.5 text-sm', m.modelId === modelId && 'bg-trace-soft', i === active ? 'bg-raised' : 'hover:bg-raised')}>
                <span className="font-medium break-all">{m.name}</span>
                <span className="font-mono text-xs break-all text-muted-foreground">{m.modelId}</span>
              </div>)}
            </div>
            {!shown.length && emptyText && <p className="px-3 py-2 text-sm text-muted-foreground" role="status">{emptyText}</p>}
            {loading && !!shown.length && <p className="border-t border-edge px-3 py-1.5 text-xs text-muted-foreground" role="status">{t('modelPicker.loadingList')}</p>}
            {matches.length > shown.length && <p className="border-t border-edge px-3 py-1.5 text-xs text-muted-foreground">{t('modelPicker.summary', { total: matches.length, shown: shown.length })}</p>}
          </div>}
        </div>
        {current && current.name !== current.modelId && <p className="text-xs leading-5 text-muted-foreground">{t('modelPicker.selectedName', { name: current.name })}</p>}
      </div>}
      {connection && levels && <div className="grid gap-1.5">
        <Choice label={t('modelPicker.effort')} value={reasoningEffort ?? DEFAULT_EFFORT}
          onChange={next => onChange({ connectionId: connection.id, modelId, ...(next === DEFAULT_EFFORT ? {} : { reasoningEffort: next }) })} options={effortOptions} />
      </div>}
    </div>
    {connection && levels && <p className="text-xs leading-5 text-muted-foreground">{t('modelPicker.effortHint')}</p>}
    {error && <ErrorState alert view={error} actions={<Button type="button" variant="outline" size="sm" onClick={() => load(true)}><RefreshCw aria-hidden="true" />{t('modelPicker.reload')}</Button>} />}
  </fieldset>;
}
