import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * One compact line of facts separated by middle dots (`목표 도달 2 / 3 · 보통 행동 12번`), not a row of KPI cards.
 * It is a list, so a screen reader announces each fact on its own; the dots are drawn by CSS and not read.
 */
export function FactLine({ items, label, className }: { items: ReactNode[]; label?: string; className?: string }) {
  const facts = items.filter(item => item !== null && item !== undefined && item !== false && item !== '');
  if (facts.length === 0) return null;
  return <ul aria-label={label} className={cn('flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums [&>li+li]:before:mr-2 [&>li+li]:before:text-muted-foreground [&>li+li]:before:content-["·"]', className)}>
    {facts.map((fact, index) => <li key={index}>{fact}</li>)}
  </ul>;
}
