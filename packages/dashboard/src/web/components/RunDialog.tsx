import { useEffect, useId, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@rawstep/project/config';
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
  const parts: Record<string, ReactNode> = {
    tasks: <Pick label={tasks.length ? names(tasks) : t('runDialog.pickTasks')} title={t('runDialog.tasksTitle')}>
      {tagList.length > 0 && <div role="group" aria-label={t('runDialog.tagsTitle')} className="flex flex-wrap gap-1 px-2 pb-2">{tagList.map(tag => <button key={tag} type="button" aria-pressed={allTaggedSelected(config.tasks, tag, taskIds)}
        aria-label={t('runDialog.tagPick', { tag, n: tasksWithTag(config.tasks, tag).length })} onClick={() => setTaskIds(toggleTagged(config.tasks, tag, taskIds))}
        className={cn('inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-trace',
          allTaggedSelected(config.tasks, tag, taskIds) ? 'border-trace bg-trace-soft font-medium text-trace' : 'border-edge-strong bg-surface text-muted-foreground hover:bg-raised')}>
        {tag}<span aria-hidden="true" className="tabular-nums opacity-70">{tasksWithTag(config.tasks, tag).length}</span>
      </button>)}</div>}
      <ul className="grid max-h-72 gap-0.5 overflow-y-auto">{config.tasks.map(task => <li key={task.id}>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-raised">
          <Checkbox checked={taskIds.includes(task.id)} onCheckedChange={on => setTaskIds(toggle(taskIds, task.id, on === true))} />{task.name}
        </label>
      </li>)}</ul>
    </Pick>,
    profiles: <Pick label={shownMode === 'perTask' ? t('runDialog.perTaskPick') : profiles.length ? names(profiles) : t('runDialog.pickProfiles')} title={t('runDialog.profilesTitle')}>
      {offerMode && <fieldset className="grid gap-1 px-2 pb-2">
        <legend className="pb-1 text-xs font-medium text-muted-foreground">{t('runDialog.whoTitle')}</legend>
        {(['perTask', 'explicit'] as const).map(value => <div key={value} className="flex items-start gap-2">
          <input type="radio" id={`${id}-mode-${value}`} name={`${id}-mode`} checked={shownMode === value} aria-describedby={`${id}-mode-${value}-hint`} className="mt-1 size-4 shrink-0 accent-trace"
            onChange={() => { setTouched(true); setMode(value); }} />
          <div className="grid gap-0.5">
            <label htmlFor={`${id}-mode-${value}`} className="cursor-pointer text-sm">{t(value === 'perTask' ? 'runDialog.perTask' : 'runDialog.sameForAll')}</label>
            <span id={`${id}-mode-${value}-hint`} className="text-xs leading-5 text-muted-foreground">{t(value === 'perTask' ? 'runDialog.perTaskHint' : 'runDialog.sameForAllHint')}</span>
          </div>
        </div>)}
      </fieldset>}
      {shownMode === 'explicit' && <ul className="grid max-h-80 gap-0.5 overflow-y-auto">{config.profiles.map(profile => <li key={profile.id}>
        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-raised">
          <Checkbox className="mt-0.5" checked={profileIds.includes(profile.id)} onCheckedChange={on => { setTouched(true); setProfileIds(toggle(profileIds, profile.id, on === true)); }} />
          <span className="grid gap-0.5"><span className="text-sm">{profile.name}</span><span className="text-xs leading-5 text-muted-foreground">{profileLine(profile)}</span></span>
        </label>
      </li>)}</ul>}
    </Pick>,
    times: <span className="inline-flex items-baseline">
      <label htmlFor={id + '-repeats'} className="sr-only">{t('runBox.repeats')}</label>
      <input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} value={repeats} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)}
        className="w-8 [appearance:textfield] border-0 border-b-[1.5px] border-dashed border-muted-foreground bg-transparent p-0 text-center font-medium tabular-nums focus-visible:outline-2 [&::-webkit-inner-spin-button]:appearance-none" />
    </span>,
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t('runDialog.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('runDialog.description')}</DialogDescription>
      </DialogHeader>
      <p className="text-[16.5px] leading-9">{fill(t('runDialog.sentence'), parts)} <span className="text-muted-foreground">{t('runDialog.total', { count: total })}</span></p>
      {shownMode === 'perTask' && <div className="grid gap-1.5 border-t border-edge pt-3">
        <ul aria-label={t('runDialog.perTaskList')} className="grid gap-1 text-[13px] leading-5">
          {assignment.map(item => <li key={item.taskId}>
            <span className="font-medium">{tasks.find(task => task.id === item.taskId)?.name}</span> <span className="text-muted-foreground">· {item.profileIds.map(profileName).join(', ')}</span>
          </li>)}
        </ul>
        {problems.map(({ profile, problem }) => <p key={profile.id} className="text-[13px] leading-5 text-inspect">{profile.name}: {problem}</p>)}
      </div>}
      {shownMode === 'explicit' && profiles.length > 0 && <ul aria-label={t('runDialog.profilesTitle')} className="grid gap-1.5 border-t border-edge pt-3">
        {profiles.map(profile => { const problem = problems.find(item => item.profile === profile)?.problem;
          return <li key={profile.id} className="grid gap-0.5 text-[13px] leading-5">
            <span className="font-medium">{profile.name}</span>
            <span className={cn(problem ? 'text-inspect' : 'text-muted-foreground')}>{problem ?? profileLine(profile)}</span>
          </li>; })}
      </ul>}
      <div className="grid gap-1.5 border-t border-edge pt-3">
        <label htmlFor={id + '-note'} className="text-[13px] font-medium">{t('runDialog.note')} <span className="font-normal text-muted-foreground">{t('runDialog.optional')}</span></label>
        <Input id={id + '-note'} value={note} maxLength={200} placeholder={t('runDialog.notePlaceholder')} aria-describedby={id + '-note-hint'} onChange={event => setNote(event.target.value)} />
        <p id={id + '-note-hint'} className="text-xs leading-5 text-muted-foreground">{t('runDialog.noteHint')}</p>
      </div>
      {!valid && <p role="status" className="text-xs text-inspect">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>}
      {total > MANY_RUNS && <p role="status" className="text-xs leading-5 text-inspect">{t('runDialog.many', { count: total })}</p>}
      <DialogFooter className="sm:items-center sm:justify-between">
        <Link to={{ view: 'profiles' }} navigate={change => { onOpenChange(false); navigate(change); }} className="text-[13px] text-trace underline underline-offset-4">{t('runDialog.editProfiles')}</Link>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('runBox.cancel')}</Button>
          <Button type="button" disabled={!ready} onClick={run}><Play aria-hidden="true" />{total > 1 ? t('runDialog.runMath', { factors, count: total }) : t('runDialog.run', { count: total })}</Button>
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

const pickClass = 'rounded-sm font-medium underline decoration-muted-foreground decoration-dashed decoration-[1.5px] underline-offset-[5px] hover:decoration-foreground focus-visible:outline-2';

/** A dashed, clickable part of the sentence that opens a small chooser. */
function Pick({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><button type="button" className={pickClass} aria-label={`${title}: ${label}`}>{label}</button></PopoverTrigger>
    <PopoverContent align="start" className="w-96 p-1.5"><p className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">{title}</p>{children}</PopoverContent>
  </Popover>;
}

/** A sentence template with %name%-style slots filled by elements. */
function fill(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(%\w+%)/).map((piece, index) => {
    const slot = /^%(\w+)%$/.exec(piece)?.[1];
    return slot && slot in parts ? <span key={index}>{parts[slot]}</span> : <span key={index}>{piece}</span>;
  });
}
