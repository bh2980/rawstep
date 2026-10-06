import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ConfigView } from '../../shared/config';
import { CheckEditor } from '../components/CheckEditor';
import { CheckSuggestions } from '../components/CheckSuggestions';
import { Choice, Field, Panel } from '../components/forms';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import type { RouteChange } from '../hooks/useRoute';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { PageProps } from './types';

type Props = PageProps & {
  navigate: (change: RouteChange) => void;
  /** Starts the default run of a task in the given project state and opens it. */
  startRun: (view: ConfigView, taskId: string) => Promise<void>;
};

/** Full-page task creation: address, goal and completion check on the left, AI suggestions on the right from 1100px up. */
export function NewTaskPage({ navigate, startRun, ...props }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const profiles = props.view.config.profiles;
  const [url, setUrl] = useState(''), [goal, setGoal] = useState(''), [name, setName] = useState('');
  const [rules, setRules] = useState<VerifyRule[]>([]);
  const [profileId, setProfileId] = useState(profiles[0]!.id);
  // A project HTML path has no host; its file name is the next best name.
  const host = hostnameOf(url) || url.trim().split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || '', title = name.trim() || host || t('newTask.fallbackName');
  const ready = url.trim() !== '' && goal.trim() !== '' && rules.length > 0;
  async function create(run: boolean) {
    const task = {
      url: url.trim(), goal: goal.trim(), maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
      verify: { all: rules },
    };
    const created = await createManagedTask(props, { name: title, slug: slugify(name) || slugify(host), task, profileId });
    if (!run) { navigate({ task: created.id }); return; }
    // The task exists now; a failed start leaves the person on the task with the reason in the banner.
    try { await startRun(created.view, created.id); } catch (error) { navigate({ task: created.id }); throw error; }
  }
  const submit = (run: boolean) => { if (ready && !props.busy) void props.act(() => create(run)); };
  return <div className="grid gap-5">
    <h1 className="text-2xl font-semibold tracking-tight">{t('newTask.title')}</h1>
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid min-w-0 max-w-3xl gap-5">
        <div className="grid gap-1.5">
          <Label htmlFor={id + '-url'} className="text-[15px]">{t('newTask.url')}</Label>
          <Input id={id + '-url'} aria-describedby={id + '-url-hint'} className="h-11 font-mono text-[15px] md:text-[15px]" placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} />
          <p id={id + '-url-hint'} className="text-xs leading-5 text-muted-foreground">{t('taskSettings.urlHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id + '-goal'} className="text-[15px]">{t('newTask.goal')}</Label>
          <Textarea id={id + '-goal'} aria-describedby={id + '-goal-hint'} rows={8} className="min-h-44 text-base leading-7 md:text-base" value={goal} onChange={event => setGoal(event.target.value)} />
          <p id={id + '-goal-hint'} className="text-xs leading-5 text-muted-foreground">{t('newTask.goalHint')}</p>
        </div>
        <fieldset className="grid gap-3 rounded-xl border p-4">
          <legend className="px-1.5 text-[15px] font-medium">{t('newTask.verifyTitle')}</legend>
          <p className="text-[13px] leading-5 text-muted-foreground">{t('newTask.verifyDescription')}</p>
          <CheckEditor rules={rules} onChange={setRules} url={url} />
        </fieldset>
        <Panel title={t('newTask.optionsTitle')} description={t('newTask.optionsSummary', { name: title, profile: profiles.find(profile => profile.id === profileId)?.name ?? '' })}>
          <Field label={t('newTask.name')} value={name} placeholder={host || t('newTask.fallbackName')} hint={t('newTask.nameHint')} onChange={setName} />
          <div className="grid gap-2">
            <Choice label={t('newTask.profile')} value={profileId} onChange={setProfileId} options={profiles.map(profile => ({ id: profile.id, name: profile.name }))} />
            <p className="text-xs leading-5 text-muted-foreground">{t('newTask.profileHint')}</p>
          </div>
        </Panel>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="xl" disabled={props.busy || !ready} onClick={() => submit(true)}>{t('newTask.createAndRun')}</Button>
            <Button size="xl" variant="outline" disabled={props.busy || !ready} onClick={() => submit(false)}>{t('newTask.createOnly')}</Button>
            <Button size="xl" variant="ghost" onClick={() => navigate({ view: 'tasks' })}>{t('newTask.cancel')}</Button>
          </div>
          {!ready && <p role="status" className="text-xs leading-5 text-muted-foreground">{t('newTask.notReady')}</p>}
        </div>
      </div>
      <CheckSuggestions view={props.view} url={url} goal={goal} onUse={rule => setRules([rule])} onAdd={rule => setRules(current => [...current, rule])} />
    </div>
  </div>;
}
