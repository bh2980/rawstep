import { useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterSearch, FilterSelect } from '../components/layout/FilterBar';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { displayState } from '../lib/runStrip';
import { isFinished, isLive } from '../lib/runs';
import type { ListProps } from './types';

const PAGE = 50;
const ALL = '__all__';
/** Outcome filters: what the goal did, plus the runs still going and the runs that ended on an error. */
const outcomes = ['all', 'success', 'failure', 'inconclusive', 'live'] as const;
type Outcome = (typeof outcomes)[number];

/**
 * The run log (spec §31): chronology and density, nothing else. One line of filters, then time, task, model, mode, result, actions
 * and duration for every run, newest first.
 */
export function RunsPage({ pageProps, runs, navigate, onCompare }: ListProps & { onCompare: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [task, setTask] = useState(ALL), [model, setModel] = useState(ALL), [outcome, setOutcome] = useState<Outcome>('all'), [shown, setShown] = useState(PAGE);
  const { config } = pageProps.view;
  const tasks = useMemo(() => [...new Map(runs.map(ref => [ref.run.taskId, ref.run.snapshot.taskName])).entries()], [runs]);
  const models = useMemo(() => [...new Map(runs.map(ref => [ref.run.modelId, ref.run.snapshot.model.name])).entries()], [runs]);
  const needle = query.trim().toLowerCase();
  const matching = runs.filter(({ run }) => (task === ALL || run.taskId === task) && (model === ALL || run.modelId === model)
    && (!needle || run.snapshot.taskName.toLowerCase().includes(needle) || run.snapshot.model.name.toLowerCase().includes(needle))
    && (outcome === 'all' || (outcome === 'live' ? isLive(run) : isFinished(run) && displayState(run) === outcome)));
  const options = (items: [string, string][]) => [{ id: ALL, name: t('runList.all') }, ...items.map(([id, name]) => ({ id, name }))];
  const narrow = (apply: () => void) => { apply(); setShown(PAGE); };
  return <div className="grid gap-4">
    <PageHeader title={t('runList.title')} description={t('runList.count', { count: runs.length })}
      actions={<Button size="xl" disabled={config.tasks.length === 0} onClick={onCompare}><ListFilter aria-hidden="true" />{t('runList.compare')}</Button>} />
    {runs.length > 0 && <FilterBar label={t('runList.filterLabel')}>
      <FilterSearch label={t('runList.search')} value={query} onChange={value => narrow(() => setQuery(value))} placeholder={t('runList.searchPlaceholder')} />
      <FilterSelect label={t('runList.filters.task')} value={task} onChange={value => narrow(() => setTask(value))} options={options(tasks)} className="max-w-44" />
      <FilterSelect label={t('runList.filters.model')} value={model} onChange={value => narrow(() => setModel(value))} options={options(models)} className="max-w-44" />
      <FilterSelect label={t('runList.filters.outcome')} value={outcome} onChange={value => narrow(() => setOutcome(value as Outcome))} options={outcomes.map(id => ({ id, name: t(`runList.outcomes.${id}`) }))} />
    </FilterBar>}
    {runs.length === 0
      ? <EmptyState title={t('empty.runs.title')} why={t('empty.runs.why')} action={<Button asChild variant="outline"><Link to={{ view: 'tasks' }} navigate={navigate}>{t('empty.runs.action')}</Link></Button>} />
      : matching.length === 0
        ? <p className="border-l-2 border-edge-strong pl-4 text-sm text-muted-foreground">{t('runList.noMatch')}</p>
        : <>
          <RunsTable runs={matching.slice(0, shown)} profiles={config.profiles} navigate={navigate} />
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('runList.shown', { shown: Math.min(shown, matching.length), total: matching.length })}</span>
            {matching.length > shown && <Button variant="outline" onClick={() => setShown(shown + PAGE)}>{t('runList.more')}</Button>}
          </div>
        </>}
  </div>;
}
