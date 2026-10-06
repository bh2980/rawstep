import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageElement, PageElements } from '../../shared/api';
import { api } from '../api';
import { roleLabel } from '../i18n/labels';
import { describeApiError, type ErrorView } from '../lib/errors';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** The start page to open. */
  url: string;
  /** Only offer elements with one of these roles. */
  roles?: readonly string[] | undefined;
  onPick: (element: PageElement) => void;
};

type Loaded = { url: string; elements: PageElements } | { url: string; error: ErrorView };

/** A searchable list of the notable elements of the start page, read by the server in a headless browser. Picking one fills a role and a name. */
export function ElementPicker({ open, onOpenChange, url, roles, onPick }: Props) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState(false), [query, setQuery] = useState('');
  const ticket = useRef(0);
  const address = url.trim();
  const load = () => {
    const mine = ++ticket.current;
    setLoading(true);
    api<PageElements>('/page-elements', { method: 'POST', body: { url: address } })
      .then(elements => { if (mine === ticket.current) setLoaded({ url: address, elements }); })
      .catch(error => { if (mine === ticket.current) setLoaded({ url: address, error: describeApiError(error, 'start') }); })
      .finally(() => { if (mine === ticket.current) setLoading(false); });
  };
  // The page is read once per address; opening the list again shows the same elements.
  useEffect(() => {
    if (open && address && !(loaded && 'elements' in loaded && loaded.url === address)) load();
  }, [open, address]);
  const needle = query.trim().toLowerCase();
  const elements = loaded && 'elements' in loaded && loaded.url === address ? loaded.elements.elements : [];
  const shown = elements.filter(element => (!roles || roles.includes(element.role))
    && (!needle || `${element.role} ${roleLabel(element.role)} ${element.name ?? ''}`.toLowerCase().includes(needle)));
  const error = loaded && 'error' in loaded && loaded.url === address ? loaded.error : undefined;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t('elementPicker.title')}</DialogTitle>
        <DialogDescription>{t('elementPicker.description')}</DialogDescription>
      </DialogHeader>
      {!address
        ? <p role="status" className="text-sm text-muted-foreground">{t('elementPicker.needUrl')}</p>
        : <div className="grid gap-3">
          {loading && <p role="status" className="text-sm text-muted-foreground">{t('elementPicker.loading')}</p>}
          {error && <ErrorState alert view={error} actions={<Button variant="outline" size="sm" onClick={load}>{t('elementPicker.retry')}</Button>} />}
          {elements.length > 0 && <>
            <div className="grid gap-1.5">
              <Label htmlFor="element-search">{t('elementPicker.search')}</Label>
              <Input id="element-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('elementPicker.searchPlaceholder')} />
            </div>
            <p role="status" className="text-xs text-muted-foreground">{t('elementPicker.count', { shown: shown.length, total: elements.length })}</p>
            <ul aria-label={t('elementPicker.listLabel')} className="grid max-h-80 gap-0.5 overflow-y-auto border-y border-edge-strong py-1">
              {shown.map(element => <li key={element.role + '\n' + (element.name ?? '')}>
                <Button variant="ghost" className="h-auto min-h-9 w-full justify-start gap-3 py-1.5 text-left whitespace-normal" onClick={() => { onPick(element); onOpenChange(false); }}>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{roleLabel(element.role)}</span>
                  <span className="min-w-0 break-words">{element.name ?? <span className="text-muted-foreground">{t('elementPicker.unnamed')}</span>}</span>
                </Button>
              </li>)}
            </ul>
          </>}
          {!loading && !error && elements.length === 0 && loaded && <p className="text-sm text-muted-foreground">{t('elementPicker.empty')}</p>}
        </div>}
    </DialogContent>
  </Dialog>;
}
