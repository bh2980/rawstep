import { taskUrl } from '../lib/taskJson';
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from '../components/Link';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { EmptyState } from '../components/layout/EmptyState';
import { RunStateLabel } from '../components/RunStateLabel';
import { RunsTable } from '../components/RunsTable';
import { SetupRail, type SetupStep } from '../components/SetupRail';
import { RunStrip } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { NEW_TASK } from '../hooks/useRoute';
import { profileModel } from '@rawstep/project/config';
import { displayState, recentRuns } from '../lib/runStrip';
import { isFinished, isLive, runStepCount, taskRunNumbers, taskNameOf } from '../lib/runs';
import type { ListProps } from './types';

const RECENT_TASKS = 3, RECENT_RUNS = 8;

/**
 * Two homes (spec §13). Before the first run: the setup rail and nothing else to read. After it: running tasks first, the three
 * tasks used last as compact rows, the newest runs as a table, and the rail folded to one line. No analysis is summarised here.
 */
export function HomePage({ pageProps, runs, summaries, navigate }: ListProps) {
  const { t } = useTranslation();
  const { config, tasks } = pageProps.view, byTask = useMemo(() => new Map(summaries.map(row => [row.taskId, row])), [summaries]);
  const ready = config.profiles.map(profile => profileModel(config, profile)).find(Boolean), finished = runs.filter(ref => isFinished(ref.run)), live = runs.filter(ref => isLive(ref.run));
  const hasRun = finished.length > 0;
  const steps: SetupStep[] = [
    { id: 'model', done: !!ready, detail: ready ? t('home.start.modelDone', { model: ready.name }) : config.connections.length ? t('home.start.modelPick') : t('home.start.modelTodo'), to: { view: config.connections.length ? 'profiles' : 'connections' } },
    { id: 'task', done: config.tasks.length > 0, detail: config.tasks.length ? t('home.start.taskDone', { count: config.tasks.length }) : t('home.start.taskTodo'), to: { task: NEW_TASK } },
    { id: 'run', done: hasRun, detail: hasRun ? t('home.start.runDone', { count: finished.length }) : t('home.start.runTodo'), to: { view: 'tasks' } },
  ];
  // Tasks that ran most recently first, then the rest in project order.
  const recent = config.tasks.map((task, order) => ({ task, order, row: byTask.get(task.id) }))
    .sort((a, b) => (b.row?.lastRunAt ?? '').localeCompare(a.row?.lastRunAt ?? '') || a.order - b.order).slice(0, RECENT_TASKS);
  return <div className="grid gap-7">
    <PageHeader title={t('home.title')} description={t('home.description')}
      actions={<Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('home.newTask')}</Link></Button>} />

    {live.length > 0 && <section aria-labelledby="home-live" className="grid gap-2">
      <SectionHead id="home-live" title={t('home.live')} aside={t('home.liveCount', { count: live.length })} />
      <ul className="divide-y divide-edge border-b border-edge">{live.map(({ run }) => <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
        <RunStateLabel state={run.state} className="w-24 font-medium" />
        <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="min-w-0 flex-1 rounded-sm font-medium hover:underline">{taskNameOf(run, config.tasks)}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Link>
        <span className="text-muted-foreground">{t(`sidebar.modes.${run.snapshot.mode}`)} · {run.snapshot.model.name}</span>
      </li>)}</ul>
    </section>}

    {/* Getting started is for the first visit only: once every step is done it leaves the home page. */}
    {steps.some(step => !step.done) && <SetupRail steps={steps} navigate={navigate} />}

    {recent.length > 0 && <section aria-labelledby="home-tasks" className="grid gap-2">
      <SectionHead id="home-tasks" title={t('home.tasks')} aside={<Link to={{ view: 'tasks' }} navigate={navigate} className="rounded-sm text-trace underline-offset-4 hover:underline">{t('home.allTasks')}</Link>} />
      <ul className="divide-y divide-edge border-b border-edge">{recent.map(({ task, row }) => {
        const facts = row?.facts, numbers = taskRunNumbers(runs, task.id), strip = recentRuns(runs, task.id);
        return <li key={task.id} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_11rem]">
          <Link to={{ task: task.id }} navigate={navigate} className="grid min-w-0 gap-0.5 rounded-sm hover:underline">
            <span className="truncate font-medium">{task.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{taskUrl(tasks[task.id])}</span>
          </Link>
          <span className="text-sm tabular-nums">{facts && facts.runs > 0 ? <><span className="text-muted-foreground">{t('home.reached')} </span><span className="font-semibold">{facts.reached} / {facts.runs}</span></> : <span className="text-muted-foreground">{t('taskList.neverRun')}</span>}</span>
          {strip.length > 0 ? <RunStrip runs={strip.map(ref => ({ id: ref.run.id, number: numbers.get(ref.run.id), state: displayState(ref.run), steps: runStepCount(ref.run) }))} className="col-span-2 sm:col-span-1" /> : <span />}
        </li>;
      })}</ul>
    </section>}

    {hasRun || live.length > 0
      ? <section aria-labelledby="home-runs" className="grid gap-2">
        <SectionHead id="home-runs" title={t('home.runs')} aside={<Link to={{ view: 'runs' }} navigate={navigate} className="rounded-sm text-trace underline-offset-4 hover:underline">{t('home.allRuns')}</Link>} />
        <RunsTable runs={runs.slice(0, RECENT_RUNS)} profiles={config.profiles} tasks={config.tasks} navigate={navigate} />
      </section>
      : config.tasks.length > 0 && <EmptyState title={t('empty.runs.title')} why={t('empty.runs.why')}
        action={<Button asChild variant="outline"><Link to={{ view: 'tasks' }} navigate={navigate}>{t('empty.runs.action')}</Link></Button>} />}
  </div>;
}
