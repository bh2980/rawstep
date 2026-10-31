import { taskUrl } from '../lib/taskJson';
import { useMemo, useState } from 'react';
import { CornerDownRight, FileInput, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from '../../shared/api';
import { cn } from '../lib/utils';
import { ErrorState } from '../components/layout/ErrorState';
import { EmptyState } from '../components/layout/EmptyState';
import { FilterBar, FilterSearch, FilterSegments } from '../components/layout/FilterBar';
import { InfoTip } from '../components/layout/InfoTip';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunStateLabel } from '../components/RunStateLabel';
import { SetupRail, type SetupStep } from '../components/SetupRail';
import { TaskImportDialog } from '../components/TaskImportDialog';
import { RunStrip, RunStripLegend } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { NEW_TASK } from '../hooks/useRoute';
import { roleLabel } from '../i18n/labels';
import { dataFailureView } from '../lib/errors';
import { comboSummary, profileReady } from '../lib/conditions';
import { formatSteps } from '../lib/format';
import { displayState, recentRuns } from '../lib/runStrip';
import { isFinished, isLive, runModelsName, runStepCount, taskNameOf, taskRunNumbers } from '../lib/runs';
import type { ListProps } from './types';

type Filter = 'all' | 'findings' | 'missed';
const filters: Filter[] = ['all', 'findings', 'missed'];
const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-0 text-[13px]';

/**
 * The landing page and route index (spec §14): one 40px line per task, to scan and compare. Above the table, only while there is
 * something to say: the runs going now, and the getting-started steps until the first run is done. Detail is on the task page.
 */
export function TasksPage({ pageProps, runs, summaries, summaryError, navigate, onRun }: ListProps & { onRun: (taskIds: string[]) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all'), [importing, setImporting] = useState(false);
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const needle = query.trim().toLowerCase();
  const rows = config.tasks.map(task => ({ task, url: taskUrl(tasks[task.id]), row: byTask.get(task.id), base: config.tasks.find(other => other.id === task.variantOf) })).filter(({ task, url, row }) =>
    (!needle || task.name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'findings' ? !!row && row.findingCount > 0 : !!row && row.facts.reached < row.facts.runs)));
  // Each variant right under its base task; a variant whose base is filtered out keeps its place.
  const shown = new Set(rows.map(item => item.task.id));
  const ordered = rows.filter(item => !item.base || !shown.has(item.base.id)).flatMap(item => [item, ...rows.filter(other => other.base?.id === item.task.id)]);
  const [picked, setPicked] = useState<string[]>([]);
  const allShown = ordered.length > 0 && ordered.every(item => picked.includes(item.task.id));
  const profileName = (id: string) => config.profiles.find(profile => profile.id === id)?.name ?? id;
  const live = runs.filter(ref => isLive(ref.run)), finished = runs.filter(ref => isFinished(ref.run));
  // Ready once some run profile can run: it has a planner (a model or a plan file).
  const ready = config.profiles.find(profile => profileReady(profile, config.connections));
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
        <span className="text-muted-foreground">{runModelsName(run)}</span>
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
      : <div className="grid gap-2">
        <div className="flex min-h-9 flex-wrap items-center gap-3">
          <Button variant="outline" disabled={!picked.length || pageProps.busy} onClick={() => onRun(picked)}><Play aria-hidden="true" />{picked.length ? t('taskList.runPicked', { count: picked.length }) : t('taskList.runNone')}</Button>
          {picked.length > 0 && <Button variant="ghost" size="sm" onClick={() => setPicked([])}>{t('taskList.clearPicked')}</Button>}
        </div>
        <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <Table className="min-w-[56rem]">
          <TableCaption className="sr-only">{t('taskList.caption')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head + ' w-9'}><Checkbox aria-label={t('taskList.pickAll')} checked={allShown ? true : picked.length ? 'indeterminate' : false}
              onCheckedChange={on => setPicked(on === true ? ordered.map(item => item.task.id) : [])} /></TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.task')}</TableHead>
            <TableHead scope="col" className={head}><span className="inline-flex items-center gap-0.5">{t('taskList.columns.results')}<InfoTip term={t('taskList.columns.results')}>{t('taskList.resultsInfo')}</InfoTip></span></TableHead>
            <TableHead scope="col" className={head}><span className="inline-flex items-center gap-0.5">{t('taskList.columns.recent')}<InfoTip term={t('taskList.columns.recent')}><RunStripLegend /></InfoTip></span></TableHead>
            <TableHead scope="col" className={head}>{t('taskList.columns.finding')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{ordered.map(({ task, url, row, base }) => {
            const numbers = taskRunNumbers(runs, task.id), strip = recentRuns(runs, task.id), groups = row?.facts.byProfile ?? [];
            const baseGroups = base ? byTask.get(base.id)?.facts.byProfile ?? [] : [];
            return <TableRow key={task.id} className={base ? 'h-9' : 'h-11'}>
              <TableCell className={cell + ' w-9'}><Checkbox aria-label={t('taskList.pickOne', { name: task.name })} checked={picked.includes(task.id)}
                onCheckedChange={on => setPicked(current => on === true ? [...current, task.id] : current.filter(id => id !== task.id))} /></TableCell>
              <TableCell className={cell + ' max-w-80'}>
                <Link to={{ task: task.id }} navigate={navigate} className={cn('grid min-w-0 rounded-sm hover:underline', base && 'pl-5')}>
                  <span className="flex min-w-0 items-baseline gap-1.5">{base && <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 self-center text-muted-foreground" />}
                    <span className="truncate font-medium">{task.name}</span>{base && <span className="sr-only">{t('taskList.variantOf', { name: base.name })}</span>}</span>
                  {!base && <span className="truncate font-mono text-xs text-muted-foreground">{url}</span>}
                </Link>
              </TableCell>
              <TableCell className={cell + ' py-1.5'}>{groups.length
                ? <ul className="grid gap-0.5 text-[13px] tabular-nums">{groups.slice(0, 3).map(group => {
                  const same = baseGroups.find(other => other.profileId === group.profileId);
                  const extra = group.medianSteps != null && same?.medianSteps != null ? group.medianSteps - same.medianSteps : undefined;
                  return <li key={group.profileId} className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className="max-w-48 truncate text-muted-foreground">{profileName(group.profileId)}</span>
                    <span className="font-medium">{formatSteps(group.medianSteps)}</span>
                    {extra !== undefined && <span className={cn('text-xs', extra > 0 ? 'text-inspect' : 'text-muted-foreground')}>{extra > 0 ? `+${formatSteps(extra)}` : formatSteps(extra)}</span>}
                    {group.unheard > 0 && <span className="text-xs text-inspect">{t('taskList.unheard', { unheard: group.unheard, reached: group.reached })}</span>}
                  </li>; })}
                  {groups.length > 3 && <li className="text-xs text-muted-foreground">{t('taskList.moreProfiles', { count: groups.length - 3 })}</li>}</ul>
                : <span className="text-muted-foreground">{t('taskList.neverRun')}</span>}</TableCell>
              <TableCell className={cell}>{strip.length > 0
                ? <RunStrip navigate={navigate} runs={strip.map(ref => ({ id: ref.run.id, number: numbers.get(ref.run.id), state: displayState(ref.run), steps: runStepCount(ref.run), to: { task: task.id, run: ref.run.id } }))} />
                : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className={cell + ' max-w-56'}><Finding row={row} ran={groups.length > 0} /></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {ordered.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('taskList.noMatch')}</p>}
        </div>
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
