import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { TaskInputOptions, VerifyRule } from '@rawstep/core/contracts';
import { CheckEditor } from '../components/CheckEditor';
import { CheckSuggestions } from '../components/CheckSuggestions';
import { TaskInputsField } from '../components/TaskInputsField';
import { Field, Panel } from '../components/forms';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { TaskProfileField } from '../components/TaskProfileField';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import type { RouteChange } from '../hooks/useRoute';
import { inputProblems } from '../lib/taskInputs';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { PageProps } from './types';

type Props = PageProps & { navigate: (change: RouteChange) => void };

/**
 * New task: one form column — start address, goal, completion check (with AI suggestions under it) and, folded, inputs, name and
 * run profile. The footer holds one primary button and the reason when nothing can be created yet. The page only creates the task:
 * the person picks the mode and runs it on the task page.
 */
export function NewTaskPage({ navigate, ...props }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { config } = props.view;
  const [url, setUrl] = useState(''), [goal, setGoal] = useState(''), [name, setName] = useState('');
  const [rules, setRules] = useState<VerifyRule[]>([]), [input, setInput] = useState<Record<string, string>>({}), [inputOptions, setInputOptions] = useState<Record<string, TaskInputOptions>>();
  const [profileId, setProfileId] = useState<string>();
  // A project HTML path has no host; its file name is the next best name.
  const host = hostnameOf(url) || url.trim().split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || '', title = name.trim() || host || t('newTask.fallbackName');
  const filled = url.trim() !== '' && goal.trim() !== '' && rules.length > 0, inputsOk = inputProblems(input, inputOptions, goal).size === 0, ready = filled && inputsOk;
  async function create() {
    const task = {
      url: url.trim(), goal: goal.trim(), maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
      verify: { all: rules }, ...(Object.keys(input).length ? { input, ...(inputOptions ? { inputOptions } : {}) } : {}),
    };
    const created = await createManagedTask(props, { name: title, slug: slugify(name) || slugify(host), task, ...(profileId ? { profileId } : {}) });
    navigate({ task: created.id });
  }
  const submit = () => { if (ready && !props.busy) void props.act(create, { as: 'start' }); };
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
        <h3 className="text-sm font-semibold">{t('newTask.profileTitle')}</h3>
        <TaskProfileField profiles={config.profiles} value={profileId} onChange={setProfileId} />
      </div>
    </Panel>
    <footer className="grid gap-2 border-t border-edge-strong pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button disabled={props.busy || !ready} onClick={submit}>{t('newTask.create')}</Button>
        <Button variant="ghost" onClick={() => navigate({ view: 'tasks' })}>{t('newTask.cancel')}</Button>
      </div>
      {reason && <p role="status" className="text-xs leading-5 text-muted-foreground">{reason}</p>}
    </footer>
  </div>;
}
