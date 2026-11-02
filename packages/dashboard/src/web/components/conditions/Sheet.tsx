import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../../lib/utils';

/** A list of settings: one row per setting, rows separated by 1px rules, no boxes. */
export function Sheet({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <div role={label ? 'group' : undefined} aria-label={label} className={cn('border-t border-edge', className)}>{children}</div>;
}

type RowProps = {
  label: ReactNode;
  /** The control the label names; without it the label is a plain text that `labelId` lets a group point at. */
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  className?: string;
};

/** One setting: its name in a 200px column (ink-2), its value beside it. On a narrow screen the name sits above. */
export function SheetRow({ label, htmlFor, labelId, children, className }: RowProps) {
  return <div className={cn('grid items-start gap-x-6 gap-y-1 border-b border-edge py-3 md:grid-cols-[200px_minmax(0,1fr)]', className)}>
    {htmlFor
      ? <label htmlFor={htmlFor} id={labelId} className="font-medium text-ink-2 md:leading-8">{label}</label>
      : <div id={labelId} className="font-medium text-ink-2 md:leading-8">{label}</div>}
    <div className="min-w-0">{children}</div>
  </div>;
}

export type RadioChoice<T extends string> = {
  id: T;
  label: ReactNode;
  /** One line on what the choice means, after the name in ink-2. */
  hint?: ReactNode;
  disabled?: boolean;
};

type ListProps<T extends string> = {
  /** The id of the text naming the group (usually a SheetRow's `labelId`). */
  labelledBy: string;
  value: T;
  onChange: (value: T) => void;
  rows: RadioChoice<T>[];
  /** Shown under the list, for example the fields the chosen row needs. */
  children?: ReactNode;
  /** Hints go under the names and wrap, for a narrow place such as a dialog. */
  stacked?: boolean;
};

/** Native radios as 32px rows: radio · name · one-line hint. The whole row is the target. */
export function RadioList<T extends string>({ labelledBy, value, onChange, rows, children, stacked }: ListProps<T>) {
  const name = useId();
  const hinted = rows.some(row => row.hint) && !stacked;
  return <div role="radiogroup" aria-labelledby={labelledBy} className="grid">
    {rows.map(row => <label key={row.id}
      className={cn('grid min-h-8 cursor-pointer items-center gap-x-3 has-disabled:cursor-not-allowed has-disabled:opacity-60',
        hinted ? 'grid-cols-[14px_minmax(0,1fr)] md:grid-cols-[14px_120px_minmax(0,1fr)]' : 'grid-cols-[14px_minmax(0,1fr)]')}>
      <input type="radio" name={name} value={row.id} checked={row.id === value} disabled={row.disabled} onChange={() => onChange(row.id)} className="size-3.5 accent-foreground" />
      <span className={cn(row.id === value && 'font-medium')}>{row.label}</span>
      {stacked && row.hint && <span className="col-start-2 pb-1.5 text-sm text-ink-2">{row.hint}</span>}
      {hinted && <span title={typeof row.hint === 'string' ? row.hint : undefined} className="col-start-2 truncate pb-1 text-ink-2 md:col-start-3 md:pb-0">{row.hint}</span>}
    </label>)}
    {children}
  </div>;
}

/** A quiet "더 보기" line that opens what is rarely changed. */
export function Fold({ label, children, defaultOpen, className }: { label: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen === true);
  return <Collapsible open={open} onOpenChange={setOpen} className={cn('grid gap-2', className)}>
    <CollapsibleTrigger className="inline-flex h-7 items-center gap-1 justify-self-start rounded-sm text-ink-2 hover:text-foreground">
      <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', open && 'rotate-180')} />{label}
    </CollapsibleTrigger>
    <CollapsibleContent className="grid gap-3 pt-1">{children}</CollapsibleContent>
  </Collapsible>;
}
