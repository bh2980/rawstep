import { RefreshCw } from 'lucide-react';
import { ko } from '../i18n/ko';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

type Props = { error: string; notice: string; busy: boolean; onReload: () => void };

/** Save conflicts and request errors; shown in the main area and inside dialogs and sheets. */
export function StatusBanner({ error, notice, busy, onReload }: Props) {
  return <>
    {error && <Alert variant="destructive" role="alert">
      <AlertTitle>{ko.app.errorTitle}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReload}><RefreshCw aria-hidden="true" />{ko.app.reload}</Button>
      </AlertDescription>
    </Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
  </>;
}
