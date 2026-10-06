import { useMemo, useState } from 'react';
import { FileInput, Play, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from '../components/Link';
import { RecentBars, ReachBar } from '../components/MiniBars';
import { TaskImportDialog } from '../components/TaskImportDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { NEW_TASK } from '../hooks/useRoute';
import { findingLabel } from '../i18n/labels';
import { formatSteps, relativeTime } from '../lib/format';
import type { ListProps } from './types';

type Filter = 'all' | 'issues' | 'missed';
const filters: Filter[] = ['all', 'issues', 'missed'];

/** Every task with how its runs went, what recurs on the page, and a button that runs it with the default conditions. */
export function TasksPage({ pageProps, summaries, summaryError, navigate, onRunDefault }: ListProps & { onRunDefault: (taskId: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all'), [importing, setImporting] = useState(false);
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const needle = query.trim().toLowerCase();
  const rows = config.tasks.map(task => ({ task, url: tasks[task.id]?.url ?? '', row: byTask.get(task.id) })).filter(({ task, url, row }) =>
    (!needle || task.name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'issues' ? !!row?.topFinding : !!row && row.facts.reached < row.facts.runs)));
  return <div className="grid gap-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{t('taskList.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('taskList.count', { count: config.tasks.length })}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="xl" onClick={() => setImporting(true)}><FileInput aria-hidden="true" />{t('taskList.import')}</Button>
        <Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('taskList.new')}</Link></Button>
      </div>
    </header>

    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm">
        <Label htmlFor="task-search" className="sr-only">{t('taskList.search')}</Label>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id="task-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('taskList.searchPlaceholder')} className="h-9 pl-8" />
      </div>
      <div role="group" aria-label={t('taskList.filterLabel')} className="flex flex-wrap gap-1.5">
        {filters.map(id => <Button key={id} variant={filter === id ? 'secondary' : 'outline'} size="sm" aria-pressed={filter === id} className="h-8 rounded-full px-3 text-[13px]" onClick={() => setFilter(id)}>{t(`taskList.filters.${id}`)}</Button>)}
      </div>
    </div>
    {summaryError && <p role="alert" className="text-sm text-destructive">{t('taskList.loadFailed')} {summaryError}</p>}

    {config.tasks.length === 0
      ? <div className="grid justify-items-center gap-3 rounded-lg border border-dashed py-14 text-center">
        <p className="font-medium">{t('taskList.empty')}</p><p className="max-w-md text-sm text-muted-foreground">{t('taskList.emptyHint')}</p>
        <Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('taskList.new')}</Link></Button>
      </div>
      : <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[56rem]">
          <TableCaption className="sr-only">{t('taskList.caption')}</TableCaption>
          <TableHeader><TableRow className="h-9 text-xs">
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.columns.task')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.reached')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.columns.steps')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.columns.recent')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.columns.finding')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('taskList.columns.last')}</TableHead>
            <TableHead scope="col" className="px-3"><span className="sr-only">{t('taskList.columns.run')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(({ task, url, row }) => {
            const facts = row?.facts;
            return <TableRow key={task.id} className="h-12">
              <TableCell className="px-3">
                <Link to={{ task: task.id }} navigate={navigate} className="grid gap-0.5 rounded-sm hover:underline"><span className="font-medium">{task.name}</span><span className="max-w-64 truncate font-mono text-xs text-muted-foreground">{url}</span></Link>
              </TableCell>
              <TableCell className="px-3">{facts && facts.runs > 0
                ? <span className="flex items-center gap-2"><span className="font-medium tabular-nums">{facts.reached} / {facts.runs}</span><ReachBar reached={facts.reached} total={facts.runs} /></span>
                : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="px-3 font-mono text-[13px] tabular-nums">{facts && facts.runs > 0 ? `${formatSteps(facts.medianSteps)} / ${formatSteps(facts.fastest?.steps)}` : '—'}</TableCell>
              <TableCell className="px-3">{row && row.recent.length > 0 ? <RecentBars runs={row.recent} /> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="max-w-72 px-3 whitespace-normal">{row?.topFinding
                ? <span className="text-[13px]">{findingLabel(row.topFinding)} <span className="whitespace-nowrap text-muted-foreground">· {t('taskList.occurrence', { runs: row.topFinding.runs, total: row.topFinding.totalRuns })}</span></span>
                : <span className="text-muted-foreground">{facts && facts.runs > 0 ? t('taskList.noFinding') : t('taskList.neverRun')}</span>}</TableCell>
              <TableCell className="px-3 text-[13px] whitespace-nowrap text-muted-foreground">{relativeTime(row?.lastRunAt)}</TableCell>
              <TableCell className="px-3 text-right">
                <Button variant="outline" size="sm" className="h-8" disabled={pageProps.busy} aria-label={t('taskList.runLabel', { name: task.name })} onClick={() => onRunDefault(task.id)}><Play aria-hidden="true" />{t('taskList.run')}</Button>
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('taskList.noMatch')}</p>}
      </div>}
    <TaskImportDialog {...pageProps} open={importing} onOpenChange={setImporting} onImported={id => navigate({ task: id })} />
  </div>;
}
