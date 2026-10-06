import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { runRulesSchema, type RunRules } from '@rawstep/project/config';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';

type Props = {
  value: Partial<RunRules>; onChange: (v: Partial<RunRules>) => void; inherited: RunRules; compact?: boolean;
  /** Where the inherited values come from, e.g. "프로젝트 기본값"; Rawstep's defaults when not given. */
  inheritedLabel?: string;
};
type Key = keyof RunRules;
type Group = { id: 'guard' | 'model' | 'planning'; keys: Key[] };
const GROUPS: Group[] = [
  { id: 'guard', keys: ['repetitionGuard', 'maxStateVisits', 'maxUnchangedTransitions'] },
  { id: 'model', keys: ['modelGiveUp'] },
  { id: 'planning', keys: ['maxReplans', 'stepActionLimit', 'failureLimit', 'noChangeLimit'] },
];
const GUARD = ['auto', 'on', 'off'] as const;

/** Whether one field's value is allowed, by the schema's own bounds. */
const fieldValid = (key: Key, value: unknown) => runRulesSchema.partial().safeParse({ [key]: value }).success;

/**
 * When a run stops early and when a planned run asks for a new plan. Each field shows the value it inherits; changing it overrides only
 * that field here, and 되돌리기 removes the override again.
 */
export function RunRulesEditor({ value, onChange, inherited, compact, inheritedLabel }: Props) {
  const { t } = useTranslation();
  const from = inheritedLabel ?? t('conditions.runRules.rawstepDefault');
  const set = <K extends Key>(key: K, next: RunRules[K] | undefined) => {
    const { [key]: _old, ...rest } = value;
    onChange(next === undefined ? rest : { ...rest, [key]: next });
  };
  const display = (key: Key, v: RunRules[Key]) => key === 'repetitionGuard' ? t(`conditions.runRules.guard.${v as RunRules['repetitionGuard']}`) : key === 'modelGiveUp' ? t(v ? 'conditions.runRules.on' : 'conditions.runRules.off') : String(v);
  const shown = (key: Key) => display(key, inherited[key]);
  return <div className={cn('grid min-w-0', compact ? 'gap-4' : 'gap-6')}>
    {GROUPS.map(group => <section key={group.id} aria-labelledby={`rules-${group.id}`} className="grid gap-1">
      <div className="grid gap-0.5 border-b border-edge-strong pb-1.5">
        <h4 id={`rules-${group.id}`} className="text-sm font-semibold">{t(`conditions.runRules.groups.${group.id}.title`)}</h4>
        {!compact && <p className="text-[13px] leading-5 text-muted-foreground">{t(`conditions.runRules.groups.${group.id}.intro`)}</p>}
      </div>
      {group.keys.map(key => <Row key={key} field={key} value={value} inherited={inherited} set={set} compact={compact}
        from={from} inheritedValue={shown(key)} />)}
    </section>)}
  </div>;
}

type RowProps = {
  field: Key; value: Partial<RunRules>; inherited: RunRules; compact?: boolean | undefined; from: string; inheritedValue: string;
  set: <K extends Key>(key: K, next: RunRules[K] | undefined) => void;
};

function Row({ field, value, inherited, set, compact, from, inheritedValue }: RowProps) {
  const { t } = useTranslation();
  const id = useId(), overridden = value[field] !== undefined, current = value[field] ?? inherited[field];
  const invalid = overridden && !fieldValid(field, value[field]);
  const control = field === 'repetitionGuard'
    ? <Select value={current as string} onValueChange={next => set('repetitionGuard', next as RunRules['repetitionGuard'])}>
      <SelectTrigger id={id} className="w-full sm:w-64"><SelectValue /></SelectTrigger>
      <SelectContent>{GUARD.map(g => <SelectItem key={g} value={g}>{t(`conditions.runRules.guard.${g}`)}</SelectItem>)}</SelectContent>
    </Select>
    : field === 'modelGiveUp'
      ? <Switch id={id} checked={current as boolean} onCheckedChange={on => set('modelGiveUp', on)} />
      : <Input id={id} type="number" inputMode="numeric" className="w-28" value={String(current)} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
        onChange={e => set(field, e.target.value.trim() === '' ? undefined : Number(e.target.value) as never)} />;
  return <div className={cn('grid gap-x-6 gap-y-1.5 border-b border-edge sm:grid-cols-[minmax(0,1fr)_auto]', compact ? 'py-2' : 'py-3')}>
    <div className="grid content-start gap-0.5">
      <label htmlFor={id} className="text-sm font-medium">{t(`conditions.runRules.fields.${field}.label`)}</label>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{t(`conditions.runRules.fields.${field}.hint`)}</p>
      {invalid && <p className="text-xs leading-5 text-missed">{t(`conditions.runRules.fields.${field}.range`)}</p>}
    </div>
    <div className="grid content-start justify-items-start gap-1 sm:justify-items-end">
      {control}
      {overridden
        ? <span className="flex items-center gap-1 text-xs text-trace">{t('conditions.runRules.overridden', { from, value: inheritedValue })}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => set(field, undefined)} aria-label={t('conditions.runRules.resetAria', { field: t(`conditions.runRules.fields.${field}.label`) })}>
            <RotateCcw aria-hidden="true" />{t('conditions.runRules.reset')}
          </Button>
        </span>
        : <span className="text-xs text-muted-foreground">{t('conditions.runRules.inherited', { from })}</span>}
    </div>
  </div>;
}

/** Whether a set of overrides can be saved: every field within its bounds. */
export function runRulesValid(value: Partial<RunRules>): boolean {
  return runRulesSchema.partial().safeParse(value).success;
}
