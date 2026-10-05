import type { RetryPreview } from '../../shared/config';
import { ko } from '../i18n/ko';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { preview: RetryPreview | undefined; busy: boolean; onConfirm: () => void; onClose: () => void };

/** Confirms re-running with the original model, prompt, permissions and environment. */
export function RetryDialog({ preview, busy, onConfirm, onClose }: Props) {
  const changed = preview?.changedFields ?? [];
  return <Dialog open={!!preview} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{ko.run.retryTitle}</DialogTitle>
        <DialogDescription>{ko.run.retryBody}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{changed.length ? ko.run.retryChanged(changed.join(', ')) : ko.run.retryUnchanged}</p>
      {preview && changed.length > 0 && <details>
        <summary className="cursor-pointer text-sm">{ko.run.retryDiff}</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify({ [ko.run.retryOriginal]: preview.original, [ko.run.retryCurrent]: preview.current }, null, 2)}
        </pre>
      </details>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{ko.run.close}</Button>
        <Button disabled={busy} onClick={onConfirm}>{ko.run.retryConfirm}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
