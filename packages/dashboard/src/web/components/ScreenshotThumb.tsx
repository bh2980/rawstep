import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { ko } from '../i18n/ko';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { experimentId: string; runId: string; eventId: string; step: number; className?: string };

/** Lazy thumbnail; clicking opens the full-size screenshot in a dialog. */
export function ScreenshotThumb({ experimentId, runId, eventId, step, className }: Props) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = screenshotUrl(experimentId, runId, eventId);
  if (failed) return <div className={cn('grid place-content-center gap-1 rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground', className)}>
    <ImageOff className="mx-auto size-4" aria-hidden="true" />{ko.steps.screenshotMissing}
  </div>;
  return <>
    <button type="button" aria-label={ko.steps.screenshotOpen(step)} onClick={() => setOpen(true)}
      className={cn('block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}>
      <img src={src} alt={ko.steps.screenshot(step)} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{ko.steps.screenshotDialog}</DialogTitle>
          <DialogDescription>{ko.steps.stepNumber(step)}</DialogDescription>
        </DialogHeader>
        <img src={src} alt={ko.steps.screenshot(step)} className="w-full rounded-md border" />
      </DialogContent>
    </Dialog>
  </>;
}
