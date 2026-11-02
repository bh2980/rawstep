import { useMemo, useState } from 'react';
import { ChevronDown, Columns2, Download, Play, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { DeleteRunsDialog } from '../components/DeleteRunsDialog';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterSearch } from '../components/layout/FilterBar';
import { PageHeader } from '../components/PageHeader';
import { Link } from '../components/Link';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { pageFindingCounts } from '../hooks/useHintSummaries';
import { exportName, runEndingCode, runFolder, runsCsv, type RunExportRow } from '../lib/batchSummary';
import { downloadText } from '../lib/download';
import { MAX_COMPARE } from '../lib/compare';
import { formatClockTime, formatDate } from '../lib/format';
import { runStatus, type RunStatus } from '../lib/runStrip';
import { activeTag, hasTag, projectTags } from '../lib/tags';
import { cn } from '../lib/utils';
import { isLive, runConditions, runStartedAt, runStepCount, taskNameOf, runModelsName, taskRunNumbers, type RunRef } from '../lib/runs';
import type { ListProps } from './types';

const PAGE = 50;
const ALL = '__all__';
/** Result filters: how a run ended (the status marks' names), plus the runs still going. */
const outcomes = ['all', 'reached', 'gave-up', 'mistaken', 'unmeasured', 'error', 'live'] as const;
type Outcome = (typeof outcomes)[number];
const matchesOutcome = (ref: RunRef, outcome: Outcome) => outcome === 'all' || (outcome === 'live' ? isLive(ref.run) : runStatus(ref.run).status === (outcome satisfies RunStatus));

/**
 * The run log (spec §31): chronology and density. One line of filters, then one table where each batch is a header row above its
 * runs, newest first. Picking runs swaps the filter line for what can be done with them: compare, export, delete.
 */
export function RunsPage({ pageProps, runs, navigate, onRun }: ListProps & { onRun: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [task, setTask] = useState(ALL), [model, setModel] = useState(ALL), [outcome, setOutcome] = useState<Outcome>('all'), [shown, setShown] = useState(PAGE);
  const [profile, setProfile] = useState(ALL), [chosenTag, setTag] = useState(ALL);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set()), [deleting, setDeleting] = useState(false), [exporting, setExporting] = useState(false);
  const { config } = pageProps.view;
  // Profiles are named as each run recorded them, so a filter groups runs by what they ran with, not by today's names.
  const named = useMemo(() => new Map(runs.map(ref => [ref.run.id, runConditions(ref.run, config)])), [runs, config]);
  const of = (ref: RunRef) => named.get(ref.run.id)!;
  const distinct = (key: (ref: RunRef) => string) => [...new Map(runs.map(ref => [key(ref), key(ref)])).entries()];
  const tasks = useMemo(() => [...new Map(runs.map(ref => [ref.run.taskId, taskNameOf(ref.run, config.tasks)])).entries()], [runs, config.tasks]);
  const models = useMemo(() => distinct(ref => runModelsName(ref.run)), [runs]);
  const profiles = useMemo(() => distinct(ref => of(ref).profile), [named]);
  const batchCount = useMemo(() => new Set(runs.map(ref => ref.experiment.id)).size, [runs]);
  // "Run #n" of each run in its own task.
  const numbers = useMemo(() => new Map([...new Set(runs.map(ref => ref.run.taskId))].flatMap(id => [...taskRunNumbers(runs, id)])), [runs]);
  const totals = useMemo(() => { const count = new Map<string, number>(); for (const ref of runs) if (numbers.has(ref.run.id)) count.set(ref.run.taskId, (count.get(ref.run.taskId) ?? 0) + 1); return count; }, [runs, numbers]);
  // Runs are filtered by the tags their task has now, not by the tags it had when they ran.
  const projectTagList = useMemo(() => projectTags(config.tasks), [config.tasks]), tag = activeTag(chosenTag, ALL, config.tasks);
  const needle = query.trim().toLowerCase();
  const matching = runs.filter(ref => { const { run } = ref, c = of(ref);
    return (task === ALL || run.taskId === task) && hasTag(config.tasks.find(entry => entry.id === run.taskId), tag) && (model === ALL || runModelsName(run) === model)
      && (profile === ALL || c.profile === profile)
      && (!needle || [taskNameOf(run, config.tasks), runModelsName(run), c.profile, ref.experiment.request.note ?? ''].some(text => text.toLowerCase().includes(needle)))
      && matchesOutcome(ref, outcome); });
  const options = (items: [string, string][]) => [{ id: ALL, name: t('runList.all') }, ...items.map(([id, name]) => ({ id, name }))];
  const narrow = (apply: () => void) => { apply(); setShown(PAGE); };
  // Only runs that still exist and have ended can be picked, whatever the filters show now.
  const chosen = runs.filter(ref => picked.has(ref.run.id) && !isLive(ref.run));
  // Runs of any task can be set side by side, but not more than fit as columns.
  const canCompare = chosen.length >= 2 && chosen.length <= MAX_COMPARE;
  const toggle = (id: string, on: boolean) => setPicked(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const toggleAll = (on: boolean) => setPicked(current => { const next = new Set(current); for (const { run } of matching.slice(0, shown)) if (!isLive(run)) { if (on) next.add(run.id); else next.delete(run.id); } return next; });
  // The CSV of the picked runs, or of every run the filters show when none is picked: one row each, with the page findings counted
  // from each run's hints (read now, a few at a time).
  const exportRuns = async () => {
    const list = chosen.length ? chosen : matching.filter(ref => !isLive(ref.run));
    setExporting(true);
    try {
      const counts = await pageFindingCounts(list.map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })));
      const rows: RunExportRow[] = list.map(ref => ({
        task: taskNameOf(ref.run, config.tasks), profile: of(ref).profile, run: numbers.get(ref.run.id), date: new Date(runStartedAt(ref)).toISOString(),
        ending: runEndingCode(ref.run), moves: runStepCount(ref.run), pageFindings: counts.get(ref.run.id), folder: runFolder(ref.experiment.id, ref.run.id),
      }));
      const name = exportName('rawstep-runs', undefined, 'csv');
      downloadText(name, runsCsv(rows), 'text/csv');
      pageProps.notify(t('runExport.done', { count: rows.length, name }));
    } finally { setExporting(false); }
  };
  const remove = () => { setDeleting(false); void pageProps.act(async () => {
    await api('/runs/delete', { method: 'POST', body: { runs: chosen.map(ref => ({ experiment: ref.experiment.id, run: ref.run.id })) } });
    setPicked(new Set()); pageProps.notify(t('runDelete.done', { count: chosen.length }));
  }); };
  const times = runs.map(runStartedAt), first = Math.min(...times), last = Math.max(...times);
  const range = runs.length === 0 ? undefined : formatDate(first) === formatDate(last) ? formatDate(first)
    : t('runList.range', { from: formatDate(first), to: new Date(first).toDateString() === new Date(last).toDateString() ? formatClockTime(last) : formatDate(last) });
  const exportable = chosen.length > 0 || matching.some(ref => !isLive(ref.run));

  return <>
    <PageHeader title={t('runList.title')}
      meta={runs.length ? [t('runList.count', { count: runs.length }), t('runList.batches', { count: batchCount }), range] : []}
      actions={<>
        {runs.length > 0 && <Button variant="outline" disabled={!exportable || exporting} onClick={() => void exportRuns()}>
          <Download aria-hidden="true" />{exporting ? t('runExport.working') : chosen.length ? t('runExport.picked', { count: chosen.length }) : t('runExport.action')}
        </Button>}
        <Button disabled={config.tasks.length === 0} onClick={onRun}><Play aria-hidden="true" />{t('runList.run')}</Button>
      </>} />
    {runs.length === 0
      ? <EmptyState title={t('empty.runs.title')} action={<Button asChild variant="outline"><Link to={{ view: 'tasks' }} navigate={navigate}>{t('empty.runs.action')}</Link></Button>} />
      : <>
        {chosen.length > 0
          ? <div role="region" aria-label={t('runList.select.count', { count: chosen.length })} className="mb-3 flex h-8 flex-wrap items-center gap-2">
            <span className="mr-1 font-medium tabular-nums">{t('runList.select.count', { count: chosen.length })}</span>
            <Button variant="outline" disabled={!canCompare} onClick={() => navigate({ view: 'runs', compare: chosen.map(ref => ref.run.id) })}><Columns2 aria-hidden="true" />{t('runCompare.action')}</Button>
            <Button variant="outline" disabled={pageProps.busy} onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" />{t('runList.select.delete')}</Button>
            <Button variant="ghost" onClick={() => setPicked(new Set())}>{t('runList.select.clear')}</Button>
            {!canCompare && <span className="ml-auto text-sm text-ink-2">{chosen.length < 2 ? t('runCompare.needMore') : t('runCompare.tooMany', { max: MAX_COMPARE })}</span>}
          </div>
          : <div role="search" aria-label={t('runList.filterLabel')} className="mb-3 flex flex-wrap items-center gap-2">
            <FilterSearch label={t('runList.search')} value={query} onChange={value => narrow(() => setQuery(value))} placeholder={t('runList.searchPlaceholder')} className="sm:w-65" />
            <FilterChip label={t('runList.filters.task')} value={task} onChange={value => narrow(() => setTask(value))} options={options(tasks)} />
            <FilterChip label={t('runList.filters.outcome')} value={outcome} onChange={value => narrow(() => setOutcome(value as Outcome))}
              options={outcomes.map(id => ({ id, name: id === 'all' ? t('runList.all') : id === 'live' ? t('runList.outcomes.live') : t(`status.${id}`) }))} />
            <FilterChip label={t('runList.filters.profile')} value={profile} onChange={value => narrow(() => setProfile(value))} options={options(profiles)} />
            {models.length > 1 && <FilterChip label={t('runList.filters.model')} value={model} onChange={value => narrow(() => setModel(value))} options={options(models)} />}
            {projectTagList.length > 0 && <FilterChip label={t('runList.filters.tag')} value={tag ?? ALL} onChange={value => narrow(() => setTag(value))} add={!tag}
              options={options(projectTagList.map((name): [string, string] => [name, name]))} />}
          </div>}
        {matching.length === 0
          ? <p className="py-2 text-ink-2">{t('runList.noMatch')}</p>
          : <>
            <RunsTable runs={matching.slice(0, shown)} numbers={numbers} totals={totals} config={config} tasks={config.tasks} showConditions groupByBatch navigate={navigate}
              selection={{ selected: picked, onToggle: toggle, onToggleAll: toggleAll }} />
            {matching.length > shown && <div className="mt-3 flex items-center gap-3 text-sm text-ink-2">
              <span className="tabular-nums">{t('runList.shown', { shown: Math.min(shown, matching.length), total: matching.length })}</span>
              <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>{t('runList.more')}</Button>
            </div>}
          </>}
      </>}
    <DeleteRunsDialog open={deleting} onOpenChange={setDeleting} count={chosen.length} onConfirm={remove} />
  </>;
}

/**
 * A 32px filter as `라벨 값 ▾`, the value in ink. With `add`, an unset optional filter reads `+ 라벨` in a dashed outline instead.
 * The menu is a radio list, so the chosen value is announced as checked.
 */
function FilterChip({ label, value, onChange, options, add }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string }[]; add?: boolean }) {
  const current = options.find(option => option.id === value)?.name ?? options[0]?.name;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={cn('inline-flex h-8 max-w-64 items-center gap-1.5 rounded-sm border border-edge-strong bg-surface px-3 text-ink-2 hover:bg-raised aria-expanded:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trace',
        add && 'border-dashed')}>
        {add ? <><Plus aria-hidden="true" className="size-3.5" />{label}</>
          : <>{label} <span className="truncate font-medium text-foreground">{current}</span><ChevronDown aria-hidden="true" className="size-3.5 shrink-0" /></>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-auto max-w-80">
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map(option => <DropdownMenuRadioItem key={option.id} value={option.id} className="text-base">{option.name}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
