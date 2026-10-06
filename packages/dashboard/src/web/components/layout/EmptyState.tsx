import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Props = {
  /** What is missing, as a statement. */
  title: string;
  /** Why it is needed. */
  why: string;
  /** The next action: a button or a link. */
  action?: ReactNode;
  /** Used inside a section where a page-sized block would be too much. */
  compact?: boolean;
  className?: string;
};

/**
 * Spec §36: three things and no picture. What is missing, why it is needed and what to do next.
 * It is drawn as a ruled note, not a panel.
 */
export function EmptyState({ title, why, action, compact, className }: Props) {
  return <section aria-label={title} className={cn('grid gap-1.5 border-l-2 border-edge-strong pl-4', compact ? 'py-0.5' : 'py-2', className)}>
    <h2 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>{title}</h2>
    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{why}</p>
    {action && <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div>}
  </section>;
}
