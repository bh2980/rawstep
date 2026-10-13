import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { InfoTip } from './InfoTip';

type Props = {
  title: ReactNode;
  /** Facts about what the page holds (a count, an address), never an explanation: that goes in `info`. */
  meta?: ReactNode;
  /** An explanation of the page, behind an ⓘ beside the title. */
  info?: ReactNode;
  /** A breadcrumb or back link above the title. */
  crumb?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** The top of a page: one title, optional facts under it, the page's own actions on the right. */
export function PageHeader({ title, meta, info, crumb, actions, className }: Props) {
  return <header className={cn('grid gap-1', className)}>
    {crumb}
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="grid min-w-0 gap-1">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight break-words">{title}{info && typeof title === 'string' && <InfoTip term={title}>{info}</InfoTip>}</h1>
        {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </header>;
}

/** A section of a page: a heading on a rule, then its content. Sections are separated by this rule, not by boxes. */
export function SectionHead({ id, title, aside, info, className }: { id?: string; title: ReactNode; aside?: ReactNode; info?: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-between gap-3 border-b border-edge-strong pb-1.5', className)}>
    <h2 id={id} className="flex items-center gap-1.5 text-base font-semibold">{title}{info && typeof title === 'string' && <InfoTip term={title}>{info}</InfoTip>}</h2>
    {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
  </div>;
}
