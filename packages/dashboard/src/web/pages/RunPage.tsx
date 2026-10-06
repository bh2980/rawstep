import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { RailLegend, TraceRail } from '../components/trace/TraceRail';
import { StepPager } from '../components/trace/StepPager';
import { StepDetail } from '../components/StepDetail';
import { RunDiagnosis } from '../components/RunDiagnosis';
import { RunHeader } from '../components/RunHeader';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { Skeleton } from '../components/ui/skeleton';
import { useLiveBus } from '../hooks/useLiveEvents';
import { connectionLostView, dataFailureView } from '../lib/errors';
import { useThrottledMessage } from '../hooks/useAnnouncer';
import { rememberHintSummary } from '../hooks/useHintSummaries';
import type { Route, RouteChange } from '../hooks/useRoute';
import { useRunSteps } from '../hooks/useRunData';
import { announcement, defaultStep } from '../lib/stepDots';
import { isFinished, isLive, taskRunNumbers, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = {
  runRef: RunRef; runs: RunRef[]; route: Route; pageProps: PageProps;
  navigate: (change: RouteChange, options?: { replace?: boolean }) => void;
};

/**
 * One run: its header, the dot timeline and the one step that is selected. The selected step is in the address (`step=`);
 * a live run follows its newest step until a person picks an earlier one. Mount with `key={run.id}`.
 */
export function RunPage({ runRef, runs, route, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const { data: view, error, loading } = useRunSteps(experiment.id, run.id);
  const { connected } = useLiveBus();
  const live = isLive(run);
  const taskRuns = useMemo(() => runs.filter(ref => ref.run.taskId === run.taskId), [runs, run.taskId]);
  const numbers = useMemo(() => taskRunNumbers(runs, run.taskId), [runs, run.taskId]);
  useEffect(() => { if (view && isFinished(run)) rememberHintSummary(run.id, view.hints); }, [view, run.id, run.state]);
  const latest = view?.steps.at(-1);
  // A picked step stays; otherwise a live run shows its newest step and a finished one its first hint (or last step).
  const picked = route.step !== undefined && view?.steps.some(step => step.step === route.step) ? route.step : undefined;
  const selected = picked ?? (view ? defaultStep({ steps: view.steps, live }) : undefined);
  const step = view?.steps.find(item => item.step === selected);
  const index = view && step ? view.steps.indexOf(step) : -1;
  const previous = view && index > 0 ? view.steps.slice(0, index).reverse().find(item => item.screenshot) : undefined;
  const select = (next: number) => navigate({ task: run.taskId, run: run.id, ...(live && next === latest?.step ? {} : { step: next }) }, { replace: true });
  const spoken = useThrottledMessage(live && latest ? announcement(latest) : '');
  const maxSteps = run.snapshot.task.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps;
  const baselineMet = view?.baseline?.rules.filter(rule => rule.passed).length;
  return <div className="grid gap-5">
    <RunHeader runRef={runRef} taskRuns={taskRuns} numbers={numbers} view={view} pageProps={pageProps} navigate={navigate} />
    {view && !live && <RunDiagnosis run={run} steps={view.steps} notices={view.notices} onSelect={select} />}
    <section aria-label={t('runPage.timelineSection')} className="grid gap-2">
      {loading && !view && <div aria-busy="true" className="grid gap-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>}
      {live && !connected && <ErrorState view={connectionLostView()} />}
      {!view && !loading && <ErrorState alert view={dataFailureView(t('steps.loadFailed'), error)} />}
      {view && (view.steps.length === 0
        ? <EmptyState compact title={live ? t('empty.steps.liveTitle') : t('empty.steps.title')} why={live ? t('empty.steps.liveWhy') : t('empty.steps.why')} />
        : <>
          <TraceRail steps={view.steps} modelKind={view.modelKind} selected={selected} live={live} remaining={live ? Math.max(0, maxSteps - (latest?.step ?? 0)) : 0} onSelect={select} />
          <RailLegend modelKind={view.modelKind} live={live} />
        </>)}
      <p role="status" aria-live="polite" className="sr-only">{spoken}</p>
    </section>
    {view && step && <StepDetail key={step.step} step={step} experimentId={experiment.id} run={run} modelKind={view.modelKind} previous={previous} before={index > 0 ? view.steps[index - 1] : undefined}
      hints={view.hints.filter(hint => hint.steps.includes(step.step))} baselineMet={step.step === 0 ? baselineMet : undefined} live={live && step.step === latest?.step} />}
    {view && step && view.steps.length > 1 && <StepPager position={step.step} total={latest?.step ?? step.step} hasPrevious={index > 0} hasNext={index < view.steps.length - 1}
      onPrevious={() => select(view.steps[index - 1]!.step)} onNext={() => select(view.steps[index + 1]!.step)} />}
  </div>;
}
