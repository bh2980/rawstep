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
};

/**
 * The "개요" tab, an investigation sheet: how the runs ended and what they cost (by run profile, as a picture or tables), then what
 * the page did (by element) and where the model wandered as a separate, weaker layer, both folded. The run list is the 실행 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun, profiles, minimalSteps }: Props) {
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
      {data.facts.byProfile.length > 0 && <TaskResults taskId={taskId} data={data} numbers={numbers} navigate={navigate} profiles={profiles} minimalSteps={minimalSteps} lastRunAt={runs[0]?.run.startedAt} />}
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
