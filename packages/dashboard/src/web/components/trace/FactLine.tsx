import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * One line of facts, not a row of KPI cards. It is a list, so a screen reader announces each fact on its own. `ruled` draws the
 * line between two 1px rules with wide gaps (the task overview's FactLine); otherwise the facts are joined by middle dots that are
 * drawn by CSS and not read (`목표 도달 2 / 3 · 보통 행동 12번`). Empty items are left out.
 */
export function FactLine({ items, label, ruled, className }: { items: ReactNode[]; label?: string; ruled?: boolean; className?: string }) {
  const facts = items.filter(item => item !== null && item !== undefined && item !== false && item !== '');
  if (facts.length === 0) return null;
  return <ul aria-label={label} className={cn(ruled
    ? 'flex min-h-10 flex-wrap items-center gap-x-6 gap-y-1 border-y border-edge py-2 tabular-nums'
    : 'flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums [&>li+li]:before:mr-2 [&>li+li]:before:text-muted-foreground [&>li+li]:before:content-["·"]', className)}>
    {facts.map((fact, index) => <li key={index} className={ruled ? 'flex items-center gap-1.5 whitespace-nowrap' : undefined}>{fact}</li>)}
  </ul>;
}

/** A fact of a ruled FactLine: its name in the secondary colour, then the value. */
export function Fact({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return <>{label !== undefined && <span className="text-ink-2">{label}</span>}<span>{children}</span></>;
}
