import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

/** Fewer runs than this on a side, and a difference between the sides can easily be chance. */
export const ENOUGH_RUNS = 10;

/**
 * The top of a comparison: what changed, in a few sentences built from the counts (never which side is better), and an honest note
 * when there are few runs.
 */
export function CompareSummary({ lines, few, className }: { lines: readonly string[]; few: boolean; className?: string }) {
  const { t } = useTranslation();
  return <div className={cn('grid gap-1', className)}>
    <p className="max-w-3xl text-[15px] leading-6">{lines.join(' ')}</p>
    {few && <p className="text-xs text-muted-foreground">{t('compareSummary.fewRuns')}</p>}
  </div>;
}
