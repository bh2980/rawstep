import { cn } from '../../lib/utils';

/** Reached runs out of finished runs as a 2px line under the number; the numbers are always written next to it. */
export function ReachLine({ reached, total, className }: { reached: number; total: number; className?: string }) {
  return <span aria-hidden="true" className={cn('block h-[3px] w-14 bg-edge', className)}>
    <span className="block h-full bg-reach" style={{ width: total ? `${Math.round(reached / total * 100)}%` : '0%' }} />
  </span>;
}
