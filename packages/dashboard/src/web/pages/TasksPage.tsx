import { useId, useMemo, useState } from 'react';
import { CornerDownRight, Play, Plus, Search, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from '../../shared/api';
import { ErrorState } from '../components/layout/ErrorState';
import { Link } from '../components/Link';
import { Dash, PageHeader, SectionHead } from '../components/PageHeader';
import { SetupRail, type SetupStep } from '../components/SetupRail';
import { StatusLegend, StatusMark } from '../components/StatusMark';
import { displayUrl } from '../components/TaskHeader';
import { TaskImportDialog } from '../components/TaskImportDialog';
import { Time } from '../components/Time';
import { RunStrip } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { NEW_TASK } from '../hooks/useRoute';
import { targetLabel } from '../i18n/labels';
import { comboSummary, profileReady } from '../lib/conditions';
import { dataFailureView } from '../lib/errors';
import { recentRuns, runStatus } from '../lib/runStrip';
import { isFinished, isLive, runModelsName, runStepCount, taskNameOf, taskRunNumbers } from '../lib/runs';
import { profileMovesPlaceholder } from '../lib/taskList';
import { activeTag, hasTag, projectTags } from '../lib/tags';
import { taskUrl } from '../lib/taskJson';
import { cn } from '../lib/utils';
import type { ListProps } from './types';

type Filter = 'all' | 'findings' | 'missed';
const filters: Filter[] = ['all', 'findings', 'missed'];
const ALL = '__all__';
const head = 'h-8 px-3 text-left align-middle text-xs font-medium text-ink-2 whitespace-nowrap';
const cell = 'h-10 px-3 align-middle';

/**
 * The landing page and route index: one 40px row per task in one table with fixed columns, to scan and compare. Above it, only while
 * there is something to say: the runs going now and the getting-started steps. Picking tasks swaps the filters for the selection bar.
 */
export function TasksPage({ pageProps, runs, summaries, summaryError, navigate, onRun }: ListProps & { onRun: (taskIds: string[]) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all'), [importing, setImporting] = useState(false), [chosenTag, setTag] = useState(ALL);
  const [picked, setPicked] = useState<string[]>([]);
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const needle = query.trim().toLowerCase(), tags = projectTags(config.tasks), tag = activeTag(chosenTag, ALL, config.tasks);
  const rows = config.tasks.map(task => ({ task, url: taskUrl(tasks[task.id]), row: byTask.get(task.id), base: config.tasks.find(other => other.id === task.variantOf) })).filter(({ task, url, row }) =>
    (!needle || task.name.toLowerCase().includes(needle) || url.toLowerCase().includes(needle)) && hasTag(task, tag)
    && (filter === 'all' || (filter === 'findings' ? !!row && row.findingCount > 0 : !!row && row.facts.reached < row.facts.runs)));
  // Each variant right under its base task; a variant whose base is filtered out keeps its place.
  const shown = new Set(rows.map(item => item.task.id));
  const ordered = rows.filter(item => !item.base || !shown.has(item.base.id)).flatMap(item => [item, ...rows.filter(other => other.base?.id === item.task.id)]);
  const allShown = ordered.length > 0 && ordered.every(item => picked.includes(item.task.id));
  const profileName = (id: string) => config.profiles.find(profile => profile.id === id)?.name ?? id;
  const live = runs.filter(ref => isLive(ref.run)), finished = runs.filter(ref => isFinished(ref.run));
  // Ready once some run profile can run: it has a planner (a model or a plan file).
  const ready = config.profiles.find(profile => profileReady(profile, config.connections));
  const steps: SetupStep[] = [
    { id: 'model', done: !!ready, detail: ready ? t('taskList.setup.modelDone', { profile: ready.name, models: comboSummary(ready, config.connections) }) : config.connections.length ? t('taskList.setup.modelPick') : t('taskList.setup.modelTodo'),
      to: config.connections.length ? { view: 'profiles' } : { view: 'settings', section: 'connections' } },
    { id: 'task', done: config.tasks.length > 0, detail: config.tasks.length ? t('taskList.setup.taskDone', { count: config.tasks.length }) : t('taskList.setup.taskTodo'), to: { task: NEW_TASK } },
    { id: 'run', done: finished.length > 0, detail: finished.length ? t('taskList.setup.runDone', { count: finished.length }) : t('taskList.setup.runTodo') },
  ];
  const empty = config.tasks.length === 0;
  const newTask = <Button asChild><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('taskList.new')}</Link></Button>;

  return <div className="grid gap-6">
    <PageHeader className="mb-0" title={t('taskList.title')} meta={[t('taskList.count', { count: config.tasks.length }), !empty && t('appShell.project', { name: pageProps.view.projectName })]}
      actions={<>
        <Button variant="outline" onClick={() => setImporting(true)}><Upload aria-hidden="true" />{t('taskList.import')}</Button>
        {!empty && newTask}
      </>} />

    {live.length > 0 && <section aria-labelledby="tasks-live" className="grid">
      <SectionHead id="tasks-live" title={t('taskList.live')} count={live.length} />
      <ul className="border-t border-edge">{live.map(({ run }) => <li key={run.id} className="flex h-10 items-center gap-4 border-b border-edge px-3">
        <StatusMark status={runStatus(run).status} className="w-24" />
        <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="min-w-0 flex-1 truncate rounded-sm font-medium hover:underline">{taskNameOf(run, config.tasks)}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Link>
        <span className="truncate text-ink-2">{runModelsName(run)}</span>
      </li>)}</ul>
    </section>}

    {/* Getting started is for the first visit only: once every step is done it leaves the page. */}
    {steps.some(step => !step.done) && <SetupRail steps={steps} navigate={navigate} />}
    {summaryError && <ErrorState view={dataFailureView(t('taskList.loadFailed'), summaryError)} />}

    {empty
      ? <section aria-labelledby="tasks-empty" className="mx-auto mt-24 grid w-full max-w-md justify-items-start gap-2">
        <h2 id="tasks-empty" className="text-md font-semibold">{t('taskList.empty.title')}</h2>
        <p className="text-ink-2">{t('taskList.empty.why')}</p>
        <div className="mt-2 flex gap-2">{newTask}</div>
        <p className="mt-4 w-full border-t border-edge pt-3 text-sm text-ink-2">{t('taskList.empty.cli')} <code lang="en" className="font-mono text-foreground">npx rawstep init</code></p>
      </section>
      : <div className="grid gap-3">
        {picked.length > 0
          ? <div role="toolbar" aria-label={t('taskList.picked', { count: picked.length })} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-medium tabular-nums">{t('taskList.picked', { count: picked.length })}</span>
            <Button variant="outline" disabled={pageProps.busy} onClick={() => onRun(picked)}><Play aria-hidden="true" />{t('taskList.runPicked')}</Button>
            <Button variant="ghost" onClick={() => setPicked([])}>{t('taskList.clearPicked')}</Button>
            <span className="text-ink-2">{t('taskList.pickedNote')}</span>
            <StatusLegend order className="ml-auto" />
          </div>
          : <div role="search" aria-label={t('taskList.filterLabel')} className="flex min-h-8 flex-wrap items-center gap-2">
            <SearchField label={t('taskList.search')} value={query} onChange={setQuery} placeholder={t('taskList.searchPlaceholder')} />
            <FilterChip label={t('taskList.resultFilter')} value={filter} onChange={value => setFilter(value as Filter)} options={filters.map(id => ({ id, name: t(`taskList.filters.${id}`) }))} />
            {tags.length > 0 && <FilterChip label={t('taskList.tagFilter')} value={tag ?? ALL} onChange={setTag} options={[{ id: ALL, name: t('taskList.allTags') }, ...tags.map(name => ({ id: name, name }))]} />}
            <StatusLegend order className="ml-auto" />
          </div>}

        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[64rem] table-fixed border-collapse">
            <caption className="sr-only">{t('taskList.caption')}</caption>
            <colgroup><col className="w-11" /><col className="w-57" /><col /><col className="w-43" /><col className="w-50" /><col className="w-26" /><col className="w-22" /><col className="w-32" /></colgroup>
            <thead><tr className="border-b border-edge">
              <th scope="col" className={head}><Checkbox aria-label={t('taskList.pickAll')} checked={allShown ? true : picked.length ? 'indeterminate' : false}
                onCheckedChange={on => setPicked(on === true ? ordered.map(item => item.task.id) : [])} /></th>
              <th scope="col" className={head}>{t('taskList.columns.task')}</th>
              <th scope="col" className={head}>{t('taskList.columns.url')}</th>
              <th scope="col" className={head}>{t('taskList.columns.profile')}</th>
              <th scope="col" className={head}>{t('taskList.columns.recent')}</th>
              <th scope="col" className={head + ' text-right'}>{t('taskList.columns.cost')}</th>
              <th scope="col" className={head + ' text-right'}>{t('taskList.columns.finding')}</th>
              <th scope="col" className={head + ' text-right'}>{t('taskList.columns.last')}</th>
            </tr></thead>
            <tbody>
              {ordered.map(({ task, url, row, base }) => {
                const numbers = taskRunNumbers(runs, task.id), strip = recentRuns(runs, task.id), on = picked.includes(task.id);
                const ran = row?.facts.byProfile.map(group => group.profileId) ?? [], profileIds = ran.length ? ran : task.profiles ?? [];
                return <tr key={task.id} data-state={on ? 'selected' : undefined} className={cn('border-b border-edge hover:bg-raised', on && 'bg-raised')}>
                  <td data-selected={on} className={cell + ' row-rail rail-divider'}><Checkbox aria-label={t('taskList.pickOne', { name: task.name })} checked={on}
                    onCheckedChange={next => setPicked(current => next === true ? [...current, task.id] : current.filter(id => id !== task.id))} /></td>
                  <th scope="row" className={cell + ' text-left font-normal'}>
                    <span className={cn('flex min-w-0 items-center gap-1.5', base && 'pl-4')}>
                      {base && <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-3" />}
                      <Link to={{ task: task.id }} navigate={navigate} className="truncate rounded-sm font-medium hover:underline">{task.name}{base && <span className="sr-only">, {t('taskList.variantOf', { name: base.name })}</span>}</Link>
                      {task.tags?.length ? <span className="shrink truncate text-sm text-ink-3" title={task.tags.join(', ')}><span className="sr-only">{t('tags.label')}: </span>{task.tags.join(' · ')}</span> : null}
                    </span>
                  </th>
                  <td className={cell + ' truncate text-ink-2'} title={url}>{url ? displayUrl(url) : <Dash />}</td>
                  <td className={cell + ' truncate'}>{profileIds.length ? <>
                    {profileName(profileIds[0]!)}
                    {profileIds.length > 1 && <span className="ml-1 text-ink-3 tabular-nums" title={profileIds.slice(1).map(profileName).join(', ')}><span aria-hidden="true">{t('taskList.moreProfiles', { count: profileIds.length - 1 })}</span><span className="sr-only">{t('taskList.moreProfilesLabel', { count: profileIds.length - 1 })}</span></span>}
                  </> : <Dash />}</td>
                  <td className={cell}>{strip.length > 0
                    ? <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                      <RunStrip navigate={navigate} runs={strip.slice(-5).map(ref => ({ id: ref.run.id, number: numbers.get(ref.run.id), status: runStatus(ref.run).status, steps: runStepCount(ref.run), to: { task: task.id, run: ref.run.id } }))} />
                      {row && row.facts.runs > 0 && <span className="tabular-nums text-ink-2">{t('taskList.reachedOf', { runs: row.facts.runs, reached: row.facts.reached })}</span>}
                      {row && row.facts.unconfirmed > 0 && <span className="tabular-nums text-ink-2" title={t('taskPage.results.unconfirmedInfo')}>· {t('taskPage.results.unconfirmedCount', { unconfirmed: row.facts.unconfirmed, reached: row.facts.reached })}</span>}
                    </span>
                    : <Dash />}</td>
                  <td className={cell + ' text-right tabular-nums'}><Cost row={row} empty={profileMovesPlaceholder({ byProfile: row?.facts.byProfile ?? [], lastRunAt: row?.lastRunAt, listed: runs.some(ref => ref.run.taskId === task.id && isFinished(ref.run)) })} /></td>
                  <td className={cell + ' text-right tabular-nums'}>{row && row.findingCount > 0
                    ? <span title={row.topFinding ? t('taskList.topFinding', { target: targetLabel(row.topFinding.target) }) : undefined}>{row.findingCount}</span> : <Dash />}</td>
                  <td className={cell + ' text-right whitespace-nowrap tabular-nums text-ink-2'}><Time value={row?.lastRunAt} /></td>
                </tr>;
              })}
              {ordered.length === 0 && <tr><td colSpan={8} className="h-16 px-3 text-center text-ink-2">{t('taskList.noMatch')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>}
    <TaskImportDialog {...pageProps} open={importing} onOpenChange={setImporting} onImported={id => navigate({ task: id })} />
  </div>;
}

/** What reaching the goal cost, over every run profile of the newest batch: the fewest and the most actions, or one number. */
function Cost({ row, empty }: { row: TaskSummary | undefined; empty: 'neverRun' | 'noMeasured' | undefined }) {
  const { t } = useTranslation();
  const groups = row?.facts.byProfile.filter(group => group.minSteps !== null && group.maxSteps !== null) ?? [];
  // Runs that ended on an error are left out of the counts: a task with only those has run, it just has nothing measured.
  if (empty === 'noMeasured') return <span className="text-ink-3" title={`${t('taskList.noMeasured')}. ${t('taskList.noMeasuredWhy')}`}>—<span className="sr-only">{t('taskList.noMeasured')}. {t('taskList.noMeasuredWhy')}</span></span>;
  if (!groups.length) return <Dash />;
  const low = Math.min(...groups.map(group => group.minSteps!)), high = Math.max(...groups.map(group => group.maxSteps!));
  return <>{low === high ? low : `${low}–${high}`}</>;
}

function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  return <div className="relative w-full sm:w-65">
    <label htmlFor={id} className="sr-only">{label}</label>
    <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-2" />
    <Input id={id} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="pl-8" />
  </div>;
}

/** A filter as one control: its name in the secondary colour and the chosen value after it (`결과 전체`). */
function FilterChip({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string }[] }) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={`${label}: ${options.find(option => option.id === value)?.name ?? ''}`} className="gap-1.5 text-ink-2">
      <span aria-hidden="true">{label}</span><span className="font-medium text-foreground"><SelectValue /></span>
    </SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
  </Select>;
}
