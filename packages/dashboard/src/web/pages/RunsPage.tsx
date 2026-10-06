import { useMemo, useState } from 'react';
import { ListFilter, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { DeleteRunsDialog } from '../components/DeleteRunsDialog';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterSearch, FilterSelect } from '../components/layout/FilterBar';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { displayState } from '../lib/runStrip';
import { isFinished, isLive, runConditions, taskNameOf, runModelsName, type RunRef } from '../lib/runs';
import type { ListProps } from './types';

const PAGE = 50;
const ALL = '__all__';
/** Outcome filters: what the goal did, plus the runs still going and the runs that ended on an error. */
const outcomes = ['all', 'success', 'failure', 'inconclusive', 'live'] as const;
type Outcome = (typeof outcomes)[number];

/**
 * The run log (spec §31): chronology and density, nothing else. One line of filters (task, structure, models, model combo, action set,
 * environment, result), then time, task, model, mode, result, actions and duration for every run, newest first.
 */
export function RunsPage({ pageProps, runs, navigate, onCompare }: ListProps & { onCompare: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [task, setTask] = useState(ALL), [model, setModel] = useState(ALL), [outcome, setOutcome] = useState<Outcome>('all'), [shown, setShown] = useState(PAGE);
  const [structure, setStructure] = useState(ALL), [combo, setCombo] = useState(ALL), [actionSet, setActionSet] = useState(ALL), [environment, setEnvironment] = useState(ALL);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set()), [deleting, setDeleting] = useState(false);
  const { config } = pageProps.view;
  // Conditions are named as each run recorded them, so a filter groups runs by what they ran under, not by today's names.
  const named = useMemo(() => new Map(runs.map(ref => [ref.run.id, runConditions(ref.run, config)])), [runs, config]);
  const of = (ref: RunRef) => named.get(ref.run.id)!;
  const environmentOf = (ref: RunRef) => { const c = of(ref); return c.mode === 'screenreader' ? `${c.pageEnvironment} · ${c.atEnvironment}` : c.pageEnvironment; };
  const distinct = (key: (ref: RunRef) => string) => [...new Map(runs.map(ref => [key(ref), key(ref)])).entries()];
  const tasks = useMemo(() => [...new Map(runs.map(ref => [ref.run.taskId, taskNameOf(ref.run, config.tasks)])).entries()], [runs, config.tasks]);
  const models = useMemo(() => distinct(ref => runModelsName(ref.run)), [runs]);
  const combos = useMemo(() => distinct(ref => of(ref).combo), [named]), actionSets = useMemo(() => distinct(ref => of(ref).actionSet), [named]), environments = useMemo(() => distinct(environmentOf), [named]);
  const needle = query.trim().toLowerCase();
  const matching = runs.filter(ref => { const { run } = ref, c = of(ref);
    return (task === ALL || run.taskId === task) && (model === ALL || runModelsName(run) === model) && (structure === ALL || c.structure === structure)
      && (combo === ALL || c.combo === combo) && (actionSet === ALL || c.actionSet === actionSet) && (environment === ALL || environmentOf(ref) === environment)
      && (!needle || [taskNameOf(run, config.tasks), runModelsName(run), c.combo, c.actionSet].some(text => text.toLowerCase().includes(needle)))
      && (outcome === 'all' || (outcome === 'live' ? isLive(run) : isFinished(run) && displayState(run) === outcome)); });
  const options = (items: [string, string][]) => [{ id: ALL, name: t('runList.all') }, ...items.map(([id, name]) => ({ id, name }))];
  const narrow = (apply: () => void) => { apply(); setShown(PAGE); };
  // Only runs that still exist and have ended can be picked, whatever the filters show now.
  const chosen = runs.filter(ref => picked.has(ref.run.id) && !isLive(ref.run));
  const toggle = (id: string, on: boolean) => setPicked(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const toggleAll = (on: boolean) => setPicked(current => { const next = new Set(current); for (const { run } of matching.slice(0, shown)) if (!isLive(run)) { if (on) next.add(run.id); else next.delete(run.id); } return next; });
  const remove = () => { setDeleting(false); void pageProps.act(async () => {
    await api('/runs/delete', { method: 'POST', body: { runs: chosen.map(ref => ({ experiment: ref.experiment.id, run: ref.run.id })) } });
    setPicked(new Set()); pageProps.notify(t('runDelete.done', { count: chosen.length }));
  }); };
  return <div className="grid gap-4">
    <PageHeader title={t('runList.title')} description={t('runList.count', { count: runs.length })}
      actions={<Button size="xl" disabled={config.tasks.length === 0} onClick={onCompare}><ListFilter aria-hidden="true" />{t('runList.compare')}</Button>} />
    {runs.length > 0 && <FilterBar label={t('runList.filterLabel')}>
      <FilterSearch label={t('runList.search')} value={query} onChange={value => narrow(() => setQuery(value))} placeholder={t('runList.searchPlaceholder')} />
      <FilterSelect label={t('runList.filters.task')} value={task} onChange={value => narrow(() => setTask(value))} options={options(tasks)} className="max-w-44" />
      <FilterSelect label={t('runConditions.structure')} value={structure} onChange={value => narrow(() => setStructure(value))} options={options([['solo', t('runConditions.structures.solo')], ['planned', t('runConditions.structures.planned')]])} />
      <FilterSelect label={t('runList.filters.model')} value={model} onChange={value => narrow(() => setModel(value))} options={options(models)} className="max-w-44" />
      <FilterSelect label={t('runConditions.combo')} value={combo} onChange={value => narrow(() => setCombo(value))} options={options(combos)} className="max-w-44" />
      <FilterSelect label={t('runConditions.actionSet')} value={actionSet} onChange={value => narrow(() => setActionSet(value))} options={options(actionSets)} className="max-w-44" />
      <FilterSelect label={t('runConditions.environment')} value={environment} onChange={value => narrow(() => setEnvironment(value))} options={options(environments)} className="max-w-44" />
      <FilterSelect label={t('runList.filters.outcome')} value={outcome} onChange={value => narrow(() => setOutcome(value as Outcome))} options={outcomes.map(id => ({ id, name: t(`runList.outcomes.${id}`) }))} />
    </FilterBar>}
    {runs.length === 0
      ? <EmptyState title={t('empty.runs.title')} why={t('empty.runs.why')} action={<Button asChild variant="outline"><Link to={{ view: 'tasks' }} navigate={navigate}>{t('empty.runs.action')}</Link></Button>} />
      : matching.length === 0
        ? <p className="border-l-2 border-edge-strong pl-4 text-sm text-muted-foreground">{t('runList.noMatch')}</p>
        : <>
          {chosen.length > 0 && <div role="region" aria-label={t('runList.select.count', { count: chosen.length })} className="flex flex-wrap items-center gap-2 border-y border-edge-strong py-2 text-sm">
            <span className="mr-1 font-medium">{t('runList.select.count', { count: chosen.length })}</span>
            <Button variant="outline" disabled={pageProps.busy} onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" />{t('runList.select.delete')}</Button>
            <Button variant="ghost" onClick={() => setPicked(new Set())}>{t('runList.select.clear')}</Button>
          </div>}
          <RunsTable runs={matching.slice(0, shown)} config={config} tasks={config.tasks} showConditions navigate={navigate} selection={{ selected: picked, onToggle: toggle, onToggleAll: toggleAll }} />
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('runList.shown', { shown: Math.min(shown, matching.length), total: matching.length })}</span>
            {matching.length > shown && <Button variant="outline" onClick={() => setShown(shown + PAGE)}>{t('runList.more')}</Button>}
          </div>
        </>}
    <DeleteRunsDialog open={deleting} onOpenChange={setDeleting} count={chosen.length} onConfirm={remove} />
  </div>;
}
