import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

type Props = { error: string; notice: string; busy: boolean; onReload: () => void };

/** Save conflicts and request errors; shown in the main area and inside dialogs and sheets. */
export function StatusBanner({ error, notice, busy, onReload }: Props) {
  const { t } = useTranslation();
  return <>
    {error && <Alert variant="destructive" role="alert">
      <AlertTitle>{t('app.errorTitle')}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReload}><RefreshCw aria-hidden="true" />{t('app.reload')}</Button>
      </AlertDescription>
    </Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
  </>;
}
