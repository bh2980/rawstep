import { Search } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/** One line of filters above a table (spec §14, §31): no filter cards, no second row until the screen is too narrow for one. */
export function FilterBar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="search" aria-label={label} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>{children}</div>;
}

export function FilterSearch({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  const id = useId();
  return <div className={cn('relative w-full sm:w-64', className)}>
    <Label htmlFor={id} className="sr-only">{label}</Label>
    <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input id={id} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="h-8 pl-8 text-[13px]" />
  </div>;
}

export function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string }[]; className?: string }) {
  const id = useId();
  return <div className="flex items-center gap-1.5">
    <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className={cn('h-8 min-w-24 text-[13px]', className)}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

/** A short list of exclusive filters as one joined control; the chosen one is pressed. */
export function FilterSegments({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string }[] }) {
  return <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-edge-strong text-[13px]">
    {options.map(option => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}
      className={cn('h-8 border-r border-edge-strong px-3 last:border-r-0', value === option.id ? 'bg-trace-soft font-medium text-trace' : 'bg-surface text-muted-foreground hover:bg-raised')}>{option.name}</button>)}
  </div>;
}
