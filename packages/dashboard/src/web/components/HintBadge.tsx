import { hintKindLabel } from '../i18n/labels';

/** A hint kind as plain text, with how often it happened in the quiet colour. Not a chip: the label is the mark. */
export function HintBadge({ kind, count }: { kind: string; count?: number }) {
  return <span className="inline-flex max-w-full items-baseline gap-1 text-ink-2">
    <span className="truncate">{hintKindLabel(kind)}</span>
    {count !== undefined && count > 0 && <span className="tabular-nums text-ink-3">{count}</span>}
  </span>;
}
