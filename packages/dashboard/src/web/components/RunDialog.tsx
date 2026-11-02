import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isFilePlanner, type Profile } from '@rawstep/project/config';
import type { Experiment } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import { t as translate } from '../i18n';
import { personaName, personaOf } from '../lib/persona';
import { comboProblem, defaultRunProfileId, QUICK_RUN_REPEATS, startRun } from '../lib/quickRun';
import { allTaggedSelected, projectTags, tasksWithTag, toggleTagged } from '../lib/tags';
import { anyUsual, effectiveMode, profileRequest, profilesPerTask, profilesUsed, runTotal, startingChoice, type ProfileMode } from '../lib/usualProfiles';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { Link } from './Link';
import { aiSummary } from './ProfileEditor';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const MAX_REPEATS = 20;
/** Past this many runs the dialog says how much it is before it starts them. */
const MANY_RUNS = 12;
const MEMORY = 'rawstep.run.profile';

/** The profile last run on its own in this browser; a convenience only, so a missing or blocked storage is no matter. */
function remembered(): string | undefined {
  try { return localStorage.getItem(MEMORY) ?? undefined; } catch { return undefined; }
}
/** Only a single profile is kept: several at once are a choice to make each time, not a default to restore. */
function remember(ids: string[]) { if (ids.length === 1) try { localStorage.setItem(MEMORY, ids[0]!); } catch { /* not kept */ } }

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  pageProps: PageProps;
  /** The tasks the dialog opens with; a person can add or remove tasks in it. */
  taskIds: string[];
  navigate: (change: RouteChange) => void;
  onStarted: (experiment: Experiment) => void;
};

/**
 * Starting runs, said as one sentence a person can change in place: which tasks, with which profiles, how many times each — and how
 * many runs that makes. Under it, each profile in one line (who, where, which AI), with anything that would stop it. A task holds what
 * to do and the profiles it usually runs with; the dialog starts with those picked. Several tasks can each run with their own usual
 * profiles (`perTask`) or all with one list picked here (`explicit`).
 */
export function RunDialog({ open, onOpenChange, pageProps, taskIds: initialTasks, navigate, onStarted }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { view, busy } = pageProps, config = view.config;
  const [taskIds, setTaskIds] = useState<string[]>(initialTasks);
  const [profileIds, setProfileIds] = useState<string[]>([]), [mode, setMode] = useState<ProfileMode>('explicit');
  // Until a person touches the profiles, they follow the tasks: picking another task picks its usual profiles.
  const [touched, setTouched] = useState(false);
  const [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setTaskIds(initialTasks);
    setNote('');
    setRepeats(String(QUICK_RUN_REPEATS));
    setTouched(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || touched) return;
    const fallback = defaultRunProfileId(config.profiles, remembered(), profile => !comboProblem(config, view.credentialStatus, profile));
    const start = startingChoice(config.tasks.filter(task => taskIds.includes(task.id)), config.profiles, fallback);
    setMode(start.mode); setProfileIds(start.profileIds);
  }, [open, touched, taskIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const tasks = config.tasks.filter(task => taskIds.includes(task.id));
  const offerMode = tasks.length > 1 && anyUsual(tasks, config.profiles), shownMode = effectiveMode(mode, tasks, config.profiles);
  const assignment = profilesPerTask(tasks, config.profiles, shownMode, profileIds), usedIds = profilesUsed(assignment);
  const profiles = config.profiles.filter(p => usedIds.includes(p.id));
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const total = valid ? runTotal(assignment, count) : 0;
  const problems = profiles.flatMap(profile => { const problem = comboProblem(config, view.credentialStatus, profile); return problem ? [{ profile, problem }] : []; });
  const pairs = assignment.reduce((sum, item) => sum + item.profileIds.length, 0);
  const factors = (shownMode === 'perTask'
    ? [t('runDialog.factorPairs', { count: pairs }), t('runDialog.factorRepeats', { count: valid ? count : 0 })]
    : [tasks.length > 1 && t('runDialog.factorTasks', { count: tasks.length }), t('runDialog.factorProfiles', { count: profiles.length }), t('runDialog.factorRepeats', { count: valid ? count : 0 })]).filter(Boolean).join(' × ');
  const ready = tasks.length > 0 && profiles.length > 0 && valid && !problems.length && !busy;
  const profileName = (id: string) => config.profiles.find(profile => profile.id === id)?.name ?? id;
  const tagList = projectTags(config.tasks);
  const toggle = (list: string[], value: string, on: boolean) => on ? [...list, value] : list.filter(item => item !== value);

  const run = () => void pageProps.act(async () => {
    remember(shownMode === 'explicit' ? profileIds : []);
    const experiment = await startRun(view, { taskIds, ...profileRequest(assignment, shownMode), repeats: count, note });
    onOpenChange(false);
    onStarted(experiment);
  }, { as: 'start' });

  const names = (items: { name: string }[]) => items.length <= 2 ? items.map(item => item.name).join(', ') : `${items.slice(0, 2).map(item => item.name).join(', ')} ${t('runDialog.more', { count: items.length - 2 })}`;
  const title = tasks.length === 1 ? t('runDialog.titleOne', { name: tasks[0]!.name }) : tasks.length ? t('runDialog.titleMany', { count: tasks.length }) : t('runDialog.title');
  const fieldLabel = 'text-ink-2';

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-0 p-0 sm:max-w-xl">
      <DialogHeader className="px-6 pt-6 pb-4 pr-12">
        <DialogTitle className="break-words">{title}</DialogTitle>
        <DialogDescription className="sr-only">{t('runDialog.description')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 px-6 pb-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={fieldLabel}>{t('runDialog.tasksLabel')}</span>
          <span className="min-w-0 truncate">{tasks.length ? names(tasks) : <span className="text-ink-3">—</span>}</span>
          <Popover>
            <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label={t('runDialog.changeTasksLabel')}>{t('runDialog.changeTasks')}</Button></PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-1.5">
              <p className="px-2 pt-1 pb-1.5 text-sm text-ink-2">{t('runDialog.tasksTitle')}</p>
              {tagList.length > 0 && <div role="group" aria-label={t('runDialog.tagsTitle')} className="flex flex-wrap gap-1 px-2 pb-2">{tagList.map(tag => <button key={tag} type="button" aria-pressed={allTaggedSelected(config.tasks, tag, taskIds)}
                aria-label={t('runDialog.tagPick', { tag, n: tasksWithTag(config.tasks, tag).length })} onClick={() => setTaskIds(toggleTagged(config.tasks, tag, taskIds))}
                className={cn('inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-sm focus-visible:outline-2 focus-visible:outline-trace',
                  allTaggedSelected(config.tasks, tag, taskIds) ? 'border-foreground font-medium text-foreground' : 'border-edge-strong text-ink-2 hover:bg-raised')}>
                {tag}<span aria-hidden="true" className="tabular-nums text-ink-3">{tasksWithTag(config.tasks, tag).length}</span>
              </button>)}</div>}
              <ul className="grid max-h-72 overflow-y-auto">{config.tasks.map(task => <li key={task.id}>
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 hover:bg-raised">
                  <Checkbox checked={taskIds.includes(task.id)} onCheckedChange={on => setTaskIds(toggle(taskIds, task.id, on === true))} /><span className="truncate">{task.name}</span>
                </label>
              </li>)}</ul>
            </PopoverContent>
          </Popover>
        </div>

        <fieldset className="grid gap-1.5">
          <legend className={fieldLabel + ' mb-1.5'}>{t('runDialog.profilesLabel')}</legend>
          {offerMode && <div role="radiogroup" aria-label={t('runDialog.whoTitle')} className="mb-1 grid gap-1">
            {(['perTask', 'explicit'] as const).map(value => <label key={value} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name={`${id}-mode`} checked={shownMode === value} aria-describedby={`${id}-mode-${value}-hint`} className="mt-1 size-3.5 shrink-0 accent-foreground"
                onChange={() => { setTouched(true); setMode(value); }} />
              <span className="grid">
                <span>{t(value === 'perTask' ? 'runDialog.perTask' : 'runDialog.sameForAll')}</span>
                <span id={`${id}-mode-${value}-hint`} className="text-sm text-ink-2">{t(value === 'perTask' ? 'runDialog.perTaskHint' : 'runDialog.sameForAllHint')}</span>
              </span>
            </label>)}
          </div>}
          {shownMode === 'explicit'
            ? <ul className="max-h-72 overflow-y-auto rounded-sm border border-edge">{config.profiles.map(profile => { const problem = profileIds.includes(profile.id) ? problems.find(item => item.profile === profile)?.problem : undefined;
              return <li key={profile.id} className="border-b border-edge last:border-b-0">
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-raised" title={profileLine(profile)}>
                  <Checkbox checked={profileIds.includes(profile.id)} onCheckedChange={on => { setTouched(true); setProfileIds(toggle(profileIds, profile.id, on === true)); }} />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{profile.name}</span>
                    {problem && <span className="text-sm text-inspect">{problem}</span>}
                  </span>
                  <span className="shrink-0 truncate text-sm text-ink-2">{plannerName(profile)}</span>
                </label>
              </li>; })}</ul>
            : <div className="grid gap-1 rounded-sm border border-edge px-3 py-2">
              <ul aria-label={t('runDialog.perTaskList')} className="grid gap-1">
                {assignment.map(item => <li key={item.taskId}>
                  <span className="font-medium">{tasks.find(task => task.id === item.taskId)?.name}</span> <span className="text-ink-2">· {item.profileIds.map(profileName).join(', ')}</span>
                </li>)}
              </ul>
              {problems.map(({ profile, problem }) => <p key={profile.id} className="text-sm text-inspect">{profile.name}: {problem}</p>)}
            </div>}
          <Link to={{ view: 'profiles' }} navigate={change => { onOpenChange(false); navigate(change); }} className="justify-self-start rounded-sm text-sm text-ink-2 underline decoration-edge-strong underline-offset-4 hover:text-foreground">{t('runDialog.editProfiles')}</Link>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="grid gap-1.5">
            <label htmlFor={id + '-repeats'} className={fieldLabel}>{t('runDialog.repeats')}</label>
            <div className="relative">
              <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} value={repeats} aria-invalid={!valid} aria-describedby={!valid ? id + '-repeats-hint' : undefined}
                onChange={event => setRepeats(event.target.value)} className="pr-8 tabular-nums" />
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3">{t('runDialog.repeatsUnit')}</span>
            </div>
            {!valid && <p id={id + '-repeats-hint'} role="status" className="text-sm text-inspect">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <label htmlFor={id + '-note'} className={fieldLabel}>{t('runDialog.note')}</label>
            <Input id={id + '-note'} value={note} maxLength={200} placeholder={t('runDialog.notePlaceholder')} title={t('runDialog.noteHint')} onChange={event => setNote(event.target.value)} />
          </div>
        </div>
        {total > MANY_RUNS && <p role="status" className="text-sm text-inspect">{t('runDialog.many', { count: total })}</p>}
      </div>
      <DialogFooter className="m-0 flex-row items-center justify-between gap-3 border-t border-edge px-6 py-4 sm:justify-between">
        <p className="text-sm text-ink-2 tabular-nums" title={total > 0 ? t('runDialog.runMath', { factors, count: total }) : undefined}>{t('runDialog.summary', { count: total })}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('runBox.cancel')}</Button>
          <Button type="button" disabled={!ready} onClick={run}>{t('runDialog.start', { count: total })}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** A profile in one line: who uses the page, where it is heard, which AI thinks. */
export function profileLine(profile: Profile): string {
  const who = personaName(personaOf(profile));
  return `${who} · ${translate(`conditions.backends.${profile.screenReader}`)} · ${aiSummary(profile)}`;
}

/** What plans a profile's runs, as short as a list row allows: the model, or that a plan file does. */
function plannerName(profile: Profile): string {
  if (isFilePlanner(profile.planner)) return translate('runDialog.planFile');
  return profile.planner?.modelId.trim() || translate('runDialog.noPlanner');
}

