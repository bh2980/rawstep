import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { dataFailureView } from '../lib/errors';
import { formatSteps } from '../lib/format';
import { isFinished, runStepCount, type RunRef } from '../lib/runs';
import { runGlyphKind, runStripLabel } from '../lib/runStrip';
import { FactLine } from './trace/FactLine';
import { ModelBehaviorList, PageEvidenceLedger } from './trace/FindingLedgers';
import { RunGlyph } from './trace/RunStrip';
import { SourceMarker } from './trace/SourceMarker';
import { ConceptNote } from './layout/ConceptNote';
import { EmptyState } from './layout/EmptyState';
import { ErrorState } from './layout/ErrorState';
import { Link } from './Link';
import { RunsTable } from './RunsTable';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

type Props = {
  taskId: string;
  /** Runs of this task, newest first. */
  runs: RunRef[]; numbers: ReadonlyMap<string, number>;
  findings: { data?: TaskFindings; error: string; loading: boolean };
  profiles: { id: string; name: string }[];
  navigate: (change: RouteChange) => void;
  /** Takes a person to the run control of the task header. */
  onRun: () => void;
};

/**
 * The "개요" tab, an investigation sheet: one fact line, the page evidence ledger, the model's behaviour as a separate weaker layer,
 * and the run history in a closed block.
 */
export function TaskOverview({ taskId, runs, numbers, findings, profiles, navigate, onRun }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model') ?? [];
  const facts = data?.facts, fastestNumber = facts?.fastest ? numbers.get(facts.fastest.runId) : undefined;
  if (runs.length === 0) return <EmptyState title={t('empty.taskRuns.title')} why={t('empty.taskRuns.why')} action={<Button variant="outline" onClick={onRun}>{t('empty.taskRuns.action')}</Button>} />;
  const shared = { taskId, numbers, navigate };
  return <div className="grid gap-7">
    {facts && facts.runs > 0 && <FactLine className="text-[15px]" items={[
      <strong key="r" className="font-semibold">{t('taskPage.factReached', { reached: facts.reached, runs: facts.runs })}</strong>,
      t('taskPage.factMedian', { n: formatSteps(facts.medianSteps) }),
      facts.fastest && <Link key="f" to={{ task: taskId, run: facts.fastest.runId }} navigate={navigate} className="rounded-sm text-trace underline-offset-2 hover:underline">
        {t('taskPage.factFastest', { n: facts.fastest.steps })}{fastestNumber !== undefined && t('taskPage.factFastestRun', { number: fastestNumber })}
      </Link>,
    ]} />}
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
    {findings.error && !data && <ErrorState view={dataFailureView(t('taskPage.findingsFailed'), findings.error)} />}
    {data && <>
      <section aria-labelledby="findings-page" className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3 border-b border-edge-strong pb-1.5">
          <h2 id="findings-page" className="flex items-center gap-2 text-base font-semibold"><SourceMarker source="page" />{t('taskPage.pageTitle')}</h2>
          <Count n={page.length} />
        </div>
        <ConceptNote concept="inspect" />
        <p className="text-[13px] leading-5 text-muted-foreground">{t('taskPage.pageNote')}</p>
        {page.length === 0
          ? <EmptyState compact title={t('empty.findings.title')} why={t('empty.findings.why')} action={<Button variant="outline" size="sm" onClick={onRun}>{t('empty.findings.action')}</Button>} />
          : <PageEvidenceLedger findings={page} {...shared} />}
      </section>
      <section aria-labelledby="findings-model" className="ml-3 grid gap-2 border-l border-dashed border-model bg-model-soft/50 py-3 pr-4 pl-4 md:ml-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="findings-model" className="flex items-center gap-2 text-[15px] font-medium text-model"><SourceMarker source="model" />{t('taskPage.modelTitle')}</h2>
          <Count n={model.length} className="text-model" />
        </div>
        <p className="text-[13px] leading-5 text-muted-foreground">{t('taskPage.modelNote')}</p>
        {model.length === 0 ? <p className="text-sm text-muted-foreground">{t('taskPage.modelEmpty')}</p> : <ModelBehaviorList findings={model} {...shared} />}
      </section>
    </>}
    <History taskId={taskId} runs={runs} numbers={numbers} profiles={profiles} navigate={navigate} />
  </div>;
}

/** The number of records in a section, with its unit for a screen reader. */
function Count({ n, className }: { n: number; className?: string }) {
  const { t } = useTranslation();
  return <span className={className}><span aria-hidden="true" className="font-semibold tabular-nums">{n}</span><span className="sr-only">{t('taskPage.countLabel', { count: n })}</span></span>;
}

/** One bar per finished run with its action count written beside it, above the table of all the task's runs. Closed until opened. */
function History({ taskId, runs, numbers, profiles, navigate }: Pick<Props, 'taskId' | 'runs' | 'numbers' | 'profiles' | 'navigate'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bars = useMemo(() => runs.filter(ref => isFinished(ref.run)).reverse(), [runs]);
  const longest = Math.max(1, ...bars.map(ref => runStepCount(ref.run) ?? 0));
  return <Collapsible open={open} onOpenChange={setOpen} className="border-t border-edge-strong">
    <CollapsibleTrigger asChild>
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm py-2.5 text-left">
        <span><span className="text-sm font-medium">{t('taskPage.historyTitle', { count: runs.length })}</span><span className="ml-2 text-xs text-muted-foreground">{t('taskPage.historyHint')}</span></span>
        <ChevronDown aria-hidden="true" className={'size-4 shrink-0 transition-transform' + (open ? ' rotate-180' : '')} />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="motion-reveal grid gap-4 pt-1 pb-4">
      {bars.length > 0 && <ol aria-label={t('taskPage.barsLabel')} className="grid gap-1">
        {bars.map(ref => {
          const steps = runStepCount(ref.run), number = numbers.get(ref.run.id), label = runStripLabel(number, ref.run.state, steps);
          return <li key={ref.run.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
            <Link to={{ task: taskId, run: ref.run.id }} navigate={navigate} aria-label={label} title={label} className="flex items-center gap-2 rounded-sm tabular-nums hover:underline">
              <RunGlyph kind={runGlyphKind(ref.run.state)} />#{number ?? '—'}
            </Link>
            <span aria-hidden="true" className="h-3 rounded-[2px] bg-muted-foreground" style={{ width: `${Math.max(2, Math.round((steps ?? 0) / longest * 100))}%` }} />
            <span className="text-right font-mono tabular-nums">{steps ?? '—'}</span>
          </li>;
        })}
      </ol>}
      <RunsTable runs={runs} profiles={profiles} navigate={navigate} hideTask numbers={numbers} showProfile showHints />
    </CollapsibleContent>
  </Collapsible>;
}
