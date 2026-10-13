import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/**
 * An explanation a person asks for: a small ⓘ button beside a term that opens a short note on click (a toggletip). It replaces
 * always-visible help text and dismissible banners — the page carries facts, the explanation waits until someone wants it.
 * `term` names the button for a screen reader ("모델 조합 설명").
 */
export function InfoTip({ term, children, className, side = 'bottom' }: { term: string; children: ReactNode; className?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const { t } = useTranslation();
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={t('infoTip.label', { term })}
        className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}>
        <Info aria-hidden="true" className="size-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent side={side} align="start" className="w-72 text-[13px] leading-5 font-normal text-foreground">
      <p className="mb-1 font-semibold">{term}</p>
      <div className="grid gap-1.5 text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>;
}
