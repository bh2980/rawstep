import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runRulesSchema, type RunRules } from '@rawstep/project/config';
import { t } from '../../i18n';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

type Key = keyof RunRules;
/** Every rule, in the order a person reads them: when a run stops as stuck, then when a planned run asks for a new plan. */
export const RULE_KEYS: Key[] = ['repetitionGuard', 'maxUnchangedTransitions', 'confirmationGrace', 'survey', 'reviewEvery', 'stepActionLimit', 'failureLimit', 'noChangeLimit', 'plannerHistoryLimit', 'maxPlannerCalls'];
const SURVEY = ['none', 'headings'] as const;

/** A run rule's value as words: the choice's label, 켬/끔, or the number. */
export function ruleValueLabel(key: Key, v: RunRules[Key]): string {
  return key === 'survey' ? t(`conditions.runRules.survey.${v as RunRules['survey']}`)
    : key === 'repetitionGuard' ? t(v ? 'conditions.runRules.on' : 'conditions.runRules.off') : String(v);
}

/** Whether one field's value is allowed, by the schema's own bounds. */
const fieldValid = (key: Key, value: unknown) => runRulesSchema.partial().safeParse({ [key]: value }).success;

type Props = {
  /** The rules this profile changes; a field left out is the default in `inherited`. */
  value: Partial<RunRules>;
  onChange?: (v: Partial<RunRules>) => void;
  inherited: RunRules;
  /** Only the defaults, every rule, nothing to edit (설정 › 기본 실행 규칙). */
  readOnly?: boolean;
};

/**
 * When a run stops, as one table: 항목 · 이 프로필 · 기본값 · 되돌리기. Only the rules changed from the defaults are listed; the rest
 * open with "기본값 그대로인 n개 보기". A rule edited here stays listed until the page is left, so it does not vanish while typed back
 * to its default.
 */
export function RunRulesEditor({ value, onChange, inherited, readOnly }: Props) {
  const { t } = useTranslation();
  const captionId = useId();
  const [all, setAll] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<Key>>(new Set());
  const overridden = (key: Key) => value[key] !== undefined;
  const set = <K extends Key>(key: K, next: RunRules[K] | undefined) => {
    setTouched(current => new Set(current).add(key));
    const { [key]: _old, ...rest } = value;
    onChange?.(next === undefined ? rest : { ...rest, [key]: next });
  };
  const listed = RULE_KEYS.filter(key => readOnly || all || overridden(key) || touched.has(key));
  const rest = RULE_KEYS.length - RULE_KEYS.filter(key => overridden(key) || touched.has(key)).length;
  return <div className="grid min-w-0 justify-items-start gap-2">
    {listed.length > 0 && <Table className="table-fixed">
      <TableCaption id={captionId} className="sr-only">{t(readOnly ? 'rulesTable.captionDefaults' : 'rulesTable.caption')}</TableCaption>
      <colgroup><col /><col className={readOnly ? 'w-40' : 'w-36'} />{!readOnly && <><col className="w-20" /><col className="w-24" /></>}</colgroup>
      <TableHeader><TableRow>
        <TableHead scope="col">{t('rulesTable.item')}</TableHead>
        {!readOnly && <TableHead scope="col" className="text-right">{t('rulesTable.profile')}</TableHead>}
        <TableHead scope="col" className="text-right">{t('rulesTable.default')}</TableHead>
        {!readOnly && <TableHead scope="col"><span className="sr-only">{t('rulesTable.reset')}</span></TableHead>}
      </TableRow></TableHeader>
      <TableBody>{listed.map(key => readOnly
        ? <TableRow key={key}>
          <TableCell className="whitespace-normal"><span title={t(`conditions.runRules.fields.${key}.hint`)}>{t(`conditions.runRules.fields.${key}.label`)}</span></TableCell>
          <TableCell className="text-right tabular-nums">{ruleValueLabel(key, inherited[key])}</TableCell>
        </TableRow>
        : <RuleRow key={key} field={key} value={value} inherited={inherited} set={set} />)}</TableBody>
    </Table>}
    {!readOnly && (all
      ? <button type="button" className="text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground" onClick={() => setAll(false)}>{t('rulesTable.showChanged')}</button>
      : rest > 0 && <button type="button" className="text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground" onClick={() => setAll(true)}>
        {listed.length ? t('rulesTable.showDefaults', { count: rest }) : t('rulesTable.allDefaults', { count: rest })}
      </button>)}
  </div>;
}

type RowProps = { field: Key; value: Partial<RunRules>; inherited: RunRules; set: <K extends Key>(key: K, next: RunRules[K] | undefined) => void };

/** One rule: its name, this profile's value as a control, the default, and 되돌리기 while it differs. */
function RuleRow({ field, value, inherited, set }: RowProps) {
  const { t } = useTranslation();
  const id = useId(), overridden = value[field] !== undefined, current = value[field] ?? inherited[field];
  const invalid = overridden && !fieldValid(field, value[field]);
  const label = t(`conditions.runRules.fields.${field}.label`);
  const control = field === 'survey'
    ? <Select value={current as string} onValueChange={next => set('survey', next as RunRules['survey'])}>
      <SelectTrigger id={id} size="sm" className="ml-auto w-full" aria-describedby={`${id}-hint`}><SelectValue /></SelectTrigger>
      <SelectContent>{SURVEY.map(c => <SelectItem key={c} value={c}>{t(`conditions.runRules.survey.${c}`)}</SelectItem>)}</SelectContent>
    </Select>
    : field === 'repetitionGuard'
      ? <Switch id={id} className="ml-auto" checked={current as boolean} aria-describedby={`${id}-hint`} onCheckedChange={on => set('repetitionGuard', on)} />
      : <Input id={id} type="number" inputMode="numeric" step={1} className="ml-auto h-7 w-20 text-right tabular-nums" value={String(current)} aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-range ${id}-hint` : `${id}-hint`}
        onChange={e => set(field, e.target.value.trim() === '' ? undefined : Number(e.target.value) as never)} />;
  return <TableRow>
    <TableCell className="whitespace-normal">
      <label htmlFor={id} title={t(`conditions.runRules.fields.${field}.hint`)}>{label}</label>
      <span id={`${id}-hint`} className="sr-only">{t(`conditions.runRules.fields.${field}.hint`)}</span>
      {invalid && <p id={`${id}-range`} className="text-sm text-missed">{t(`conditions.runRules.fields.${field}.range`)}</p>}
    </TableCell>
    <TableCell className="text-right"><div className="flex justify-end">{control}</div></TableCell>
    <TableCell className="text-right text-ink-2 tabular-nums">{ruleValueLabel(field, inherited[field])}</TableCell>
    <TableCell className={cn('text-right')}>
      {overridden && <button type="button" className="text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground"
        aria-label={t('conditions.runRules.resetAria', { field: label })} onClick={() => set(field, undefined)}>{t('conditions.runRules.reset')}</button>}
    </TableCell>
  </TableRow>;
}

/** Whether a set of overrides can be saved: every field within its bounds. */
export function runRulesValid(value: Partial<RunRules>): boolean {
  return runRulesSchema.partial().safeParse(value).success;
}
