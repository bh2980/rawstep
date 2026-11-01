import { cn } from '../lib/utils';

/**
 * A task's tags as small chips in a list. They are text, not controls: filtering is done with the tag filter, so a row of tasks
 * does not fill with buttons. `limit` shows that many and says how many more there are.
 */
export function TagList({ tags, limit, more, className }: { tags: readonly string[]; limit?: number; more?: (hidden: number) => string; className?: string }) {
  const shown = limit === undefined ? tags : tags.slice(0, limit), hidden = tags.length - shown.length;
  return <ul className={cn('flex flex-wrap items-center gap-1', className)}>
    {shown.map(tag => <li key={tag} className="max-w-32 truncate rounded-sm border border-edge-strong bg-raised px-1.5 text-xs leading-5">{tag}</li>)}
    {hidden > 0 && more && <li className="text-xs text-muted-foreground">{more(hidden)}</li>}
  </ul>;
}
