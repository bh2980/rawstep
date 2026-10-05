import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function Field({ label, value, onChange, multiline, type, hint, placeholder }: { label: string; value: string; onChange: (s: string) => void; multiline?: boolean; type?: string; hint?: string; placeholder?: string }) {
  const id = useId();
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{multiline ? <Textarea id={id} aria-describedby={hint ? id + '-hint' : undefined} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={5} className="font-mono text-xs leading-6" /> : <Input id={id} aria-describedby={hint ? id + '-hint' : undefined} value={value} placeholder={placeholder} type={type ?? 'text'} onChange={e => onChange(e.target.value)} />}{hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}</div>;
}
export function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (s: string) => void; options: { id: string; name: string }[] }) {
  const id = useId();
  const { t } = useTranslation();
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="w-full"><SelectValue placeholder={t('forms.placeholder')} /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>;
}
export function MultiChoice({ label, items, selected, onChange }: { label: string; items: { id: string; name: string }[]; selected: string[]; onChange: (s: string[]) => void }) {
  const id = useId();
  const { t } = useTranslation();
  return <fieldset className="grid gap-3"><legend className="mb-3 text-sm font-medium">{label}</legend>{items.length ? items.map((o, i) => <div key={o.id} className="flex items-center gap-2"><Checkbox id={id + i} checked={selected.includes(o.id)} onCheckedChange={v => onChange(v ? [...selected, o.id] : selected.filter(x => x !== o.id))} /><Label htmlFor={id + i} className="font-normal leading-5">{o.name}</Label></div>) : <p className="text-xs text-muted-foreground">{t('forms.noItems')}</p>}</fieldset>;
}
export function SectionHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></div>;
}
/** A titled block inside the advanced settings; sections are separated by a rule. */
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="grid gap-4 border-t pt-6"><div className="grid gap-1"><h3 className="font-medium">{title}</h3>{description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}</div>{children}</section>;
}
/** Switch with a label and a one-line plain explanation. */
export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <div className="grid gap-1"><div className="flex items-center gap-3"><Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-describedby={hint ? id + '-hint' : undefined} /><Label htmlFor={id}>{label}</Label></div>{hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}</div>;
}
/** A collapsed "advanced" block inside one tab or card for the rarely changed settings of that area. */
export function Advanced({ children, description }: { children: ReactNode; description?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen} className="grid gap-4 border-t pt-4">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="justify-self-start px-2"><ChevronDown aria-hidden="true" className={'transition-transform' + (open ? ' rotate-180' : '')} />{t('forms.advanced')}</Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="grid gap-5">{description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}{children}</CollapsibleContent>
  </Collapsible>;
}
