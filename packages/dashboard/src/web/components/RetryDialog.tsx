import type { RetryPreview } from '../../shared/config';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { preview: RetryPreview | undefined; busy: boolean; onConfirm: () => void; onClose: () => void };

/** Confirms re-running with the original model, prompt, permissions and run profile. */
export function RetryDialog({ preview, busy, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const changed = preview?.changedFields ?? [];
  return <Dialog open={!!preview} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t('run.retryTitle')}</DialogTitle>
        <DialogDescription>{t('run.retryBody')}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{changed.length ? t('run.retryChanged', { fields: changed.join(', ') }) : t('run.retryUnchanged')}</p>
      {preview && changed.length > 0 && <details>
        <summary className="cursor-pointer text-sm">{t('run.retryDiff')}</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify({ [t('run.retryOriginal')]: preview.original, [t('run.retryCurrent')]: preview.current }, null, 2)}
        </pre>
      </details>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t('run.close')}</Button>
        <Button disabled={busy} onClick={onConfirm}>{t('run.retryConfirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
