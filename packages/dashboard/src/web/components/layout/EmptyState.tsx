import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Props = {
  /** What is missing, as one statement. */
  title: string;
  /** Only where a person needs it to act: why it is needed. Most empty states leave it out. */
  why?: string;
  /** The next action: a button or a link. */
  action?: ReactNode;
  /** Used inside a section where a page-sized block would be too much. */
  compact?: boolean;
  className?: string;
};

/** Spec §36: what is missing and the one thing to do next, on a line, with no picture. It is drawn as a ruled note, not a panel. */
export function EmptyState({ title, why, action, compact, className }: Props) {
  return <section aria-label={title} className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 border-l-2 border-edge-strong pl-4', compact ? 'py-0.5' : 'py-2', className)}>
    <div className="grid min-w-0 gap-1">
      <h2 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>{title}</h2>
      {why && <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{why}</p>}
    </div>
    {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
  </section>;
}
