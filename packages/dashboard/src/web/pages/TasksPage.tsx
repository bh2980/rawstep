import { taskUrl } from '../lib/taskJson';
import { useMemo, useState } from 'react';
import { FileInput, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from '../../shared/api';
import { ErrorState } from '../components/layout/ErrorState';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterSearch, FilterSegments } from '../components/layout/FilterBar';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunModeButtons } from '../components/RunModeButtons';
import { TaskImportDialog } from '../components/TaskImportDialog';
import { ReachLine } from '../components/trace/ReachLine';
import { RunStrip } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { NEW_TASK } from '../hooks/useRoute';
import { roleLabel } from '../i18n/labels';
import { dataFailureView } from '../lib/errors';
import { formatSteps } from '../lib/format';
import { displayState, recentRuns } from '../lib/runStrip';
import { runStepCount, taskRunNumbers } from '../lib/runs';
import type { RunOptions } from '../lib/quickRun';
import type { ListProps } from './types';

type Filter = 'all' | 'findings' | 'missed';
const filters: Filter[] = ['all', 'findings', 'missed'];
const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-0 text-[13px]';

/**
 * The route index (spec §14): one 40px line per task, to scan and compare. How often the goal was reached, the median and fastest action
 * counts, the last ten runs as a strip, how many page elements recur and the most repeated one. Detail is on the task page.
 */
export function TasksPage({ pageProps, runs, summaries, summaryError, navigate, onRun }: ListProps & { onRun: (taskId: string, options: RunOptions) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all'), [importing, setImporting] = useState(false);
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const needle = query.trim().toLowerCase();
  const rows = config.tasks.map(task => ({ task, url: taskUrl(tasks[task.id]), row: byTask.get(task.id) })).filter(({ task, url, row }) =>
    (!needle || task.name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'findings' ? !!row && row.findingCount > 0 : !!row && row.facts.reached < row.facts.runs)));
  return <div className="grid gap-4">
    <PageHeader title={t('taskList.title')} description={t('taskList.count', { count: config.tasks.length })} actions={<>
      <Button variant="outline" size="xl" onClick={() => setImporting(true)}><FileInput aria-hidden="true" />{t('taskList.import')}</Button>
      <Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('taskList.new')}</Link></Button>
    </>} />

    {config.tasks.length > 0 && <FilterBar label={t('taskList.filterLabel')}>
      <FilterSearch label={t('taskList.search')} value={query} onChange={setQuery} placeholder={t('taskList.searchPlaceholder')} />
      <FilterSegments label={t('taskList.filterLabel')} value={filter} onChange={value => setFilter(value as Filter)} options={filters.map(id => ({ id, name: t(`taskList.filters.${id}`) }))} />
    </FilterBar>}
    {summaryError && <ErrorState view={dataFailureView(t('taskList.loadFailed'), summaryError)} />}

    {config.tasks.length === 0
      ? <EmptyState title={t('empty.tasks.title')} why={t('empty.tasks.why')} action={<Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('empty.tasks.action')}</Link></Button>} />
      : <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <Table className="min-w-[56rem]">
          <TableCaption className="sr-only">{t('taskList.caption')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head}>{t('taskList.columns.task')}</TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.reached')}</TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.steps')} <span className="font-normal">{t('taskList.columns.stepsKey')}</span></TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.recent')}</TableHead>
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
              <TableCell className={cell + ' font-mono whitespace-nowrap tabular-nums'}>{ran ? <>{formatSteps(facts.medianSteps)} / {formatSteps(facts.fastest?.steps)}<span className="sr-only"> {t('taskList.stepsSr')}</span></> : '—'}</TableCell>
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

/** `2곳` and the element that recurs most, short: its role in small capitals and its name. */
function Finding({ row, ran }: { row: TaskSummary | undefined; ran: boolean }) {
  const { t } = useTranslation();
  if (!row || row.findingCount === 0) return <span className="text-muted-foreground">{ran ? t('taskList.noFinding') : '—'}</span>;
  const target = row.topFinding?.target;
  return <span className="flex min-w-0 items-baseline gap-2">
    <span className="font-semibold whitespace-nowrap tabular-nums">{t('taskList.findingCount', { count: row.findingCount })}</span>
    <span className="flex min-w-0 items-baseline gap-1 text-muted-foreground">
      {target?.role && <span lang="en" className="text-[11px] tracking-[0.08em] uppercase" title={roleLabel(target.role)}>{target.role}</span>}
      <span className="truncate">{target?.name || (target ? t('trace.unnamed') : t('trace.wholePage'))}</span>
    </span>
  </span>;
}
