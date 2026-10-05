import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { experimentId: string; runId: string; eventId: string; step: number; className?: string };

/** Lazy thumbnail; clicking opens the full-size screenshot in a dialog. */
export function ScreenshotThumb({ experimentId, runId, eventId, step, className }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = screenshotUrl(experimentId, runId, eventId);
  if (failed) return <div className={cn('grid place-content-center gap-1 rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground', className)}>
    <ImageOff className="mx-auto size-4" aria-hidden="true" />{t('steps.screenshotMissing')}
  </div>;
  return <>
    <button type="button" aria-label={t('steps.screenshotOpen', { n: step })} onClick={() => setOpen(true)}
      className={cn('block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}>
      <img src={src} alt={t('steps.screenshot', { n: step })} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('steps.screenshotDialog')}</DialogTitle>
          <DialogDescription>{t('steps.stepNumber', { n: step })}</DialogDescription>
        </DialogHeader>
        <img src={src} alt={t('steps.screenshot', { n: step })} className="w-full rounded-md border" />
      </DialogContent>
    </Dialog>
  </>;
}
