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

/** What is missing and the one thing to do next, with no picture: a title, one line, the action. No box, no stripe. */
export function EmptyState({ title, why, action, compact, className }: Props) {
  return <section aria-label={title} className={cn('grid justify-items-start gap-1 border-y border-edge', compact ? 'py-2' : 'py-4', className)}>
    <h2 className="font-medium">{title}</h2>
    {why && <p className="max-w-2xl text-ink-2">{why}</p>}
    {action && <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div>}
  </section>;
}
