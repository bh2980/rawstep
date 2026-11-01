import { useMemo, useState } from 'react';
import { Columns2, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { DeleteRunsDialog } from '../components/DeleteRunsDialog';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterMore, FilterSearch, FilterSelect } from '../components/layout/FilterBar';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { MAX_COMPARE } from '../lib/compare';
import { displayState } from '../lib/runStrip';
import { isFinished, isLive, runConditions, taskNameOf, runModelsName, taskRunNumbers, type RunRef } from '../lib/runs';
import type { ListProps } from './types';

const PAGE = 50;
const ALL = '__all__';
/** Outcome filters: what the goal did, plus the runs still going and the runs that ended on an error. */
const outcomes = ['all', 'success', 'failure', 'inconclusive', 'live'] as const;
type Outcome = (typeof outcomes)[number];

/**
 * The run log (spec §31): chronology and density, nothing else. One line of filters (search, task, result, and the rest of the filters behind
 * one button), then run number, time, task, model, result, actions and duration for every run, newest first.
 */
export function RunsPage({ pageProps, runs, navigate, onRun }: ListProps & { onRun: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [task, setTask] = useState(ALL), [model, setModel] = useState(ALL), [outcome, setOutcome] = useState<Outcome>('all'), [shown, setShown] = useState(PAGE);
  const [profile, setProfile] = useState(ALL);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set()), [deleting, setDeleting] = useState(false);
  const { config } = pageProps.view;
  // Profiles are named as each run recorded them, so a filter groups runs by what they ran with, not by today's names.
  const named = useMemo(() => new Map(runs.map(ref => [ref.run.id, runConditions(ref.run, config)])), [runs, config]);
  const of = (ref: RunRef) => named.get(ref.run.id)!;
  const distinct = (key: (ref: RunRef) => string) => [...new Map(runs.map(ref => [key(ref), key(ref)])).entries()];
  const tasks = useMemo(() => [...new Map(runs.map(ref => [ref.run.taskId, taskNameOf(ref.run, config.tasks)])).entries()], [runs, config.tasks]);
  const models = useMemo(() => distinct(ref => runModelsName(ref.run)), [runs]);
  const profiles = useMemo(() => distinct(ref => of(ref).profile), [named]);
  // "Run #n" of each run in its own task, for the number column.
  const numbers = useMemo(() => new Map([...new Set(runs.map(ref => ref.run.taskId))].flatMap(id => [...taskRunNumbers(runs, id)])), [runs]);
  const needle = query.trim().toLowerCase();
  const matching = runs.filter(ref => { const { run } = ref, c = of(ref);
    return (task === ALL || run.taskId === task) && (model === ALL || runModelsName(run) === model)
      && (profile === ALL || c.profile === profile)
      && (!needle || [taskNameOf(run, config.tasks), runModelsName(run), c.profile].some(text => text.toLowerCase().includes(needle)))
      && (outcome === 'all' || (outcome === 'live' ? isLive(run) : isFinished(run) && displayState(run) === outcome)); });
  const options = (items: [string, string][]) => [{ id: ALL, name: t('runList.all') }, ...items.map(([id, name]) => ({ id, name }))];
  const narrow = (apply: () => void) => { apply(); setShown(PAGE); };
  // Only runs that still exist and have ended can be picked, whatever the filters show now.
  const chosen = runs.filter(ref => picked.has(ref.run.id) && !isLive(ref.run));
  // Runs of any task can be set side by side, but not more than fit as columns.
  const canCompare = chosen.length >= 2 && chosen.length <= MAX_COMPARE;
  const toggle = (id: string, on: boolean) => setPicked(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const toggleAll = (on: boolean) => setPicked(current => { const next = new Set(current); for (const { run } of matching.slice(0, shown)) if (!isLive(run)) { if (on) next.add(run.id); else next.delete(run.id); } return next; });
  const remove = () => { setDeleting(false); void pageProps.act(async () => {
    await api('/runs/delete', { method: 'POST', body: { runs: chosen.map(ref => ({ experiment: ref.experiment.id, run: ref.run.id })) } });
    setPicked(new Set()); pageProps.notify(t('runDelete.done', { count: chosen.length }));
  }); };
  return <div className="grid gap-4">
    <PageHeader title={t('runList.title')} meta={t('runList.count', { count: runs.length })}
      actions={<Button size="lg" disabled={config.tasks.length === 0} onClick={onRun}><Play aria-hidden="true" />{t('runList.run')}</Button>} />
    {runs.length > 0 && <FilterBar label={t('runList.filterLabel')}>
      <FilterSearch label={t('runList.search')} value={query} onChange={value => narrow(() => setQuery(value))} placeholder={t('runList.searchPlaceholder')} />
      <FilterSelect label={t('runList.filters.task')} value={task} onChange={value => narrow(() => setTask(value))} options={options(tasks)} className="max-w-44" />
      <FilterSelect label={t('runList.filters.outcome')} value={outcome} onChange={value => narrow(() => setOutcome(value as Outcome))} options={outcomes.map(id => ({ id, name: t(`runList.outcomes.${id}`) }))} />
      <FilterSelect label={t('runConditions.profile')} value={profile} onChange={value => narrow(() => setProfile(value))} options={options(profiles)} className="max-w-44" />
      <FilterMore label={t('runList.filters.more')} active={[model, profile].filter(value => value !== ALL).length}>
        <FilterSelect label={t('runList.filters.model')} value={model} onChange={value => narrow(() => setModel(value))} options={options(models)} className="max-w-44" />
      </FilterMore>
    </FilterBar>}
    {runs.length === 0
      ? <EmptyState title={t('empty.runs.title')} action={<Button asChild variant="outline"><Link to={{ view: 'tasks' }} navigate={navigate}>{t('empty.runs.action')}</Link></Button>} />
      : matching.length === 0
        ? <p className="border-l-2 border-edge-strong pl-4 text-sm text-muted-foreground">{t('runList.noMatch')}</p>
        : <>
          {chosen.length > 0 && <div role="region" aria-label={t('runList.select.count', { count: chosen.length })} className="flex flex-wrap items-center gap-2 border-y border-edge-strong py-1.5 text-[13px]">
            <span className="mr-1 font-medium">{t('runList.select.count', { count: chosen.length })}</span>
            <Button disabled={!canCompare} onClick={() => navigate({ view: 'runs', compare: chosen.map(ref => ref.run.id) })}><Columns2 aria-hidden="true" />{t('runCompare.action')}</Button>
            {!canCompare && <span className="text-xs text-muted-foreground">{chosen.length < 2 ? t('runCompare.needMore') : t('runCompare.tooMany', { max: MAX_COMPARE })}</span>}
            <Button variant="ghost" onClick={() => setPicked(new Set())}>{t('runList.select.clear')}</Button>
            <Button variant="outline" className="ml-auto border-destructive/40 text-destructive hover:text-destructive" disabled={pageProps.busy} onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" />{t('runList.select.delete')}</Button>
          </div>}
          <RunsTable runs={matching.slice(0, shown)} numbers={numbers} config={config} tasks={config.tasks} showConditions navigate={navigate} selection={{ selected: picked, onToggle: toggle, onToggleAll: toggleAll }} />
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('runList.shown', { shown: Math.min(shown, matching.length), total: matching.length })}</span>
            {matching.length > shown && <Button variant="outline" onClick={() => setShown(shown + PAGE)}>{t('runList.more')}</Button>}
          </div>
        </>}
    <DeleteRunsDialog open={deleting} onOpenChange={setDeleting} count={chosen.length} onConfirm={remove} />
  </div>;
}
