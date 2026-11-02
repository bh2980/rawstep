import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import { Link } from './Link';

export type Crumb = { label: string; to: RouteChange };

type Props = {
  title: ReactNode;
  /** The pages above this one, each a link. */
  crumbs?: Crumb[];
  navigate?: (change: RouteChange) => void;
  /** Facts about the page in one line, joined by middle dots. Empty items are left out. */
  meta?: ReactNode[];
  actions?: ReactNode;
  className?: string;
};

/** Breadcrumbs, the page's one title (20px), one meta line, and the page's actions on the right. */
export function PageHeader({ title, crumbs, navigate, meta, actions, className }: Props) {
  const { t } = useTranslation();
  const facts = (meta ?? []).filter(item => item !== null && item !== undefined && item !== false && item !== '');
  return <header className={cn('mb-4 flex items-start gap-4', className)}>
    <div className="min-w-0 flex-1">
      {crumbs && crumbs.length > 0 && navigate && <nav aria-label={t('pageHeader.crumbs')} className="mb-1">
        <ol className="flex items-center gap-1 text-sm text-ink-2">
          {crumbs.map((crumb, index) => <li key={index} className="flex min-w-0 items-center gap-1">
            <Link to={crumb.to} navigate={navigate} className="truncate hover:text-foreground">{crumb.label}</Link>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </li>)}
        </ol>
      </nav>}
      <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">{title}</h1>
      {facts.length > 0 && <MetaLine items={facts} className="mt-1" />}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}

/** Facts in one 13px line joined by middle dots that are drawn, not read (12px was misread by first-time readers). */
export function MetaLine({ items, className }: { items: ReactNode[]; className?: string }) {
  return <p className={cn('flex min-w-0 flex-wrap items-center text-base text-ink-2', className)}>
    {items.map((item, index) => <Fragment key={index}>
      {index > 0 && <span aria-hidden="true" className="px-1.5 text-ink-3">·</span>}
      <span className="min-w-0">{item}</span>
    </Fragment>)}
  </p>;
}

/** A section's title (14px) with its count in the quiet colour, and what belongs to it on the right. */
export function SectionHead({ title, count, children, id, className }: { title: ReactNode; count?: number | string; children?: ReactNode; id?: string; className?: string }) {
  return <div className={cn('mb-1 flex h-8 items-center gap-2', className)}>
    <h2 id={id} className="text-md font-semibold">{title}</h2>
    {count !== undefined && <span className="tabular-nums text-ink-3">{count}</span>}
    {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
  </div>;
}

/** The one way to show a missing value. */
export function Dash() {
  return <span className="text-ink-3">—</span>;
}
