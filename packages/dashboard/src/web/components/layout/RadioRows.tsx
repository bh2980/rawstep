import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type RadioRow<T extends string> = {
  id: T;
  label: string;
  /** One line on when this choice fits. */
  hint?: string;
  /** Mono detail, for example the actions the choice allows. */
  detail?: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  rows: RadioRow<T>[];
  /** Content shown under the chosen row, such as the fields that choice needs. */
  expanded?: (id: T) => ReactNode;
  className?: string;
};

/**
 * A group of native radio buttons drawn as large rows in one ruled list (a row is at least 56px tall, the whole row is the target).
 * The chosen row has a full-height trace-blue rail (`.row-rail`) and a tint, so it never relies on colour alone: the radio itself is filled.
 * The list is square-cornered so nothing clips the rail.
 */
export function RadioRows<T extends string>({ legend, value, onChange, rows, expanded, className }: Props<T>) {
  const group = useId();
  return <fieldset className={cn('grid min-w-0', className)}>
    <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
    <div className="divide-y divide-edge border border-edge-strong bg-surface">
      {rows.map(row => {
        const chosen = row.id === value, extra = chosen ? expanded?.(row.id) : undefined;
        return <div key={row.id} data-selected={chosen} className={cn('row-rail rail-divider', chosen && 'bg-trace-soft')}>
          <label className={cn('flex min-h-14 cursor-pointer items-start gap-3 py-3 pr-4 pl-5 has-disabled:cursor-not-allowed has-disabled:opacity-60', !chosen && 'hover:bg-raised')}>
            <input type="radio" name={group} value={row.id} checked={chosen} disabled={row.disabled} onChange={() => onChange(row.id)} className="mt-1 size-4 shrink-0 accent-trace" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-[15px] leading-6 font-medium">{row.label}</span>
              {row.hint && <span className="text-[13px] leading-5 text-muted-foreground">{row.hint}</span>}
              {row.detail && <span className="font-mono text-xs leading-5 text-muted-foreground">{row.detail}</span>}
            </span>
          </label>
          {extra && <div className="pr-4 pb-4 pl-12">{extra}</div>}
        </div>;
      })}
    </div>
  </fieldset>;
}
