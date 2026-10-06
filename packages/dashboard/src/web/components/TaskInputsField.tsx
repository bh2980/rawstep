import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskInputOptions } from '@rawstep/core/contracts';
import { inputFields, inputProblems } from '../lib/taskInputs';
import { Field, SecretField } from './forms';
import { Button } from './ui/button';

type Props = {
  input: Record<string, string>; options?: Record<string, TaskInputOptions> | undefined;
  /** The goal as typed, to catch an input value written in it. */
  goal: string;
  onChange: (fields: ReturnType<typeof inputFields>) => void;
};

/**
 * Name and value rows for the typed inputs of a task (a search term, a login). Values are hidden behind an eye button. A value of four
 * or more characters that appears in the goal is flagged on its row, because the goal reaches the model as written.
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
  const add = () => { let name = 'input' + (rows.length + 1); while (Object.hasOwn(input, name)) name += '_'; emit([...rows, [name, '']]); };
  return <div className="grid gap-3">
    <p className="text-xs leading-5 text-muted-foreground">{t('taskInputs.note')}</p>
    {rows.map(([name, value], i) => {
      const problem = problems.get(name);
      return <div key={i} className="grid gap-1.5">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={t('taskInputs.name', { n: i + 1 })} value={name} onChange={next => rename(i, next)} />
          <SecretField label={t('taskInputs.value', { n: i + 1 })} value={value} onChange={next => emit(rows.map(([key, text], n) => [key, n === i ? next : text]))} />
          <Button type="button" variant="outline" aria-label={t('taskInputs.deleteAria', { n: i + 1 })} onClick={() => emit(rows.filter((_, n) => n !== i))}>{t('taskInputs.delete')}</Button>
        </div>
        {problem && <p role="alert" className="text-xs leading-5 text-destructive">{t(problem === 'name' ? 'taskInputs.problemName' : 'taskInputs.problemGoal', { n: i + 1 })}</p>}
      </div>;
    })}
    <Button type="button" variant="outline" className="justify-self-start" onClick={add}><Plus aria-hidden="true" />{t('taskInputs.add')}</Button>
  </div>;
}
