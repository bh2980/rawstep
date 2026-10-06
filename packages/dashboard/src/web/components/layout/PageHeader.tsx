import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Props = { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string };

/** The top of a page: one title, a line of what it holds, and the page's own actions on the right. A rule underneath, no panel around it. */
export function PageHeader({ title, description, actions, className }: Props) {
  return <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-edge-strong pb-3', className)}>
    <div className="min-w-0">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

/** A section of a page: a heading on a rule, then its content. Sections are separated by this rule, not by boxes. */
export function SectionHead({ id, title, aside, className }: { id?: string; title: ReactNode; aside?: ReactNode; className?: string }) {
  return <div className={cn('flex items-baseline justify-between gap-3 border-b border-edge-strong pb-1.5', className)}>
    <h2 id={id} className="text-base font-semibold">{title}</h2>
    {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
  </div>;
}
