import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

/**
 * The top of a comparison: what changed beyond the spread between repeats, in a few sentences built from the counts, and the note
 * that only what changed is listed, never which side is better.
 */
export function CompareSummary({ lines, className }: { lines: readonly string[]; className?: string }) {
  const { t } = useTranslation();
  return <div className={cn('grid gap-1', className)}>
    <p className="max-w-3xl text-md leading-6">{lines.join(' ')}</p>
    <p className="text-sm text-ink-2">{t('batchSummary.compare.note')}</p>
  </div>;
}
