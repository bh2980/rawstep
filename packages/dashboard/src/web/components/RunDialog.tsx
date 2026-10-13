import { useEffect, useId, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@rawstep/project/config';
import type { Experiment } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import { t as translate } from '../i18n';
import { personaName, personaOf } from '../lib/persona';
import { comboProblem, QUICK_RUN_REPEATS, startRun } from '../lib/quickRun';
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
const MEMORY = 'rawstep.run.profiles';

/** The profiles last picked in this browser; a convenience only, so a missing or blocked storage is no matter. */
function remembered(): string[] {
  try { const value = JSON.parse(localStorage.getItem(MEMORY) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
}
function remember(ids: string[]) { try { localStorage.setItem(MEMORY, JSON.stringify(ids)); } catch { /* not kept */ } }

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
 * many runs that makes. Under it, each profile in one line (who, where, which AI), with anything that would stop it. A task holds only
 * what to do; who does it is picked here.
 */
export function RunDialog({ open, onOpenChange, pageProps, taskIds: initialTasks, navigate, onStarted }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { view, busy } = pageProps, config = view.config;
  const [taskIds, setTaskIds] = useState<string[]>(initialTasks);
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  useEffect(() => {
    if (!open) return;
    setTaskIds(initialTasks);
    const kept = remembered().filter(pid => config.profiles.some(p => p.id === pid));
    setProfileIds(kept.length ? kept : config.profiles.slice(0, 1).map(p => p.id));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tasks = config.tasks.filter(task => taskIds.includes(task.id)), profiles = config.profiles.filter(p => profileIds.includes(p.id));
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const total = valid ? tasks.length * profiles.length * count : 0;
  const problems = profiles.flatMap(profile => { const problem = comboProblem(config, view.credentialStatus, profile, profile.mode); return problem ? [{ profile, problem }] : []; });
  const ready = tasks.length > 0 && profiles.length > 0 && valid && !problems.length && !busy;
  const toggle = (list: string[], value: string, on: boolean) => on ? [...list, value] : list.filter(item => item !== value);

  const run = () => void pageProps.act(async () => {
    remember(profileIds);
    const experiment = await startRun(view, { taskIds, profileIds, repeats: count });
    onOpenChange(false);
    onStarted(experiment);
  }, { as: 'start' });

  const names = (items: { name: string }[]) => items.length <= 2 ? items.map(item => item.name).join(', ') : `${items.slice(0, 2).map(item => item.name).join(', ')} ${t('runDialog.more', { count: items.length - 2 })}`;
  const parts: Record<string, ReactNode> = {
    tasks: <Pick label={tasks.length ? names(tasks) : t('runDialog.pickTasks')} title={t('runDialog.tasksTitle')}>
      <ul className="grid max-h-72 gap-0.5 overflow-y-auto">{config.tasks.map(task => <li key={task.id}>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-raised">
          <Checkbox checked={taskIds.includes(task.id)} onCheckedChange={on => setTaskIds(toggle(taskIds, task.id, on === true))} />{task.name}
        </label>
      </li>)}</ul>
    </Pick>,
    profiles: <Pick label={profiles.length ? names(profiles) : t('runDialog.pickProfiles')} title={t('runDialog.profilesTitle')}>
      <ul className="grid max-h-80 gap-0.5 overflow-y-auto">{config.profiles.map(profile => <li key={profile.id}>
        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-raised">
          <Checkbox className="mt-0.5" checked={profileIds.includes(profile.id)} onCheckedChange={on => setProfileIds(toggle(profileIds, profile.id, on === true))} />
          <span className="grid gap-0.5"><span className="text-sm">{profile.name}</span><span className="text-xs leading-5 text-muted-foreground">{profileLine(profile)}</span></span>
        </label>
      </li>)}</ul>
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
      {profiles.length > 0 && <ul aria-label={t('runDialog.profilesTitle')} className="grid gap-1.5 border-t border-edge pt-3">
        {profiles.map(profile => { const problem = problems.find(item => item.profile === profile)?.problem;
          return <li key={profile.id} className="grid gap-0.5 text-[13px] leading-5">
            <span className="font-medium">{profile.name}</span>
            <span className={cn(problem ? 'text-inspect' : 'text-muted-foreground')}>{problem ?? profileLine(profile)}</span>
          </li>; })}
      </ul>}
      {!valid && <p role="status" className="text-xs text-inspect">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>}
      {total > MANY_RUNS && <p role="status" className="text-xs leading-5 text-inspect">{t('runDialog.many', { count: total })}</p>}
      <DialogFooter className="sm:items-center sm:justify-between">
        <Link to={{ view: 'settings', section: 'profiles' }} navigate={change => { onOpenChange(false); navigate(change); }} className="text-[13px] text-trace underline underline-offset-4">{t('runDialog.editProfiles')}</Link>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('runBox.cancel')}</Button>
          <Button type="button" disabled={!ready} onClick={run}><Play aria-hidden="true" />{t('runDialog.run', { count: total })}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** A profile in one line: who uses the page, where it is heard, which AI thinks. */
export function profileLine(profile: Profile): string {
  const who = personaName(profile.mode, personaOf(profile.mode, profile));
  const where = profile.mode === 'screenreader' ? translate(`conditions.backends.${profile.screenReader}`) : translate('runDialog.keyboard');
  return `${who} · ${where} · ${aiSummary(profile, profile.mode)}`;
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
