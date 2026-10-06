import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskInputOptions } from '@rawstep/core/contracts';
import { inputFields, inputProblems } from '../lib/taskInputs';
import { Field, SecretField } from './forms';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

type Props = {
  input: Record<string, string>; options?: Record<string, TaskInputOptions> | undefined;
  /** The goal as typed, to catch an input value written in it. */
  goal: string;
  onChange: (fields: ReturnType<typeof inputFields>) => void;
};

/**
 * Name and value rows for the typed inputs of a task (a search term, a login). An input is secret unless unticked: a secret is hidden
 * behind an eye button and never shown to the model, which only sees its name; an input that is not secret (a search term) is shown to
 * the model so it knows what it would type. A secret of four or more characters that appears in the goal is flagged on its row,
 * because the goal reaches the model as written.
 */
export function TaskInputsField({ input, options, goal, onChange }: Props) {
  const { t } = useTranslation();
  const rows = Object.entries(input), problems = inputProblems(input, options, goal);
  const emit = (next: [string, string][], renamed?: [from: string, to: string]) => {
    let kept = options;
    if (kept && renamed && renamed[0] !== renamed[1] && Object.hasOwn(kept, renamed[0])) { const { [renamed[0]]: moved, ...rest } = kept; kept = { ...rest, [renamed[1]]: moved! }; }
    onChange(inputFields(Object.fromEntries(next), kept));
  };
  const rename = (i: number, name: string) => {
    // A name another row already has would merge the two rows, so it is not taken.
    if (rows.some(([other], n) => n !== i && other === name)) return;
    emit(rows.map(([key, value], n) => n === i ? [name, value] : [key, value]), [rows[i]![0], name]);
  };
  // Secret is the default, so only a non-secret input or a description is written into inputOptions.
  const setOption = (name: string, part: TaskInputOptions) => {
    const merged: TaskInputOptions = { ...options?.[name], ...part };
    if (merged.sensitive !== false) delete merged.sensitive;
    if (!merged.description?.trim()) delete merged.description;
    const { [name]: _old, ...rest } = options ?? {};
    onChange(inputFields(input, Object.keys(merged).length ? { ...rest, [name]: merged } : rest));
  };
  const add = () => { let name = 'input' + (rows.length + 1); while (Object.hasOwn(input, name)) name += '_'; emit([...rows, [name, '']]); };
  return <div className="grid gap-3">
    <p className="text-xs leading-5 text-muted-foreground">{t('taskInputs.note')}</p>
    {rows.map(([name, value], i) => {
      const problem = problems.get(name), secret = options?.[name]?.sensitive !== false, setValue = (next: string) => emit(rows.map(([key, text], n) => [key, n === i ? next : text]));
      return <div key={i} className="grid gap-2 border-b border-edge pb-3">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={t('taskInputs.name', { n: i + 1 })} value={name} onChange={next => rename(i, next)} />
          {secret ? <SecretField label={t('taskInputs.value', { n: i + 1 })} value={value} onChange={setValue} /> : <Field label={t('taskInputs.value', { n: i + 1 })} value={value} onChange={setValue} />}
          <Button type="button" variant="outline" aria-label={t('taskInputs.deleteAria', { n: i + 1 })} onClick={() => emit(rows.filter((_, n) => n !== i))}>{t('taskInputs.delete')}</Button>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id={`input-secret-${i}`} checked={secret} onCheckedChange={on => setOption(name, { sensitive: on === true })} className="mt-0.5" />
          <div className="grid gap-0.5"><Label htmlFor={`input-secret-${i}`} className="font-normal">{t('taskInputs.secret')}</Label><p className="text-xs leading-5 text-muted-foreground">{secret ? t('taskInputs.secretOn') : t('taskInputs.secretOff')}</p></div>
        </div>
        <Field label={t('taskInputs.description', { n: i + 1 })} value={options?.[name]?.description ?? ''} onChange={description => setOption(name, { description })} hint={t('taskInputs.descriptionHint')} />
        {problem && <p role="alert" className="text-xs leading-5 text-destructive">{t(problem === 'name' ? 'taskInputs.problemName' : 'taskInputs.problemGoal', { n: i + 1 })}</p>}
      </div>;
    })}
    <Button type="button" variant="outline" className="justify-self-start" onClick={add}><Plus aria-hidden="true" />{t('taskInputs.add')}</Button>
  </div>;
}
