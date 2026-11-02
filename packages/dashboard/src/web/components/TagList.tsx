import { cn } from '../lib/utils';

/**
 * A task's tags as plain text joined by middle dots that are drawn, not read. They are text, not controls: filtering is done with the
 * tag filter. `limit` shows that many and says how many more there are.
 */
export function TagList({ tags, limit, more, className }: { tags: readonly string[]; limit?: number; more?: (hidden: number) => string; className?: string }) {
  const shown = limit === undefined ? tags : tags.slice(0, limit), hidden = tags.length - shown.length;
  return <ul className={cn('flex flex-wrap items-center gap-x-1.5 [&>li+li]:before:mr-1.5 [&>li+li]:before:text-ink-3 [&>li+li]:before:content-["·"]', className)}>
    {shown.map(tag => <li key={tag} className="max-w-40 truncate">{tag}</li>)}
    {hidden > 0 && more && <li className="text-ink-2">{more(hidden)}</li>}
  </ul>;
}
