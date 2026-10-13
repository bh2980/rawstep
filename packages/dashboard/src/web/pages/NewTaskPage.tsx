import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { TaskInputOptions, VerifyRule } from '@rawstep/core/contracts';
import { taskConditions, type Mode } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import type { RunOptions } from '../lib/quickRun';
import { CheckEditor } from '../components/CheckEditor';
import { CheckSuggestions } from '../components/CheckSuggestions';
import { TaskInputsField } from '../components/TaskInputsField';
import { Field, Panel } from '../components/forms';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { TaskConditionFields } from '../components/TaskConditionFields';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import type { RouteChange } from '../hooks/useRoute';
import { comboModesOf } from '../lib/conditions';
import type { TaskConditionIds } from '../lib/taskConditions';
import { inputProblems } from '../lib/taskInputs';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { PageProps } from './types';

type Props = PageProps & {
  navigate: (change: RouteChange) => void;
  /** Starts the default run of a task in the given project state and opens it. */
  startRun: (view: ConfigView, taskId: string, options: RunOptions) => Promise<void>;
};

/**
 * New task: one form column — start address, goal, completion check (with AI suggestions under it) and, folded, inputs, name and
 * experiment conditions. The footer holds one primary button, a mode switch and the reason when nothing can be created yet.
 */
export function NewTaskPage({ navigate, startRun, ...props }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { config } = props.view;
  const [url, setUrl] = useState(''), [goal, setGoal] = useState(''), [name, setName] = useState('');
  const [rules, setRules] = useState<VerifyRule[]>([]), [input, setInput] = useState<Record<string, string>>({}), [inputOptions, setInputOptions] = useState<Record<string, TaskInputOptions>>();
  const [conditions, setConditions] = useState<TaskConditionIds>({});
  const resolved = taskConditions(config, conditions), modes = comboModesOf(resolved.combo, config.connections);
  // A project HTML path has no host; its file name is the next best name.
  const host = hostnameOf(url) || url.trim().split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || '', title = name.trim() || host || t('newTask.fallbackName');
  const filled = url.trim() !== '' && goal.trim() !== '' && rules.length > 0, inputsOk = inputProblems(input, inputOptions, goal).size === 0, ready = filled && inputsOk;
  // Start at a mode the chosen model combo can run, screen reader first.
  const [picked, setMode] = useState<Mode>();
  const mode: Mode = picked && (modes.includes(picked) || !modes.length) ? picked : modes[0] ?? 'screenreader';
  async function create(run: boolean) {
    const task = {
      url: url.trim(), goal: goal.trim(), maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
      verify: { all: rules }, ...(Object.keys(input).length ? { input, ...(inputOptions ? { inputOptions } : {}) } : {}),
    };
    const created = await createManagedTask(props, { name: title, slug: slugify(name) || slugify(host), task, conditions });
    if (!run) { navigate({ task: created.id }); return; }
    // The task exists now; a failed start leaves the person on the task with the reason in the banner.
    try { await startRun(created.view, created.id, { mode }); } catch (error) { navigate({ task: created.id }); throw error; }
  }
  const submit = (run: boolean) => { if (ready && !props.busy) void props.act(() => create(run), { as: 'start' }); };
  const missing = [url.trim() === '' && 'url', goal.trim() === '' && 'goal', rules.length === 0 && 'check'].filter((key): key is 'url' | 'goal' | 'check' => !!key);
  const inputCount = Object.keys(input).length;
  const reason = missing.length ? t('newTask.missingLine', { items: missing.map(key => t(`newTask.missing.${key}`)).join(', ') }) : !inputsOk ? t('newTask.inputInvalid') : '';
  return <div className="grid max-w-3xl gap-6">
    <PageHeader title={t('newTask.title')} />
    <section className="grid gap-2">
      <SectionHead id={id + '-url-title'} title={t('newTask.url')} />
      <Input aria-labelledby={id + '-url-title'} aria-describedby={id + '-url-hint'} className="h-10 font-mono text-sm md:text-sm" placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} />
      <p id={id + '-url-hint'} className="text-xs leading-5 text-muted-foreground">{t('newTask.urlHint')}</p>
    </section>
    <section className="grid gap-2">
      <SectionHead id={id + '-goal-title'} title={t('newTask.goal')} />
      <Textarea aria-labelledby={id + '-goal-title'} aria-describedby={id + '-goal-note'} rows={3} className="min-h-20 text-sm leading-6 md:text-sm" value={goal} onChange={event => setGoal(event.target.value)} />
      <p id={id + '-goal-note'} className="text-xs leading-5 text-muted-foreground">{t('newTask.goalNote')}</p>
    </section>
    <section aria-labelledby={id + '-check-title'} className="grid gap-3">
      <SectionHead id={id + '-check-title'} title={t('newTask.verifyTitle')} info={t('help.check')} />
      <CheckEditor rules={rules} onChange={setRules} url={url} />
      <CheckSuggestions view={props.view} url={url} goal={goal} onAdd={rule => setRules(current => [...current, rule])} />
    </section>
    <Panel title={t('newTask.detailsTitle')} description={t('newTask.detailsSummary', { name: title, count: inputCount })}>
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">{t('newTask.inputsTitle')}</h3>
        <TaskInputsField input={input} options={inputOptions} goal={goal} onChange={fields => { setInput(fields.input ?? {}); setInputOptions(fields.inputOptions); }} />
      </div>
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">{t('newTask.name')}</h3>
        <Field label={t('newTask.name')} value={name} placeholder={host || t('newTask.fallbackName')} hint={t('newTask.nameHint')} onChange={setName} />
      </div>
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">{t('newTask.conditionsTitle')}</h3>
        <TaskConditionFields config={config} value={conditions} onChange={setConditions} />
      </div>
    </Panel>
    <footer className="grid gap-2 border-t border-edge-strong pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button disabled={props.busy || !ready} onClick={() => submit(true)}>{t('newTask.createAndRunMode', { mode: t(`sidebar.modes.${mode}`) })}</Button>
        <fieldset className="inline-flex overflow-hidden rounded-md border border-edge-strong">
          <legend className="sr-only">{t('newTask.runMode')}</legend>
          {(['screenreader', 'keyboard'] as const).map(value => <label key={value} className="flex h-8 cursor-pointer items-center px-3 text-[13px] has-checked:bg-trace-soft has-checked:font-semibold has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-ring [&:not(:first-of-type)]:border-l [&:not(:first-of-type)]:border-edge-strong">
            <input type="radio" name={id + '-mode'} value={value} checked={mode === value} disabled={modes.length > 0 && !modes.includes(value)} onChange={() => setMode(value)} className="sr-only" />{t(`sidebar.modes.${value}`)}
          </label>)}
        </fieldset>
        <Button variant="outline" disabled={props.busy || !ready} onClick={() => submit(false)}>{t('newTask.createOnly')}</Button>
        <Button variant="ghost" onClick={() => navigate({ view: 'tasks' })}>{t('newTask.cancel')}</Button>
      </div>
      {reason && <p role="status" className="text-xs leading-5 text-muted-foreground">{reason}</p>}
    </footer>
  </div>;
}
