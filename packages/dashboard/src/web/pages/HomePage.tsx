import { Check, Plus, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from '../../shared/api';
import { Link } from '../components/Link';
import { NEW_TASK } from '../hooks/useRoute';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { findingLabel } from '../i18n/labels';
import { formatSteps } from '../lib/format';
import { providerTextKey } from '../lib/modelSetup';
import { isFinished } from '../lib/runs';
import type { ListProps } from './types';

const RECENT_TASKS = 3, RECENT_RUNS = 8;

/** Getting started, the most recently used tasks and the newest runs. */
export function HomePage({ pageProps, runs, summaries, navigate }: ListProps) {
  const { t } = useTranslation();
  const { config } = pageProps.view, byTask = new Map(summaries.map(row => [row.taskId, row]));
  const model = config.models[0];
  const steps = [
    { id: 'model' as const, done: config.models.length > 0, detail: model ? t('home.start.modelDone', { model: model.name, provider: t(`modelSetup.providers.${providerTextKey(model.kind, model.provider)}.name`) }) : t('home.start.modelTodo'), to: { view: 'settings', section: 'models' } as const },
    { id: 'task' as const, done: config.tasks.length > 0, detail: config.tasks.length ? t('home.start.taskDone', { count: config.tasks.length }) : t('home.start.taskTodo'), to: { task: NEW_TASK } as const },
    { id: 'run' as const, done: runs.some(ref => isFinished(ref.run)), detail: runs.some(ref => isFinished(ref.run)) ? t('home.start.runDone', { count: runs.filter(ref => isFinished(ref.run)).length }) : t('home.start.runTodo'), to: { view: 'tasks' } as const },
  ];
  const completed = steps.filter(step => step.done).length, current = steps.find(step => !step.done);
  // Tasks that ran most recently first, then the rest in project order.
  const recent = config.tasks.map((task, order) => ({ task, order, row: byTask.get(task.id) }))
    .sort((a, b) => (b.row?.lastRunAt ?? '').localeCompare(a.row?.lastRunAt ?? '') || a.order - b.order).slice(0, RECENT_TASKS);
  return <div className="grid gap-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{t('home.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('home.description')}</p></div>
      <Button asChild size="xl"><Link to={{ task: NEW_TASK }} navigate={navigate}><Plus aria-hidden="true" />{t('home.newTask')}</Link></Button>
    </header>

    {current && <section aria-labelledby="home-start" className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="home-start" className="font-semibold">{t('home.start.title')}</h2>
        <span className="text-xs text-muted-foreground">{t('home.start.progress', { done: completed, total: steps.length })}</span>
      </div>
      <Progress value={completed / steps.length * 100} aria-label={t('home.start.title')} />
      <ol className="grid gap-2 md:grid-cols-3">{steps.map((step, i) => {
        const now = step === current;
        return <li key={step.id} aria-current={now ? 'step' : undefined} className={'grid content-start gap-1 rounded-md border p-3 text-sm ' + (now ? 'border-primary bg-primary/5' : '')}>
          <span className={'flex items-center gap-1.5 text-xs font-medium ' + (step.done ? 'text-positive' : now ? 'text-warning' : 'text-muted-foreground')}>
            {step.done && <Check className="size-3.5" aria-hidden="true" />}{t(step.done ? 'home.start.done' : now ? 'home.start.now' : 'home.start.waiting')}
          </span>
          <span className="font-medium">{i + 1}. {t(`home.start.steps.${step.id}`)}</span>
          <span className="text-xs leading-5 text-muted-foreground">{step.detail}</span>
          {now && <Link to={step.to} navigate={navigate} className="mt-1 w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline">{t(`home.start.go.${step.id}`)}</Link>}
        </li>;
      })}</ol>
    </section>}

    {recent.length > 0 && <section aria-labelledby="home-tasks" className="grid gap-2">
      <div className="flex items-baseline justify-between"><h2 id="home-tasks" className="font-semibold">{t('home.tasks')}</h2><Link to={{ view: 'tasks' }} navigate={navigate} className="rounded-sm text-sm text-primary underline-offset-4 hover:underline">{t('home.allTasks')}</Link></div>
      <ul className="grid gap-3 md:grid-cols-3">{recent.map(({ task, row }) => <li key={task.id}><TaskCard name={task.name} url={pageProps.view.tasks[task.id]?.url} row={row} id={task.id} navigate={navigate} /></li>)}</ul>
    </section>}

    {runs.length > 0 && <section aria-labelledby="home-runs" className="grid gap-2">
      <div className="flex items-baseline justify-between"><h2 id="home-runs" className="font-semibold">{t('home.runs')}</h2><Link to={{ view: 'runs' }} navigate={navigate} className="rounded-sm text-sm text-primary underline-offset-4 hover:underline">{t('home.allRuns')}</Link></div>
      <RunsTable runs={runs.slice(0, RECENT_RUNS)} profiles={config.profiles} navigate={navigate} />
    </section>}
  </div>;
}

function TaskCard({ id, name, url, row, navigate }: { id: string; name: string; url: string | undefined; row: TaskSummary | undefined; navigate: ListProps['navigate'] }) {
  const { t } = useTranslation();
  const facts = row?.facts;
  return <Link to={{ task: id }} navigate={navigate} className="grid h-full content-start gap-2.5 rounded-lg border p-3 transition-colors hover:bg-muted/50">
    <span className="grid gap-0.5"><span className="font-medium">{name}</span>{url && <span className="truncate font-mono text-xs text-muted-foreground">{url}</span>}</span>
    {facts && facts.runs > 0
      ? <dl className="flex gap-5 text-sm">
        <Fact label={t('taskList.reached')} value={`${facts.reached} / ${facts.runs}`} />
        <Fact label={t('taskList.median')} value={formatSteps(facts.medianSteps)} />
        <Fact label={t('taskList.fastest')} value={formatSteps(facts.fastest?.steps)} />
      </dl>
      : <span className="text-sm text-muted-foreground">{t('taskList.neverRun')}</span>}
    {row?.topFinding && <span className="flex items-start gap-1.5 text-xs text-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{findingLabel(row.topFinding)} · {t('taskList.occurrence', { runs: row.topFinding.runs, total: row.topFinding.totalRuns })}</span></span>}
  </Link>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
}
