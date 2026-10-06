import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export type Source = 'page' | 'model';

/** ■ solid: observed on the page. ○ open: something the model did while deciding. Decoration only; use `SourceLabel` for the words. */
export function SourceMarker({ source, className }: { source: Source; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2.5 shrink-0', source === 'page' ? 'bg-foreground' : 'rounded-full border-[1.5px] border-model', className)} />;
}

/** The marker with its source written out, so the source never depends on the shape or colour alone. */
export function SourceLabel({ source, className }: { source: Source; className?: string }) {
  const { t } = useTranslation();
  return <span className={cn('inline-flex items-center gap-1.5 text-[11px] leading-4 font-medium tracking-[0.08em] uppercase', source === 'page' ? 'text-foreground' : 'text-model', className)}>
    <SourceMarker source={source} />{source === 'page' ? t('trace.sourcePage') : t('trace.sourceModel')}
  </span>;
}
