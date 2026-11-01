import { useTranslation } from 'react-i18next';
import type { Profile } from '@rawstep/project/config';
import type { TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { dataFailureView } from '../lib/errors';
import type { RunRef } from '../lib/runs';
import { ModelBehaviorList, PageEvidenceLedger } from './trace/FindingLedgers';
import { SourceMarker } from './trace/SourceMarker';
import { InfoTip } from './layout/InfoTip';
import { EmptyState } from './layout/EmptyState';
import { ErrorState } from './layout/ErrorState';
import { Fold, TaskResults } from './TaskResults';
import { BatchCompare, batchLabel } from './BatchCompare';
import type { TaskBatch } from '../../shared/api';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

type Props = {
  taskId: string;
  /** Runs of this task, newest first. */
  runs: RunRef[]; numbers: ReadonlyMap<string, number>;
  findings: { data?: TaskFindings; error: string; loading: boolean };
  navigate: (change: RouteChange) => void;
  /** Opens the run dialog for this task. */
  onRun: () => void;
  /** The project's profiles, to name the results by. */
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** The fewest moves the goal takes, when the task says. */
  minimalSteps?: number | undefined;
  /** The batch the results are about (undefined: the newest), and the one to compare it with, if any, with its findings. */
  batch: string | undefined; onBatch: (experimentId: string) => void;
  compareTo: string | undefined; onCompare: (experimentId: string | undefined) => void;
  compared: { data?: TaskFindings; error: string; loading: boolean };
};

/**
 * The "개요" tab, an investigation sheet: how the runs ended and what they cost (by run profile, as a picture or tables), then what
 * the page did (by element) and where the model wandered as a separate, weaker layer, both folded. The run list is the 실행 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun, profiles, minimalSteps, onBatch, compareTo, onCompare, compared }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  // Broken expectations are drawn as the stuck places above, not listed again among the model's wanderings.
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model' && finding.kind !== 'expectation-broken') ?? [];
  if (runs.length === 0) return <EmptyState title={t('empty.taskRuns.title')} why={t('empty.taskRuns.why')} action={<Button variant="outline" onClick={onRun}>{t('empty.taskRuns.action')}</Button>} />;
  const shared = { taskId, numbers, navigate };
  return <div className="grid gap-5">
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-40" /><Skeleton className="h-14" /></div>}
    {findings.error && !data && <ErrorState view={dataFailureView(t('taskPage.findingsFailed'), findings.error)} />}
    {data && <>
      {data.batches.length > 1 && <BatchBar batches={data.batches} batch={data.batch} onBatch={onBatch} compareTo={compareTo} onCompare={onCompare} />}
      {compareTo && compared.data && compared.data.batch !== data.batch && (() => {
        // The earlier batch is "before", whichever of the two was picked first.
        const [before, after] = [compared.data, data].sort((a, b) => (a.batches.find(x => x.experimentId === a.batch)?.createdAt ?? '').localeCompare(b.batches.find(x => x.experimentId === b.batch)?.createdAt ?? ''));
        return <BatchCompare before={before!} after={after!} profiles={profiles} runs={runs} minimalSteps={minimalSteps} navigate={navigate} />;
      })()}
      {data.facts.byProfile.length > 0 && <TaskResults taskId={taskId} data={data} numbers={numbers} navigate={navigate} profiles={profiles} minimalSteps={minimalSteps}
        lastRunAt={runs.find(ref => ref.experiment.id === data.batch)?.run.startedAt} />}
      <div className="grid gap-3 md:grid-cols-2">
        <Fold id="findings-page" title={<><SourceMarker source="page" />{t('taskPage.pageTitle')}<InfoTip term={t('taskPage.pageTitle')}>{t('taskPage.pageNote')} {t('help.inspect')}</InfoTip></>} count={page.length}>
          {page.length === 0
            ? <EmptyState compact title={t('empty.findings.title')} why={t('empty.findings.why')} action={<Button variant="outline" size="sm" onClick={onRun}>{t('empty.findings.action')}</Button>} />
            : <PageEvidenceLedger findings={page} {...shared} />}
        </Fold>
        <Fold id="findings-model" dashed title={<><SourceMarker source="model" />{t('taskPage.modelTitle')}<InfoTip term={t('taskPage.modelTitle')}>{t('taskPage.modelNote')}</InfoTip></>} count={model.length}>
          {model.length === 0 ? <p className="text-sm text-muted-foreground">{t('taskPage.modelEmpty')}</p> : <ModelBehaviorList findings={model} {...shared} />}
        </Fold>
      </div>
    </>}
  </div>;
}

/** Which batch of runs the results are about, and which other batch to compare it with. Batches are never counted together. */
function BatchBar({ batches, batch, onBatch, compareTo, onCompare }: { batches: TaskBatch[]; batch: string | undefined; onBatch: (id: string) => void; compareTo: string | undefined; onCompare: (id: string | undefined) => void }) {
  const { t } = useTranslation();
  const select = 'h-8 max-w-full rounded-sm border border-edge-control bg-surface px-2 text-[13px]';
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-edge bg-surface px-3 py-2">
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{t('taskPage.batch.pick')}
      <select className={select} value={batch ?? ''} onChange={event => onBatch(event.target.value)}>
        {batches.map(item => <option key={item.experimentId} value={item.experimentId}>{batchLabel(item, t)}</option>)}
      </select></label>
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{t('taskPage.batch.compare')}
      <select className={select} value={compareTo ?? ''} onChange={event => onCompare(event.target.value || undefined)}>
        <option value="">{t('taskPage.batch.compareNone')}</option>
        {batches.filter(item => item.experimentId !== batch).map(item => <option key={item.experimentId} value={item.experimentId}>{batchLabel(item, t)}</option>)}
      </select></label>
    <span className="text-xs text-muted-foreground">{t('taskPage.batch.note')}</span>
  </div>;
}
