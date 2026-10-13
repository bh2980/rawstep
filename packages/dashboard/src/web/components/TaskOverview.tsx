import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { dataFailureView } from '../lib/errors';
import { formatSteps } from '../lib/format';
import type { RunRef } from '../lib/runs';
import { ModelBehaviorList, PageEvidenceLedger } from './trace/FindingLedgers';
import { SourceMarker } from './trace/SourceMarker';
import { InfoTip } from './layout/InfoTip';
import { SectionHead } from './layout/PageHeader';
import { EmptyState } from './layout/EmptyState';
import { ErrorState } from './layout/ErrorState';
import { Link } from './Link';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

type Props = {
  taskId: string;
  /** Runs of this task, newest first. */
  runs: RunRef[]; numbers: ReadonlyMap<string, number>;
  findings: { data?: TaskFindings; error: string; loading: boolean };
  navigate: (change: RouteChange) => void;
  /** Takes a person to the run control of the task header. */
  onRun: () => void;
};

/**
 * The "개요" tab, an investigation sheet: the run facts as three figures, then what the page did (by element), then where the model
 * wandered as a separate, weaker layer. The run list itself is the 실행 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model') ?? [];
  const facts = data?.facts, fastestNumber = facts?.fastest ? numbers.get(facts.fastest.runId) : undefined;
  if (runs.length === 0) return <EmptyState title={t('empty.taskRuns.title')} why={t('empty.taskRuns.why')} action={<Button variant="outline" onClick={onRun}>{t('empty.taskRuns.action')}</Button>} />;
  const shared = { taskId, numbers, navigate };
  return <div className="grid gap-8">
    {facts && facts.runs > 0 && <dl aria-label={t('taskPage.factsLabel')} className="flex flex-wrap gap-x-10 gap-y-3">
      <Stat label={t('taskPage.statReached')} value={<>{facts.reached}<span className="text-base font-normal text-muted-foreground"> / {facts.runs}</span></>} />
      <Stat label={t('taskPage.statMedian')} value={formatSteps(facts.medianSteps)} />
      {facts.fastest && <Stat label={t('taskPage.statFastest')} value={<Link to={{ task: taskId, run: facts.fastest.runId }} navigate={navigate} className="rounded-sm text-trace underline-offset-4 hover:underline">
        {facts.fastest.steps}{fastestNumber !== undefined && <span className="ml-1.5 text-sm font-normal">#{fastestNumber}</span>}
      </Link>} />}
    </dl>}
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
    {findings.error && !data && <ErrorState view={dataFailureView(t('taskPage.findingsFailed'), findings.error)} />}
    {data && <>
      <section aria-labelledby="findings-page" className="grid gap-3">
        <SectionHead id="findings-page" title={<span className="flex items-center gap-2"><SourceMarker source="page" />{t('taskPage.pageTitle')}<InfoTip term={t('taskPage.pageTitle')}>{t('taskPage.pageNote')} {t('help.inspect')}</InfoTip></span>} aside={<Count n={page.length} />} />
        {page.length === 0
          ? <EmptyState compact title={t('empty.findings.title')} why={t('empty.findings.why')} action={<Button variant="outline" size="sm" onClick={onRun}>{t('empty.findings.action')}</Button>} />
          : <PageEvidenceLedger findings={page} {...shared} />}
      </section>
      <section aria-labelledby="findings-model" className="grid gap-3">
        <SectionHead id="findings-model" title={<span className="flex items-center gap-2"><SourceMarker source="model" />{t('taskPage.modelTitle')}<InfoTip term={t('taskPage.modelTitle')}>{t('taskPage.modelNote')}</InfoTip></span>} aside={<Count n={model.length} />} />
        {model.length === 0 ? <p className="text-sm text-muted-foreground">{t('taskPage.modelEmpty')}</p> : <ModelBehaviorList findings={model} {...shared} />}
      </section>
    </>}
  </div>;
}

/** One figure of the facts: a small label over a large number. */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid gap-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
  </div>;
}

/** The number of records in a section, with its unit for a screen reader. */
function Count({ n }: { n: number }) {
  const { t } = useTranslation();
  return <span><span aria-hidden="true" className="font-semibold tabular-nums text-foreground">{n}</span><span className="sr-only">{t('taskPage.countLabel', { count: n })}</span></span>;
}
