import { useId, useState } from 'react';
import { Copy, Pencil, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { taskProfile, type Mode, type Profile, type ProjectConfig } from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { comboModesOf, comboSummary, environmentViewport } from '../lib/conditions';
import { QUICK_RUN_REPEATS, comboProblem, type RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { profileBlocker } from '../pages/settings/ProfileSettings';
import { InfoTip } from './layout/InfoTip';
import { Link } from './Link';
import { ProfileEditor } from './ProfileEditor';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet';

const MAX_REPEATS = 20;

/** The modes the task's profile can run, and the one in use: the picked mode while the profile supports it, else its first. */
export function taskMode(config: ProjectConfig, taskId: string, picked: Mode | undefined): { mode: Mode; modes: Mode[] } {
  const task = config.tasks.find(item => item.id === taskId);
  const modes = task ? comboModesOf(taskProfile(config, task), config.connections) : [];
  return { modes, mode: picked && (modes.includes(picked) || !modes.length) ? picked : modes[0] ?? 'screenreader' };
}

type BarProps = {
  pageProps: PageProps; taskId: string;
  /** Runs of this task that are queued or running. */
  active: RunRef[];
  picked: Mode | undefined; onMode: (mode: Mode) => void;
  onRun: (options: RunOptions) => void;
  navigate: (change: RouteChange) => void;
};

/**
 * The task's primary action: the mode, how many times, and 실행. What would stop a run (a missing model or key) is said under it with
 * the place to fix it, and runs still going are linked. The element has the id `task-run-control` so an empty state can send a person here.
 */
export function RunBar({ pageProps, taskId, active, picked, onMode, onRun, navigate }: BarProps) {
  const { t } = useTranslation();
  const id = useId();
  const { view, busy } = pageProps, config = view.config, task = config.tasks.find(item => item.id === taskId);
  const [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  if (!task) return null;
  const profile = taskProfile(config, task);
  const { mode, modes } = taskMode(config, taskId, picked);
  const problem = comboProblem(config, view.credentialStatus, profile, mode);
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const keyProblem = problem === t('runBox.problem.noKey') || problem === t('runBox.problem.noPlannerKey');
  const newest = active[0];
  return <form id="task-run-control" aria-label={t('runBox.title')} className="grid justify-items-end gap-1.5"
    onSubmit={event => { event.preventDefault(); if (!problem && valid && !busy) onRun({ mode, repeats: count }); }}>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div role="group" aria-label={t('runBox.mode')} className="inline-flex h-9 overflow-hidden rounded-md border border-edge-strong text-[13px]">
        {(['screenreader', 'keyboard'] as const).map(value => { const can = modes.includes(value);
          return <button key={value} type="button" aria-pressed={mode === value} disabled={!can && modes.length > 0} title={can ? undefined : t('runBox.modeUnsupported', { mode: t(`sidebar.modes.${value}`) })}
            onClick={() => onMode(value)} className={cn('border-r border-edge-strong px-3 last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50', mode === value ? 'bg-trace-soft font-medium text-trace' : 'bg-surface text-muted-foreground hover:bg-raised')}>
            {t(`sidebar.modes.${value}`)}
          </button>; })}
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id + '-repeats'} className="text-[13px] font-normal text-muted-foreground">{t('runBox.repeats')}</Label>
        <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} className="h-9 w-14" value={repeats} title={t('runBox.repeatsHint', { max: MAX_REPEATS })} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)} />
      </div>
      <Button type="submit" size="lg" className="px-4" disabled={busy || !!problem || !valid}><Play aria-hidden="true" />{t('runBox.run')}</Button>
    </div>
    {problem && <p role="status" className="max-w-md text-right text-xs leading-5 text-inspect">
      {problem} <Link to={{ view: 'settings', section: keyProblem ? 'connections' : 'profiles' }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.fix')}</Link>
    </p>}
    {!valid && <p role="status" className="text-xs leading-5 text-inspect">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>}
    {newest && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: newest.run.taskId, run: newest.run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
  </form>;
}

/**
 * The run profile the task runs with, as one line under its title: a profile picker (saved at once), what the profile does in a few
 * words, and 프로필 편집, which opens the profile in a side sheet. A profile is shared by the tasks that pick it, so the sheet says how
 * many it changes, and 복제해서 이 작업에 can split a copy off for this task.
 */
export function RunConditions({ pageProps, taskId, picked, navigate }: { pageProps: PageProps; taskId: string; picked: Mode | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [editing, setEditing] = useState<Profile>();
  const { view, busy } = pageProps, config = view.config, task = config.tasks.find(item => item.id === taskId);
  if (!task) return null;
  const profile = taskProfile(config, task), { mode } = taskMode(config, taskId, picked);
  const sharing = config.tasks.filter(other => (other.profileId ?? config.profiles[0]?.id) === profile.id).length;
  const inputNames = Object.keys((view.tasks[taskId] as { input?: Record<string, unknown> } | undefined)?.input ?? {});
  const pick = (profileId: string) => void pageProps.act(async () => {
    const tasks = config.tasks.map(item => item.id === taskId ? { ...item, profileId } : item);
    await pageProps.save({ ...config, tasks }, undefined, view.revision);
  });
  const saveProfile = (next: Profile, asCopy: boolean) => void pageProps.act(async () => {
    const latest = pageProps.view.config;
    const profiles = asCopy ? [...latest.profiles, next] : latest.profiles.map(item => item.id === next.id ? next : item);
    const tasks = asCopy ? latest.tasks.map(item => item.id === taskId ? { ...item, profileId: next.id } : item) : latest.tasks;
    await pageProps.save({ ...latest, profiles, tasks }, undefined, pageProps.view.revision);
    setEditing(undefined);
  });
  const { width, height } = environmentViewport(profile.page, view.environmentPresets);
  const facts = [comboSummary(profile, config.connections, mode), `${width} × ${height}`, ...(mode === 'screenreader' ? [t(`conditions.backends.${profile.screenReader}`)] : [])];
  const blocked = editing && profileBlocker(editing);
  const changed = editing && JSON.stringify(editing) !== JSON.stringify(profile);
  return <section aria-labelledby={id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface px-3 py-2">
    <Label id={id} htmlFor={id + '-profile'} className="flex items-center gap-1 text-[13px] font-semibold">{t('runBox.profile')}<InfoTip term={t('runBox.profile')}>{t('runBox.profileInfo')}</InfoTip></Label>
    <Select value={profile.id} onValueChange={pick} disabled={busy}>
      <SelectTrigger id={id + '-profile'} size="sm" className="h-8 w-auto min-w-36 font-medium"><SelectValue /></SelectTrigger>
      <SelectContent>{config.profiles.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
    </Select>
    <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={facts.join(' · ')}>{facts.join(' · ')}</p>
    <Button variant="outline" size="sm" onClick={() => setEditing(structuredClone(profile))}><Pencil aria-hidden="true" />{t('runBox.editProfile')}</Button>
    <Sheet open={!!editing} onOpenChange={open => { if (!open) setEditing(undefined); }}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-2xl" aria-describedby={id + '-sheet-note'}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-lg">{t('runBox.sheetTitle', { name: profile.name })}</SheetTitle>
          <SheetDescription id={id + '-sheet-note'}>{sharing > 1 ? t('runBox.sharedBy', { count: sharing }) : t('runBox.onlyThis')}</SheetDescription>
        </SheetHeader>
        {editing && <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mb-6 grid max-w-md gap-1.5">
            <Label htmlFor={id + '-name'}>{t('profile.name')}</Label>
            <Input id={id + '-name'} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
          </div>
          <ProfileEditor compact profile={editing} onChange={setEditing} view={view} inputNames={inputNames} />
        </div>}
        <SheetFooter className="border-t sm:flex-row sm:items-center sm:justify-between">
          <p role="status" className={cn('text-xs leading-5', blocked ? 'text-inspect' : 'text-muted-foreground')}>{blocked ?? (changed ? t('saveBar.unsaved') : '')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>{t('runBox.cancel')}</Button>
            <Button type="button" variant="outline" disabled={busy || !editing || !!blocked}
              onClick={() => editing && saveProfile({ ...editing, id: crypto.randomUUID(), name: editing.name === profile.name ? t('profile.copyName', { name: profile.name }) : editing.name }, true)}>
              <Copy aria-hidden="true" />{t('runBox.saveAsCopy')}
            </Button>
            <Button type="button" disabled={busy || !changed || !!blocked} onClick={() => editing && saveProfile(editing, false)}>{t('runBox.save')}</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </section>;
}
