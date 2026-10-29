import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { runRulesSchema, type RunRules } from '@rawstep/project/config';
import { t } from '../../i18n';
import { cn } from '../../lib/utils';
import { InfoTip } from '../layout/InfoTip';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Button } from '../ui/button';

type Props = {
  value: Partial<RunRules>; onChange: (v: Partial<RunRules>) => void; inherited: RunRules; compact?: boolean;
};
type Key = keyof RunRules;
type Group = { id: 'guard' | 'model' | 'planning'; keys: Key[] };
const GROUPS: Group[] = [
  { id: 'guard', keys: ['repetitionGuard', 'maxStateVisits', 'maxUnchangedTransitions', 'confirmationGrace'] },
  { id: 'model', keys: ['modelGiveUp'] },
  { id: 'planning', keys: ['survey', 'taskControl', 'maxReplans', 'stepActionLimit', 'failureLimit', 'noChangeLimit', 'plannerHistoryLimit', 'confidenceFloor'] },
];
const GUARD = ['auto', 'on', 'off'] as const;
const TASK_CONTROL = ['rawstep', 'executor'] as const;
const SURVEY = ['none', 'headings'] as const;

/** A run rule's value as words: the choice's label, 켬/끔, or the number. */
export function ruleValueLabel(key: Key, v: RunRules[Key]): string {
  return key === 'repetitionGuard' ? t(`conditions.runRules.guard.${v as RunRules['repetitionGuard']}`)
    : key === 'taskControl' ? t(`conditions.runRules.taskControl.${v as RunRules['taskControl']}`)
    : key === 'survey' ? t(`conditions.runRules.survey.${v as RunRules['survey']}`)
    : key === 'modelGiveUp' ? t(v ? 'conditions.runRules.on' : 'conditions.runRules.off') : String(v);
}

/** Whether one field's value is allowed, by the schema's own bounds. */
const fieldValid = (key: Key, value: unknown) => runRulesSchema.partial().safeParse({ [key]: value }).success;

/**
 * When a run stops early and when a planned run asks for a new plan, each field's name right next to its value. A field changed from
 * Rawstep's default is tinted and says the default beside it; 되돌리기 puts the default back.
 */
export function RunRulesEditor({ value, onChange, inherited, compact }: Props) {
  const { t } = useTranslation();
  const set = <K extends Key>(key: K, next: RunRules[K] | undefined) => {
    const { [key]: _old, ...rest } = value;
    onChange(next === undefined ? rest : { ...rest, [key]: next });
  };
  const shown = (key: Key) => ruleValueLabel(key, inherited[key]);
  return <div className={cn('grid min-w-0 max-w-2xl', compact ? 'gap-5' : 'gap-8')}>
    {GROUPS.map(group => <section key={group.id} aria-labelledby={`rules-${group.id}`} className="grid gap-0.5">
      <h3 id={`rules-${group.id}`} className="pb-1 text-[13px] font-semibold text-muted-foreground">{t(`conditions.runRules.groups.${group.id}.title`)}</h3>
      {group.keys.map(key => <Row key={key} field={key} value={value} inherited={inherited} set={set} compact={compact} inheritedValue={shown(key)} />)}
    </section>)}
  </div>;
}

type RowProps = {
  field: Key; value: Partial<RunRules>; inherited: RunRules; compact?: boolean | undefined; inheritedValue: string;
  set: <K extends Key>(key: K, next: RunRules[K] | undefined) => void;
};

function Row({ field, value, inherited, set, compact, inheritedValue }: RowProps) {
  const { t } = useTranslation();
  const id = useId(), overridden = value[field] !== undefined, current = value[field] ?? inherited[field];
  const invalid = overridden && !fieldValid(field, value[field]);
  const control = field === 'repetitionGuard'
    ? <Select value={current as string} onValueChange={next => set('repetitionGuard', next as RunRules['repetitionGuard'])}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{GUARD.map(g => <SelectItem key={g} value={g}>{t(`conditions.runRules.guard.${g}`)}</SelectItem>)}</SelectContent>
    </Select>
    : field === 'taskControl'
    ? <Select value={current as string} onValueChange={next => set('taskControl', next as RunRules['taskControl'])}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{TASK_CONTROL.map(c => <SelectItem key={c} value={c}>{t(`conditions.runRules.taskControl.${c}`)}</SelectItem>)}</SelectContent>
    </Select>
    : field === 'survey'
    ? <Select value={current as string} onValueChange={next => set('survey', next as RunRules['survey'])}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{SURVEY.map(c => <SelectItem key={c} value={c}>{t(`conditions.runRules.survey.${c}`)}</SelectItem>)}</SelectContent>
    </Select>
    : field === 'modelGiveUp'
      ? <Switch id={id} checked={current as boolean} onCheckedChange={on => set('modelGiveUp', on)} />
      : <Input id={id} type="number" inputMode={field === 'confidenceFloor' ? 'decimal' : 'numeric'} step={field === 'confidenceFloor' ? 0.05 : 1} className="w-24" value={String(current)} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-range` : undefined}
        onChange={e => set(field, e.target.value.trim() === '' ? undefined : Number(e.target.value) as never)} />;
  const label = t(`conditions.runRules.fields.${field}.label`);
  return <div className={cn('grid items-center gap-x-4 gap-y-1 rounded-md px-2 sm:grid-cols-[minmax(0,1fr)_16rem]', compact ? 'py-1.5' : 'py-2', overridden && 'bg-trace-soft')}>
    <div className="flex min-w-0 items-center gap-1">
      <label htmlFor={id} className={cn('text-sm', overridden && 'font-medium')}>{label}</label>
      <InfoTip term={label}>{t(`conditions.runRules.fields.${field}.hint`)}</InfoTip>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {control}
      {overridden && <span className="flex items-center gap-0.5 text-xs text-trace">{t('conditions.runRules.baseValue', { value: inheritedValue })}
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => set(field, undefined)} aria-label={t('conditions.runRules.resetAria', { field: label })}>
          <RotateCcw aria-hidden="true" />{t('conditions.runRules.reset')}
        </Button>
      </span>}
    </div>
    {invalid && <p id={`${id}-range`} className="text-xs leading-5 text-missed sm:col-span-2">{t(`conditions.runRules.fields.${field}.range`)}</p>}
  </div>;
}

/** Whether a set of overrides can be saved: every field within its bounds. */
export function runRulesValid(value: Partial<RunRules>): boolean {
  return runRulesSchema.partial().safeParse(value).success;
}
