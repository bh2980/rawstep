import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { executorModel, isFilePlanner, taskProfile, type AtBackend, type Mode, type Profile } from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { AT_BACKENDS, comboModesOf } from '../lib/conditions';
import { personaOf, PERSONAS, withPersona } from '../lib/persona';
import { QUICK_RUN_REPEATS, comboProblem, type RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { profileBlocker } from '../pages/settings/ProfileSettings';
import { Link } from './Link';
import { ProfileEditor, stopSummary, type Question } from './ProfileEditor';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const MAX_REPEATS = 20;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The mode a task runs in: the one its file names while the profile can run it, else the profile's first. */
export function savedMode(pageProps: Pick<PageProps, 'view'>, taskId: string): Mode {
  const { config } = pageProps.view, task = config.tasks.find(item => item.id === taskId);
  const modes = task ? comboModesOf(taskProfile(config, task), config.connections) : [];
  const named = record(pageProps.view.tasks[taskId]).mode;
  return named === 'keyboard' || named === 'screenreader' ? named : modes[0] ?? 'screenreader';
}

type Props = {
  pageProps: PageProps; taskId: string;
  /** Runs of this task that are queued or running. */
  active: RunRef[];
  onRun: (options: RunOptions) => void;
  navigate: (change: RouteChange) => void;
};

/**
 * How the task's next run goes, as one sentence a person can read and change in place: who uses the page, on which screen reader, with
 * which AI thinking, how many times. Under it, the profile it comes from and the stop rules worth a glance; 모든 설정 opens every field
 * of the profile as four questions. Changes stay a draft until they are applied to this task alone or saved to the shared profile.
 */
export function RunSetup({ pageProps, taskId, active, onRun, navigate }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { view, busy } = pageProps, config = view.config, task = config.tasks.find(item => item.id === taskId);
  const saved = task ? taskProfile(config, task) : undefined, savedJson = JSON.stringify(saved ?? null), mode0 = savedMode(pageProps, taskId);
  const [draft, setDraft] = useState<Profile | undefined>(() => saved && structuredClone(saved));
  const [mode, setMode] = useState<Mode>(mode0);
  const [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  const [expanded, setExpanded] = useState(false), [open, setOpen] = useState<Question[]>([]);
  // A profile or mode saved elsewhere (another window, the settings page) replaces an untouched draft.
  useEffect(() => { setDraft(saved && structuredClone(saved)); }, [savedJson]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMode(mode0); }, [mode0]);
  if (!task || !saved || !draft) return null;

  const sharing = config.tasks.filter(other => (other.profileId ?? config.profiles[0]?.id) === saved.id).length;
  const profileChanged = JSON.stringify(draft) !== savedJson, modeChanged = mode !== mode0, dirty = profileChanged || modeChanged;
  const blocked = profileChanged ? profileBlocker(draft) : undefined;
  const problem = comboProblem(config, view.credentialStatus, draft, mode);
  const keyProblem = problem === t('runBox.problem.noKey') || problem === t('runBox.problem.noPlannerKey');
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const persona = personaOf(mode, draft);
  const showAll = (question?: Question) => { setExpanded(true); if (question) setOpen(current => current.includes(question) ? current : [...current, question]); };

  /** Saves the draft: the profile in place (every task using it), or as a copy only this task uses; and the task's mode. */
  const apply = (asCopy: boolean) => void pageProps.act(async () => {
    const latest = pageProps.view.config;
    const profile = asCopy ? { ...draft, id: crypto.randomUUID(), name: draft.name === saved.name ? t('runSetup.copyName', { task: task.name }) : draft.name } : draft;
    const profiles = !profileChanged ? latest.profiles : asCopy ? [...latest.profiles, profile] : latest.profiles.map(item => item.id === profile.id ? profile : item);
    const tasks = profileChanged && asCopy ? latest.tasks.map(item => item.id === taskId ? { ...item, profileId: profile.id } : item) : latest.tasks;
    const taskWrite = modeChanged ? { file: task.file, task: { ...record(pageProps.view.tasks[taskId]), mode } } : undefined;
    await pageProps.save({ ...latest, profiles, tasks }, taskWrite, pageProps.view.revision);
    pageProps.notify(t('runSetup.applied'));
  });
  const switchProfile = (profileId: string) => void pageProps.act(async () => {
    await pageProps.save({ ...config, tasks: config.tasks.map(item => item.id === taskId ? { ...item, profileId } : item) }, undefined, view.revision);
  });
  const discard = () => { setDraft(structuredClone(saved)); setMode(mode0); };

  const ai = aiName(draft, mode);
  const sentence = mode === 'keyboard'
    ? t('runSetup.sentence.keyboard')
    : draft.structure === 'planned' ? t('runSetup.sentence.planned') : t('runSetup.sentence.solo');
  const parts: Record<string, ReactNode> = {
    who: <Pick label={t(`persona.${persona}.short`)} title={t('runSetup.pickWho')}>
      {close => <div role="radiogroup" aria-label={t('persona.label')} className="grid gap-1">
        {PERSONAS.map(item => <button key={item} type="button" role="radio" aria-checked={persona === item}
          onClick={() => { const next = withPersona(draft, item); setDraft(next.profile); setMode(next.mode); close(); }}
          className={cn('grid rounded-md px-3 py-2 text-left hover:bg-raised', persona === item && 'bg-trace-soft')}>
          <span className={cn('text-sm', persona === item && 'font-medium text-trace')}>{t(`persona.${item}.name`)}</span>
          <span className="text-xs leading-5 text-muted-foreground">{t(`persona.${item}.hint`)}</span>
        </button>)}
        <button type="button" onClick={() => { close(); showAll('who'); }} className="rounded-md px-3 py-2 text-left text-[13px] text-trace hover:bg-raised">{t('runSetup.pickActions')}</button>
      </div>}
    </Pick>,
    where: <Pick label={t(`conditions.backends.${draft.screenReader}`)} title={t('runSetup.pickWhere')}>
      {close => <div role="radiogroup" aria-label={t('runSetup.pickWhere')} className="grid gap-1">
        {AT_BACKENDS.map((backend: AtBackend) => <button key={backend} type="button" role="radio" aria-checked={draft.screenReader === backend}
          onClick={() => { setDraft({ ...draft, screenReader: backend }); close(); }}
          className={cn('grid rounded-md px-3 py-2 text-left hover:bg-raised', draft.screenReader === backend && 'bg-trace-soft')}>
          <span className={cn('text-sm', draft.screenReader === backend && 'font-medium text-trace')}>{t(`conditions.backends.${backend}`)}</span>
          <span className="text-xs leading-5 text-muted-foreground">{t(`conditions.atEnv.hints.${backend}`)}</span>
        </button>)}
      </div>}
    </Pick>,
    ai: <button type="button" onClick={() => showAll('ai')} className={pickClass}>{ai ?? t('runSetup.pickAi')}</button>,
    times: <span className="inline-flex items-baseline">
      <label htmlFor={id + '-repeats'} className="sr-only">{t('runBox.repeats')}</label>
      <input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} value={repeats} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)}
        className="w-7 [appearance:textfield] border-0 border-b-[1.5px] border-dashed border-muted-foreground bg-transparent p-0 text-center font-medium tabular-nums focus-visible:outline-2 [&::-webkit-inner-spin-button]:appearance-none" />
    </span>,
  };

  const stops = stopSummary(draft, mode);
  return <section id="task-run-control" aria-labelledby={id} className="grid gap-3 rounded-lg border border-edge-strong bg-surface px-4 py-3">
    <h2 id={id} className="sr-only">{t('runSetup.title')}</h2>
    <p className="text-[16.5px] leading-9">{fill(sentence, parts)}</p>

    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <label htmlFor={id + '-profile'}>{t('runSetup.profile')}</label>
        <Select value={saved.id} onValueChange={switchProfile} disabled={busy}>
          <SelectTrigger id={id + '-profile'} size="sm" className="h-7 w-auto min-w-32 font-medium text-foreground"><SelectValue /></SelectTrigger>
          <SelectContent>{config.profiles.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {sharing > 1 && <span>{t('runSetup.sharedBy', { count: sharing })}</span>}
      </span>
      <span aria-hidden="true">·</span>
      <span>{stops.map((part, index) => <span key={part.text}>{index > 0 && ' · '}<span className={part.changed ? 'text-trace' : undefined}>{part.text}</span></span>)}</span>
      <button type="button" aria-expanded={expanded} aria-controls={id + '-all'} onClick={() => setExpanded(!expanded)} className="inline-flex items-center gap-0.5 rounded-sm text-trace hover:underline">
        {t('runSetup.allSettings')}<ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
      </button>
    </div>

    {expanded && <div id={id + '-all'} className="border-t border-edge pt-1">
      <ProfileEditor key={open.join()} profile={draft} onChange={setDraft} view={view} mode={mode} onMode={setMode} open={open}
        inputNames={Object.keys(record(record(view.tasks[taskId]).input))} />
    </div>}

    <div className="flex flex-wrap items-center justify-end gap-2">
      {dirty && <p role="status" className={cn('mr-auto text-xs leading-5', blocked ? 'text-inspect' : 'text-trace')}>{blocked ?? t('runSetup.unsaved')}</p>}
      {dirty && <Button type="button" variant="ghost" size="sm" onClick={discard}>{t('runSetup.discard')}</Button>}
      {dirty && profileChanged && sharing > 1 && <Button type="button" variant="outline" size="sm" disabled={busy || !!blocked} onClick={() => apply(true)}>{t('runSetup.applyHere')}</Button>}
      {dirty && <Button type="button" variant="outline" size="sm" disabled={busy || !!blocked} onClick={() => apply(false)}>
        {profileChanged && sharing > 1 ? t('runSetup.saveShared', { count: sharing }) : t('runSetup.save')}
      </Button>}
      <Button type="button" data-run disabled={busy || dirty || !!problem || !valid} title={dirty ? t('runSetup.applyFirst') : undefined}
        onClick={() => onRun({ mode, repeats: count })}><Play aria-hidden="true" />{t('runBox.run')}</Button>
    </div>
    {problem && !dirty && <p role="status" className="text-right text-xs leading-5 text-inspect">
      {problem} <Link to={{ view: 'settings', section: keyProblem ? 'connections' : 'profiles' }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.fix')}</Link>
    </p>}
    {!valid && <p role="status" className="text-right text-xs leading-5 text-inspect">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>}
    {active[0] && <p role="status" className="text-right text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: active[0].run.taskId, run: active[0].run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
  </section>;
}

const pickClass = 'rounded-sm font-medium whitespace-nowrap underline decoration-muted-foreground decoration-dashed decoration-[1.5px] underline-offset-[5px] hover:decoration-foreground focus-visible:outline-2';

/** The model a person thinks of as "the AI" of a run: the planner when the run plans, else the executor of the mode. */
function aiName(profile: Profile, mode: Mode): string | undefined {
  if (profile.structure === 'planned' && mode === 'screenreader') return isFilePlanner(profile.planner) ? profile.planner.planFile : profile.planner?.modelId.trim() || undefined;
  return executorModel(profile, mode)?.modelId.trim() || undefined;
}

/** A dashed, clickable part of the sentence that opens a small chooser. */
function Pick({ label, title, children }: { label: string; title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className={pickClass} aria-label={`${title}: ${label}`}>{label}</button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 p-1.5">{children(() => setOpen(false))}</PopoverContent>
  </Popover>;
}

/** A sentence template with %who%-style slots filled by elements. */
function fill(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(%\w+%)/).map((piece, index) => {
    const slot = /^%(\w+)%$/.exec(piece)?.[1];
    return slot && slot in parts ? <span key={index}>{parts[slot]}</span> : <span key={index}>{piece}</span>;
  });
}
