import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** How long the pointer may be away from the ⓘ and its note before a note opened by hovering closes. */
const LEAVE_MS = 150;

/**
 * An explanation a person asks for: a small ⓘ beside a term whose short note opens while the pointer rests on it, and stays open after
 * a click (a toggletip, so touch and keyboard users get it too). It replaces always-visible help text and dismissible banners — the
 * page carries facts, the explanation waits until someone wants it. `term` names the button for a screen reader ("모델 조합 설명").
 */
export function InfoTip({ term, children, className, side = 'bottom' }: { term: string; children: ReactNode; className?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const { t } = useTranslation();
  // 'hover' follows the pointer; 'pinned' was clicked and stays until clicked again, Escape, or a click elsewhere.
  const [open, setOpen] = useState<false | 'hover' | 'pinned'>(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const enter = () => { clearTimeout(leaving.current); setOpen(current => current || 'hover'); };
  const leave = () => { clearTimeout(leaving.current); leaving.current = setTimeout(() => setOpen(current => current === 'hover' ? false : current), LEAVE_MS); };
  return <Popover open={!!open} onOpenChange={next => setOpen(next ? 'pinned' : false)}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={t('infoTip.label', { term })} onPointerEnter={event => { if (event.pointerType === 'mouse') enter(); }} onPointerLeave={leave}
        onClick={event => { event.preventDefault(); setOpen(current => current === 'pinned' ? false : 'pinned'); }}
        className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}>
        <Info aria-hidden="true" className="size-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent side={side} align="start" onPointerEnter={enter} onPointerLeave={leave}
      onOpenAutoFocus={event => { if (open === 'hover') event.preventDefault(); }}
      className="w-72 text-[13px] leading-5 font-normal text-foreground">
      <p className="mb-1 font-semibold">{term}</p>
      <div className="grid gap-1.5 text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>;
}
