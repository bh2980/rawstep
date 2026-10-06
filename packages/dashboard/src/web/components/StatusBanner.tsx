import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../hooks/useRoute';
import type { ErrorView } from '../lib/errors';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';

type Props = { error: ErrorView | undefined; notice: string; busy: boolean; onReload: () => void; navigate: (change: RouteChange) => void };

/**
 * The newest failure of a request, told by its kind (spec §37), and the one-line notice of a finished change. Shown in the main area and
 * inside dialogs. Reloading starts the editors again from the file, so a lost connection, where nothing was edited away, does not offer it.
 */
export function StatusBanner({ error, notice, busy, onReload, navigate }: Props) {
  const { t } = useTranslation();
  return <>
    {error && <ErrorState alert view={error} navigate={navigate} actions={error.kind === 'connection' ? undefined
      : <Button size="sm" variant="outline" disabled={busy} onClick={onReload}><RefreshCw aria-hidden="true" />{t('app.reload')}</Button>} />}
    {notice && <p role="status" className="border-l-2 border-reach pl-3 text-sm">{notice}</p>}
  </>;
}
