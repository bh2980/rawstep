import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

/** A labelled text input; `multiline` is a code-style textarea unless `plain` asks for ordinary text. */
export function Field({ label, value, onChange, multiline, plain, type, hint, placeholder }: { label: string; value: string; onChange: (s: string) => void; multiline?: boolean; plain?: boolean; type?: string; hint?: string; placeholder?: string }) {
  const id = useId();
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{multiline ? <Textarea id={id} aria-describedby={hint ? id + '-hint' : undefined} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={plain ? 3 : 5} className={plain ? 'leading-6' : 'font-mono text-xs leading-6'} /> : <Input id={id} aria-describedby={hint ? id + '-hint' : undefined} value={value} placeholder={placeholder} type={type ?? 'text'} onChange={e => onChange(e.target.value)} />}{hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}</div>;
}
export function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (s: string) => void; options: { id: string; name: string }[] }) {
  const id = useId();
  const { t } = useTranslation();
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="w-full"><SelectValue placeholder={t('forms.placeholder')} /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>;
}
export function MultiChoice({ label, items, selected, onChange }: { label: string; items: { id: string; name: string }[]; selected: string[]; onChange: (s: string[]) => void }) {
  const id = useId();
  const { t } = useTranslation();
  return <fieldset className="grid content-start gap-3"><legend className="mb-3 text-sm font-medium">{label}</legend>{items.length ? items.map((o, i) => <div key={o.id} className="flex items-center gap-2"><Checkbox id={id + i} checked={selected.includes(o.id)} onCheckedChange={v => onChange(v ? [...selected, o.id] : selected.filter(x => x !== o.id))} /><Label htmlFor={id + i} className="font-normal leading-5">{o.name}</Label></div>) : <p className="text-xs text-muted-foreground">{t('forms.noItems')}</p>}</fieldset>;
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
/** A section that opens and closes: a title with a short description on a rule, and its content when open. Sections are divided by rules, not boxed. */
export function Panel({ title, description, children, defaultOpen }: { title: string; description?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen === true);
  return <Collapsible open={open} onOpenChange={setOpen} className="border-t border-edge-strong">
    <CollapsibleTrigger asChild>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm py-2.5 text-left">
        <span className="min-w-0"><span className="text-sm font-semibold">{title}</span>{description && <span className="ml-2 text-xs text-muted-foreground">{description}</span>}</span>
        <ChevronDown aria-hidden="true" className={'size-4 shrink-0 transition-transform' + (open ? ' rotate-180' : '')} />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="motion-reveal grid gap-5 pt-1 pb-5">{children}</CollapsibleContent>
  </Collapsible>;
}

/**
 * A password field with a show/hide eye button, the usual way to enter an API key. When a key is already saved and
 * nothing is typed, the field shows dots; the eye then asks `onReveal` for the saved key so it can be read or edited.
 */
export function SecretField({ label, value, onChange, hint, saved, onReveal }: { label: string; value: string; onChange: (s: string) => void; hint?: string; saved?: boolean; onReveal?: () => Promise<string | undefined> }) {
  const { t } = useTranslation();
  const id = useId(), [shown, setShown] = useState(false), [loading, setLoading] = useState(false);
  async function toggle() {
    if (shown) { setShown(false); return; }
    if (!value && saved && onReveal) {
      setLoading(true);
      try { const stored = await onReveal(); if (stored !== undefined) onChange(stored); } finally { setLoading(false); }
    }
    setShown(true);
  }
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>
    <div className="relative">
      <Input id={id} type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} onChange={e => onChange(e.target.value)}
        placeholder={saved && !value ? '••••••••••••••••' : undefined} aria-describedby={hint ? id + '-hint' : undefined} className="pr-11 font-mono" />
      <Button type="button" variant="ghost" size="icon-sm" disabled={loading} aria-pressed={shown} aria-label={shown ? t('forms.secretHide') : t('forms.secretShow')}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground" onClick={() => void toggle()}>
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
    {hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
  </div>;
}

/** A value shown in field layout that cannot be edited here (for example a provider's fixed endpoint). */
export function ReadonlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId();
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} readOnly aria-describedby={hint ? id + '-hint' : undefined} className="bg-raised font-mono text-muted-foreground" />
    {hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
  </div>;
}
