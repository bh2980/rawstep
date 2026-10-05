import { useEffect } from 'react';
import type { RunStepsView } from '../../shared/api';
import { ko } from '../i18n/ko';
import { Skeleton } from './ui/skeleton';
import { LiveIndicator, StepRow } from './StepRow';

type Props = { view: RunStepsView | undefined; error: string; loading: boolean; highlightStep: number | undefined; experimentId: string; runId: string };

/** One row per step; step 0 is the start screen. Live runs show an indicator and refresh through SSE. */
export function StepTimeline({ view, error, loading, highlightStep, experimentId, runId }: Props) {
  useEffect(() => {
    if (highlightStep === undefined || !view) return;
    document.getElementById(`step-${highlightStep}`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [highlightStep, view?.steps.length]);
  if (loading && !view) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  if (!view) return <p role="alert" className="text-sm text-muted-foreground">{ko.steps.loadFailed} {error}</p>;
  const baselineMet = view.baseline?.rules.filter(rule => rule.passed).length;
  return <div className="grid gap-4">
    {view.live && <LiveIndicator />}
    {view.steps.length === 0
      ? <p className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">{ko.steps.empty}</p>
      : <ol aria-label={ko.steps.title} className="grid gap-3">
        {view.steps.map(step => <StepRow key={step.step} step={step} experimentId={experimentId} runId={runId}
          highlighted={step.step === highlightStep} baselineMet={step.step === 0 ? baselineMet : undefined} />)}
      </ol>}
  </div>;
}
