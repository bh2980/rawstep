import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { agentOf, type Connection } from '@rawstep/project/config';
import type { DiscoveredModel } from '@rawstep/project/discover';
import { api } from '../api';
import { describeApiError, type ErrorView } from '../lib/errors';
import { kindLabelKey } from '../lib/connections';
import { cn } from '../lib/utils';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
  /** `reasoningEffort` is absent when unset. */
  onChange: (next: { connectionId: string; modelId: string; reasoningEffort?: string | undefined }) => void;
  /** The option that means "no model", e.g. rule-based analysis only. */
  none?: string;
  onNone?: () => void;
  /** The group's own heading already names this picker: the label then stays for screen readers only. */
  hideLabel?: boolean;
  /** The connection is chosen elsewhere (a radio row): only the model and its effort are shown. */
  hideConnection?: boolean;
};

/**
 * A model on a connection, on one line: the connection, then one searchable field for the model (an editable combobox with list
 * autocomplete), then the reasoning effort when the connection offers levels.
 * The connection's model list is read as soon as a connection is chosen. That asks the provider for its list, which costs nothing, and
 * for a coding-agent CLI connection starts the CLI without prompting it. Whatever is typed is the model ID, listed or not.
 */
export function ModelPicker({ label, connections, connectionId, modelId, reasoningEffort, onChange, none, onNone, hideLabel, hideConnection }: Props) {
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
    onChange({ connectionId: connection.id, modelId: m.modelId, ...effortOf({ reasoningEffort }) });
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
  return <fieldset className="grid min-w-0 gap-2">
    <legend className={hideLabel ? 'sr-only' : 'mb-2 font-medium text-ink-2'}>{label}</legend>
    {/* One line of controls, each named for screen readers; the row they sit in already says what they are for. */}
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      {!hideConnection && <Select value={connection?.id ?? (none ? NONE : '')}
        onValueChange={next => { if (next === NONE) onNone?.(); else onChange(next === connectionId ? { connectionId: next, modelId, ...effortOf({ reasoningEffort }) } : { connectionId: next, modelId: '' }); setOpen(false); }}>
        <SelectTrigger aria-label={t('modelPicker.connection')} className="w-56 max-w-full"><SelectValue placeholder={t('forms.placeholder')} /></SelectTrigger>
        <SelectContent>
          {none && <SelectItem value={NONE}>{none}</SelectItem>}
          {connections.map(c => <SelectItem key={c.id} value={c.id}>{name(c)}</SelectItem>)}
        </SelectContent>
      </Select>}
      {connection && <div className="grid w-72 max-w-full gap-1">
        <Label htmlFor={id} className="sr-only">{t('modelPicker.modelId')}</Label>
        <div ref={box} className="relative"
          onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); setTyped(false); setActive(-1); } }}>
          <Input id={id} role="combobox" aria-expanded={popup} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
            aria-activedescendant={popup && active >= 0 ? optionId(active) : undefined}
            autoComplete="off" spellCheck={false} value={modelId} placeholder={placeholder} className="pr-9"
            onChange={e => { onChange({ connectionId: connection.id, modelId: e.target.value, ...effortOf({ reasoningEffort }) }); setTyped(true); setOpen(true); }}
            onClick={() => setOpen(true)} onKeyDown={onKeyDown} />
          <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-0.5 -translate-y-1/2 text-ink-2" disabled={loading} aria-label={t('modelPicker.reload')} title={t('modelPicker.reload')} onClick={() => load(true)}>
            <RefreshCw aria-hidden="true" className={cn(loading && 'animate-spin')} />
          </Button>
          {popup && <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-edge-strong bg-popover text-popover-foreground shadow-md">
            <div ref={listRef} id={listId} role="listbox" aria-label={t('modelPicker.modelId')} aria-busy={loading} className="max-h-64 overflow-y-auto p-1">
              {shown.map((m, i) => <div key={m.modelId} id={optionId(i)} role="option" aria-selected={m.modelId === modelId} data-active={i === active}
                onMouseDown={e => e.preventDefault()} onClick={() => pick(m)} onMouseMove={() => active !== i && setActive(i)}
                className={cn('grid min-w-0 cursor-pointer gap-0.5 rounded-sm px-2 py-1.5', m.modelId === modelId && 'font-medium', i === active ? 'bg-raised' : 'hover:bg-raised')}>
                <span className="break-all">{m.name}</span>
                <span className="font-mono text-sm break-all text-ink-2">{m.modelId}</span>
              </div>)}
            </div>
            {!shown.length && emptyText && <p className="px-3 py-2 text-ink-2" role="status">{emptyText}</p>}
            {loading && !!shown.length && <p className="border-t border-edge px-3 py-1.5 text-sm text-ink-2" role="status">{t('modelPicker.loadingList')}</p>}
            {matches.length > shown.length && <p className="border-t border-edge px-3 py-1.5 text-sm text-ink-2">{t('modelPicker.summary', { total: matches.length, shown: shown.length })}</p>}
          </div>}
        </div>
        {current && current.name !== current.modelId && <p className="text-sm text-ink-2">{t('modelPicker.selectedName', { name: current.name })}</p>}
      </div>}
      {connection && levels && <Select value={reasoningEffort ?? DEFAULT_EFFORT}
        onValueChange={next => onChange({ connectionId: connection.id, modelId, ...(next === DEFAULT_EFFORT ? {} : { reasoningEffort: next }) })}>
        <SelectTrigger aria-label={t('modelPicker.effort')} title={t('modelPicker.effortHint')} className="w-44 max-w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{effortOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
      </Select>}
    </div>
    {error && <ErrorState alert view={error} actions={<Button type="button" variant="outline" size="sm" onClick={() => load(true)}><RefreshCw aria-hidden="true" />{t('modelPicker.reload')}</Button>} />}
  </fieldset>;
}
