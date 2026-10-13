import { taskUrl } from '../lib/taskJson';
import { useMemo, useState } from 'react';
import { FileInput, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from '../../shared/api';
import { ErrorState } from '../components/layout/ErrorState';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterSearch, FilterSegments } from '../components/layout/FilterBar';
import { InfoTip } from '../components/layout/InfoTip';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunModeButtons } from '../components/RunModeButtons';
import { RunStateLabel } from '../components/RunStateLabel';
import { SetupRail, type SetupStep } from '../components/SetupRail';
import { TaskImportDialog } from '../components/TaskImportDialog';
import { ReachLine } from '../components/trace/ReachLine';
import { RunStrip, RunStripLegend } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { NEW_TASK } from '../hooks/useRoute';
import { roleLabel } from '../i18n/labels';
import { dataFailureView } from '../lib/errors';
import { comboModesOf, comboSummary } from '../lib/conditions';
import { formatSteps } from '../lib/format';
import { displayState, recentRuns } from '../lib/runStrip';
import { isFinished, isLive, runModelsName, runStepCount, taskNameOf, taskRunNumbers } from '../lib/runs';
import type { RunOptions } from '../lib/quickRun';
import type { ListProps } from './types';

type Filter = 'all' | 'findings' | 'missed';
const filters: Filter[] = ['all', 'findings', 'missed'];
const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-0 text-[13px]';

/**
 * The landing page and route index (spec §14): one 40px line per task, to scan and compare. Above the table, only while there is
 * something to say: the runs going now, and the getting-started steps until the first run is done. Detail is on the task page.
 */
export function TasksPage({ pageProps, runs, summaries, summaryError, navigate, onRun }: ListProps & { onRun: (taskId: string, options: RunOptions) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all'), [importing, setImporting] = useState(false);
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const needle = query.trim().toLowerCase();
  const rows = config.tasks.map(task => ({ task, url: taskUrl(tasks[task.id]), row: byTask.get(task.id) })).filter(({ task, url, row }) =>
    (!needle || task.name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'findings' ? !!row && row.findingCount > 0 : !!row && row.facts.reached < row.facts.runs)));
  const live = runs.filter(ref => isLive(ref.run)), finished = runs.filter(ref => isFinished(ref.run));
  // Ready once some run profile has an executor that can run a mode.
  const ready = config.profiles.find(profile => comboModesOf(profile, config.connections).length > 0);
  const steps: SetupStep[] = [
    { id: 'model', done: !!ready, detail: ready ? t('taskList.setup.modelDone', { profile: ready.name, models: comboSummary(ready, config.connections) }) : config.connections.length ? t('taskList.setup.modelPick') : t('taskList.setup.modelTodo'),
      to: { view: 'settings', section: config.connections.length ? 'profiles' : 'connections' } },
    { id: 'task', done: config.tasks.length > 0, detail: config.tasks.length ? t('taskList.setup.taskDone', { count: config.tasks.length }) : t('taskList.setup.taskTodo'), to: { task: NEW_TASK } },
    { id: 'run', done: finished.length > 0, detail: finished.length ? t('taskList.setup.runDone', { count: finished.length }) : t('taskList.setup.runTodo') },
  ];
  return <div className="grid gap-4">
    <PageHeader title={t('taskList.title')} meta={t('taskList.count', { count: config.tasks.length })} actions={<>
      <Button variant="outline" size="lg" onClick={() => setImporting(true)}><FileInput aria-hidden="true" />{t('taskList.import')}</Button>
      <Button asChild size="lg"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('taskList.new')}</Link></Button>
    </>} />

    {live.length > 0 && <section aria-labelledby="tasks-live" className="grid gap-2">
      <SectionHead id="tasks-live" title={t('taskList.live')} aside={t('taskList.liveCount', { count: live.length })} />
      <ul className="divide-y divide-edge border-b border-edge">{live.map(({ run }) => <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]">
        <RunStateLabel state={run.state} className="w-24 font-medium" />
        <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="min-w-0 flex-1 rounded-sm font-medium hover:underline">{taskNameOf(run, config.tasks)}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Link>
        <span className="text-muted-foreground">{t(`sidebar.modes.${run.mode}`)} · {runModelsName(run)}</span>
      </li>)}</ul>
    </section>}

    {/* Getting started is for the first visit only: once every step is done it leaves the page. */}
    {steps.some(step => !step.done) && <SetupRail steps={steps} navigate={navigate} />}

    {config.tasks.length > 0 && <FilterBar label={t('taskList.filterLabel')}>
      <FilterSearch label={t('taskList.search')} value={query} onChange={setQuery} placeholder={t('taskList.searchPlaceholder')} />
      <FilterSegments label={t('taskList.filterLabel')} value={filter} onChange={value => setFilter(value as Filter)} options={filters.map(id => ({ id, name: t(`taskList.filters.${id}`) }))} />
    </FilterBar>}
    {summaryError && <ErrorState view={dataFailureView(t('taskList.loadFailed'), summaryError)} />}

    {config.tasks.length === 0
      ? <EmptyState title={t('empty.tasks.title')} action={<Button asChild variant="outline"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('empty.tasks.action')}</Link></Button>} />
      : <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <Table className="min-w-[56rem]">
          <TableCaption className="sr-only">{t('taskList.caption')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head}>{t('taskList.columns.task')}</TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.reached')}</TableHead>
            <TableHead scope="col" className={head + ' text-right'}>{t('taskList.columns.median')}</TableHead>
            <TableHead scope="col" className={head + ' text-right'}>{t('taskList.columns.fastest')}</TableHead>
            <TableHead scope="col" className={head}><span className="inline-flex items-center gap-0.5">{t('taskList.columns.recent')}<InfoTip term={t('taskList.columns.recent')}><RunStripLegend /></InfoTip></span></TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.finding')}</TableHead>
            <TableHead scope="col" className={head}><span className="sr-only">{t('taskList.columns.run')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(({ task, url, row }) => {
            const facts = row?.facts, ran = !!facts && facts.runs > 0, numbers = taskRunNumbers(runs, task.id), strip = recentRuns(runs, task.id);
            return <TableRow key={task.id} className="h-10">
              <TableCell className={cell + ' max-w-72'}>
                <Link to={{ task: task.id }} navigate={navigate} className="grid min-w-0 rounded-sm hover:underline"><span className="truncate font-medium">{task.name}</span><span className="truncate font-mono text-xs text-muted-foreground">{url}</span></Link>
              </TableCell>
              <TableCell className={cell + ' whitespace-nowrap'}>{ran
                ? <span className="grid gap-1"><span className="font-semibold tabular-nums">{facts.reached} / {facts.runs}</span><ReachLine reached={facts.reached} total={facts.runs} /></span>
                : <span className="text-muted-foreground">{t('taskList.neverRun')}</span>}</TableCell>
              <TableCell className={cell + ' text-right font-mono whitespace-nowrap tabular-nums'}>{ran ? formatSteps(facts.medianSteps) : '—'}</TableCell>
              <TableCell className={cell + ' text-right font-mono whitespace-nowrap tabular-nums'}>{ran ? formatSteps(facts.fastest?.steps) : '—'}</TableCell>
              <TableCell className={cell}>{strip.length > 0
                ? <RunStrip navigate={navigate} runs={strip.map(ref => ({ id: ref.run.id, number: numbers.get(ref.run.id), state: displayState(ref.run), steps: runStepCount(ref.run), to: { task: task.id, run: ref.run.id } }))} />
                : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className={cell + ' max-w-56'}><Finding row={row} ran={ran} /></TableCell>
              <TableCell className={cell + ' text-right'}>
                <RunModeButtons name={task.name} disabled={pageProps.busy} onRun={mode => onRun(task.id, { mode })} />
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('taskList.noMatch')}</p>}
      </div>}
    <TaskImportDialog {...pageProps} open={importing} onOpenChange={setImporting} onImported={id => navigate({ task: id })} />
  </div>;
}

/** The count of spots to look at, and under it the element that recurs most: its name, then its role in plain Korean. */
function Finding({ row, ran }: { row: TaskSummary | undefined; ran: boolean }) {
  const { t } = useTranslation();
  if (!row || row.findingCount === 0) return <span className="text-muted-foreground">{ran ? t('taskList.noFinding') : '—'}</span>;
  const target = row.topFinding?.target;
  return <span className="grid min-w-0 leading-tight">
    <span className="font-semibold whitespace-nowrap tabular-nums">{t('taskList.findingCount', { count: row.findingCount })}</span>
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="truncate">{target?.name || (target ? t('trace.unnamed') : t('trace.wholePage'))}</span>
      {target?.role && <span className="shrink-0" title={target.role}>{roleLabel(target.role)}</span>}
    </span>
  </span>;
}
