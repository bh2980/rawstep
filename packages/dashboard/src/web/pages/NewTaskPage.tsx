import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ConfigView } from '../../shared/config';
import { CheckEditor } from '../components/CheckEditor';
import { CheckSuggestions } from '../components/CheckSuggestions';
import { Field, Panel } from '../components/forms';
import { PageHeader } from '../components/layout/PageHeader';
import { RadioRows } from '../components/layout/RadioRows';
import { ConceptNote } from '../components/layout/ConceptNote';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import type { RouteChange } from '../hooks/useRoute';
import { profileSummary } from '../lib/profileSummary';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { PageProps } from './types';

type Props = PageProps & {
  navigate: (change: RouteChange) => void;
  /** Starts the default run of a task in the given project state and opens it. */
  startRun: (view: ConfigView, taskId: string) => Promise<void>;
};

/** One numbered part of the specification: a heading that is also the label of its input, and what it holds. */
function Part({ n, title, htmlFor, children }: { n: string; title: string; htmlFor?: string; children: ReactNode }) {
  const heading = <span className="text-base font-semibold">{title}</span>;
  return <section className="grid gap-2.5 border-t border-edge-strong pt-3">
    <div className="flex items-baseline gap-3"><span aria-hidden="true" className="font-mono text-sm text-muted-foreground tabular-nums">{n}</span>{htmlFor ? <Label htmlFor={htmlFor}>{heading}</Label> : <h2>{heading}</h2>}</div>
    {children}
  </section>;
}

/**
 * New task (spec §21), read density: on the left the task specification as a document (address, goal, completion check), on the right
 * from 1100px a reference panel of completion ideas. The right side supports the left; it is not a conversation.
 */
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
  const submit = (run: boolean) => { if (ready && !props.busy) void props.act(() => create(run), { as: 'start' }); };
  return <div className="grid gap-6">
    <PageHeader title={t('newTask.title')} description={t('newTask.description')} />
    <div className="grid items-start gap-10 min-[1100px]:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid min-w-0 max-w-3xl gap-7">
        <p lang="en" className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('labels.spec')}</p>
        <Part n="01" title={t('newTask.url')} htmlFor={id + '-url'}>
          <Input id={id + '-url'} aria-describedby={id + '-url-hint'} className="h-10 font-mono text-sm md:text-sm" placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} />
          <p id={id + '-url-hint'} className="text-xs leading-5 text-muted-foreground">{t('taskSettings.urlHint')}</p>
        </Part>
        <Part n="02" title={t('newTask.goal')} htmlFor={id + '-goal'}>
          <Textarea id={id + '-goal'} aria-describedby={id + '-goal-hint'} rows={5} className="min-h-28 text-sm leading-6 md:text-sm" value={goal} onChange={event => setGoal(event.target.value)} />
          <p id={id + '-goal-hint'} className="text-xs leading-5 text-muted-foreground">{t('newTask.goalHint')}</p>
        </Part>
        <Part n="03" title={t('newTask.verifyTitle')}>
          <p className="text-[13px] leading-5 text-muted-foreground">{t('newTask.verifyDescription')}</p>
          <CheckEditor rules={rules} onChange={setRules} url={url} />
        </Part>
        <Panel title={t('newTask.optionsTitle')} description={t('newTask.optionsSummary', { name: title, profile: profiles.find(profile => profile.id === profileId)?.name ?? '' })}>
          <Field label={t('newTask.name')} value={name} placeholder={host || t('newTask.fallbackName')} hint={t('newTask.nameHint')} onChange={setName} />
          <div className="grid gap-2">
            <ConceptNote concept="profile" />
            <RadioRows legend={t('newTask.profile')} value={profileId} onChange={setProfileId}
              rows={profiles.map(profile => ({ id: profile.id, label: profile.name, hint: profileSummary(profile, props.view.capabilities.screenreader) }))} />
            <p className="text-xs leading-5 text-muted-foreground">{t('newTask.profileHint')}</p>
          </div>
        </Panel>
        <div className="grid gap-2 border-t border-edge-strong pt-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="xl" disabled={props.busy || !ready} onClick={() => submit(true)}>{t('newTask.createAndRun')}</Button>
            <Button size="xl" variant="outline" disabled={props.busy || !ready} onClick={() => submit(false)}>{t('newTask.createOnly')}</Button>
            <Button size="xl" variant="ghost" onClick={() => navigate({ view: 'tasks' })}>{t('newTask.cancel')}</Button>
          </div>
          {!ready && <p role="status" className="text-xs leading-5 text-muted-foreground">{t('newTask.notReady')}</p>}
        </div>
      </div>
      <aside aria-label={t('labels.ideas')} className="grid min-w-0 gap-3">
        <p lang="en" className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('labels.ideas')}</p>
        <CheckSuggestions view={props.view} url={url} goal={goal} reference onAdd={rule => setRules(current => [...current, rule])} />
      </aside>
    </div>
  </div>;
}
