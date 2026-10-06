import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { formatSteps } from '../lib/format';
import { isFinished, runStepCount, type RunRef } from '../lib/runs';
import { cn } from '../lib/utils';
import { runStateLabel } from '../i18n/labels';
import { FindingCard } from './FindingCard';
import { Link } from './Link';
import { RunsTable } from './RunsTable';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Skeleton } from './ui/skeleton';

type Props = {
  taskId: string;
  /** Runs of this task, newest first. */
  runs: RunRef[]; numbers: ReadonlyMap<string, number>;
  findings: { data?: TaskFindings; error: string; loading: boolean };
  profiles: { id: string; name: string }[];
  navigate: (change: RouteChange) => void;
};

/** The "개요" tab: the facts of the task's runs, the recurring findings by source, and the run history in a closed block. */
export function TaskOverview({ taskId, runs, numbers, findings, profiles, navigate }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model') ?? [];
  const facts = data?.facts;
  if (runs.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('taskPage.noRuns')}</p>;
  return <div className="grid gap-6">
    {facts && facts.runs > 0 && <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
      <div className="flex gap-2"><dt className="text-muted-foreground">{t('taskList.reached')}</dt><dd className="font-semibold tabular-nums">{facts.reached} / {facts.runs}</dd></div>
      <div className="flex gap-2"><dt className="text-muted-foreground">{t('taskList.median')}</dt><dd className="font-semibold tabular-nums">{t('taskPage.times', { n: formatSteps(facts.medianSteps) })}</dd></div>
      {facts.fastest && <div className="flex gap-2"><dt className="text-muted-foreground">{t('taskList.fastest')}</dt>
        <dd className="tabular-nums"><Link to={{ task: taskId, run: facts.fastest.runId }} navigate={navigate} className="rounded-sm text-primary underline-offset-2 hover:underline"><strong>{t('taskPage.times', { n: facts.fastest.steps })}</strong>{numbers.get(facts.fastest.runId) !== undefined && ` (#${numbers.get(facts.fastest.runId)})`}</Link></dd></div>}
    </dl>}
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
    {findings.error && !data && <p role="alert" className="text-sm text-destructive">{t('taskPage.findingsFailed')} {findings.error}</p>}
    {data && <>
      <Findings id="page" title={t('taskPage.pageTitle')} note={t('taskPage.pageNote')} empty={t('taskPage.pageEmpty')} items={page} taskId={taskId} numbers={numbers} navigate={navigate} />
      <Findings id="model" title={t('taskPage.modelTitle')} note={t('taskPage.modelNote')} empty={t('taskPage.modelEmpty')} items={model} taskId={taskId} numbers={numbers} navigate={navigate} />
    </>}
    <History taskId={taskId} runs={runs} numbers={numbers} profiles={profiles} navigate={navigate} />
  </div>;
}

function Findings({ id, title, note, empty, items, taskId, numbers, navigate }: { id: string; title: string; note: string; empty: string; items: TaskFindings['findings']; taskId: string; numbers: ReadonlyMap<string, number>; navigate: Props['navigate'] }) {
  return <section aria-labelledby={`findings-${id}`} className="grid gap-2">
    <div className="grid gap-0.5">
      <h2 id={`findings-${id}`} className="text-base font-semibold">{title}</h2>
      <p className="text-[13px] leading-5 text-muted-foreground">{note}</p>
    </div>
    {items.length === 0
      ? <p className="rounded-lg border border-dashed px-3.5 py-3 text-sm text-muted-foreground">{empty}</p>
      : <ul className="grid gap-2">{items.map((finding, index) => <FindingCard key={index} finding={finding} taskId={taskId} numbers={numbers} navigate={navigate} />)}</ul>}
  </section>;
}

/** One bar per finished run, as tall as its action count and linked to the run, above the table of all the task's runs. */
function History({ taskId, runs, numbers, profiles, navigate }: Pick<Props, 'taskId' | 'runs' | 'numbers' | 'profiles' | 'navigate'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bars = useMemo(() => runs.filter(ref => isFinished(ref.run)).reverse(), [runs]);
  const tallest = Math.max(1, ...bars.map(ref => runStepCount(ref.run) ?? 0));
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
    <CollapsibleTrigger asChild>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-left">
        <span><span className="text-sm font-medium">{t('taskPage.historyTitle', { count: runs.length })}</span><span className="ml-2 text-xs text-muted-foreground">{t('taskPage.historyHint')}</span></span>
        <ChevronDown aria-hidden="true" className={'size-4 shrink-0 transition-transform' + (open ? ' rotate-180' : '')} />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="grid gap-4 border-t px-4 py-4">
      {bars.length > 0 && <div role="group" aria-label={t('taskPage.barsLabel')} className="flex h-28 items-end gap-1.5 border-b">
        {bars.map(ref => {
          const steps = runStepCount(ref.run), reached = ref.run.state === 'success';
          return <Link key={ref.run.id} to={{ task: taskId, run: ref.run.id }} navigate={navigate}
            aria-label={t('taskPage.barLabel', { number: numbers.get(ref.run.id) ?? 0, steps: steps ?? 0, state: runStateLabel(ref.run.state) })}
            title={t('taskPage.barLabel', { number: numbers.get(ref.run.id) ?? 0, steps: steps ?? 0, state: runStateLabel(ref.run.state) })}
            className={cn('block min-w-3 max-w-10 flex-1 rounded-t', reached ? 'bg-positive' : 'bg-warning')} style={{ height: Math.max(6, Math.round((steps ?? 0) / tallest * 100)) + '%' }} />;
        })}
      </div>}
      <RunsTable runs={runs} profiles={profiles} navigate={navigate} detailed hideTask numbers={numbers} />
    </CollapsibleContent>
  </Collapsible>;
}
