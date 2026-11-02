import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TraceRail } from '../components/trace/TraceRail';
import { StepList } from '../components/trace/StepList';
import { StepDetail } from '../components/StepDetail';
import { giveUpOf, RunDiagnosis } from '../components/RunDiagnosis';
import { RunExplanation } from '../components/RunExplanation';
import { RunHeader } from '../components/RunHeader';
import { PlanDocumentFold } from '../components/trace/PlanDocumentView';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { Skeleton } from '../components/ui/skeleton';
import { useLiveBus } from '../hooks/useLiveEvents';
import { connectionLostView, dataFailureView } from '../lib/errors';
import { useThrottledMessage } from '../hooks/useAnnouncer';
import { rememberHintSummary } from '../hooks/useHintSummaries';
import type { Route, RouteChange } from '../hooks/useRoute';
import { useRunSteps } from '../hooks/useRunData';
import { runStatus } from '../lib/runStrip';
import { announcement, defaultStep } from '../lib/stepDots';
import { isFinished, isLive, taskRunNumbers, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = {
  runRef: RunRef; runs: RunRef[]; route: Route; pageProps: PageProps;
  navigate: (change: RouteChange, options?: { replace?: boolean }) => void;
};

/**
 * One run, top to bottom: the header, the diagnosis once (why it ended, the broken expectations), the Trace Rail, the move list beside
 * the selected move, the LLM commentary as hypotheses below that evidence, and the plan document folded. The selected move is in the
 * address (`step=`); a live run follows its newest move until a person picks an earlier one. Mount with `key={run.id}`.
 */
export function RunPage({ runRef, runs, route, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const { data: view, error, loading } = useRunSteps(experiment.id, run.id);
  const { connected } = useLiveBus();
  const live = isLive(run);
  const numbers = useMemo(() => taskRunNumbers(runs, run.taskId), [runs, run.taskId]);
  useEffect(() => { if (view && isFinished(run)) rememberHintSummary(run.id, view.hints); }, [view, run.id, run.state]);
  const latest = view?.steps.at(-1);
  // A picked move stays; otherwise a live run shows its newest move and a finished one its first hint (or last move).
  const picked = route.step !== undefined && view?.steps.some(step => step.step === route.step) ? route.step : undefined;
  const selected = picked ?? (view ? defaultStep({ steps: view.steps, live }) : undefined);
  const step = view?.steps.find(item => item.step === selected);
  const select = (next: number) => navigate({ task: run.taskId, run: run.id, ...(live && next === latest?.step ? {} : { step: next }) }, { replace: true });
  const spoken = useThrottledMessage(live && latest ? announcement(latest) : '');
  const baselineMet = view?.baseline?.rules.filter(rule => rule.passed).length;
  const { status } = runStatus(run);
  const tried = useMemo(() => view ? giveUpOf(view.hints)?.tried ?? [] : [], [view]);
  return <div>
    <RunHeader runRef={runRef} numbers={numbers} view={view} pageProps={pageProps} navigate={navigate} />
    {view?.waitingForPerson && <section role="status" className="mb-6 border-y border-edge py-2">
      <p className="font-semibold">{t('runPage.waitingForPerson')}</p>
      <p className="text-sm text-ink-2">{t('runPage.waitingForPersonNote')}</p>
    </section>}
    {view && !live && <RunDiagnosis run={run} status={status} steps={view.steps} notices={view.notices} hints={view.hints} plan={view.plan} onSelect={select} />}
    {loading && !view && <div aria-busy="true" className="mb-6 flex gap-0.5">{Array.from({ length: 24 }, (_, i) => <Skeleton key={i} className="h-7 flex-1" />)}</div>}
    {live && !connected && <div className="mb-6"><ErrorState view={connectionLostView()} /></div>}
    {!view && !loading && <ErrorState alert view={dataFailureView(t('steps.loadFailed'), error)} />}
    {view && view.steps.length === 0 && <EmptyState compact title={live ? t('empty.steps.liveTitle') : t('empty.steps.title')} why={live ? t('empty.steps.liveWhy') : t('empty.steps.why')} />}
    {view && view.steps.length > 0 && <>
      <TraceRail steps={view.steps} hints={view.hints} plan={view.plan} selected={selected} live={live} status={status} tried={tried} onSelect={select} />
      <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="order-2 min-w-0 lg:order-1">
          <StepList steps={view.steps} hints={view.hints} plan={view.plan} selected={selected} status={status} live={live} onSelect={select} />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          {step && <StepDetail key={step.step} step={step} steps={view.steps} experimentId={experiment.id} run={run} plan={view.plan} hints={view.hints}
            baselineMet={step.step === 0 ? baselineMet : undefined} live={live && step.step === latest?.step} onSelect={select} />}
        </div>
      </div>
    </>}
    <p role="status" aria-live="polite" className="sr-only">{spoken}</p>
    {view?.explanation && <RunExplanation explanation={view.explanation} model={run.analysisModel?.name} onSelect={select} />}
    {view?.plan && <PlanDocumentFold plan={view.plan} steps={view.steps} actionLimit={run.snapshot.spec.settings.runRules.stepActionLimit} selectedStep={selected} onSelectStep={select} live={live} />}
  </div>;
}
