import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

/** Reached runs out of finished runs as a short bar; the numbers are always written next to it. */
export function ReachBar({ reached, total, className }: { reached: number; total: number; className?: string }) {
  return <span aria-hidden="true" className={cn('block h-1.5 w-14 overflow-hidden rounded-full bg-muted', className)}>
    <span className="block h-full rounded-full bg-positive" style={{ width: total ? `${Math.round(reached / total * 100)}%` : '0%' }} />
  </span>;
}

type Recent = { steps: number | null; reached: boolean }[];

/** One bar per recent run, as tall as its action count; green when the goal was reached, orange when not. */
export function RecentBars({ runs }: { runs: Recent }) {
  const { t } = useTranslation();
  const tallest = Math.max(1, ...runs.map(run => run.steps ?? 0));
  return <span role="img" aria-label={t('taskList.recentLabel', { count: runs.length, reached: runs.filter(run => run.reached).length })} className="flex h-6 items-end gap-0.5">
    {runs.map((run, i) => <span key={i} className={cn('block w-1.5 rounded-[2px]', run.reached ? 'bg-positive' : 'bg-warning')} style={{ height: Math.max(4, Math.round((run.steps ?? 0) / tallest * 24)) }} />)}
  </span>;
}
