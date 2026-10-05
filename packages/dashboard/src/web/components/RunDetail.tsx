import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isFinished, isLive, type RunRef } from '../lib/runs';
import { rememberHintSummary } from '../hooks/useHintSummaries';
import { useRunHints, useRunSteps } from '../hooks/useRunData';
import type { Route, RouteChange, RunTab } from '../hooks/useRoute';
import type { PageProps } from '../pages/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { RunHeader } from './RunHeader';
import { HintsPanel } from './HintsPanel';
import { StepTimeline } from './StepTimeline';
import { RunCompare } from './RunCompare';
import { EventsPanel } from './EventsPanel';

type Props = { runRef: RunRef; route: Route; pageProps: PageProps; navigate: (change: RouteChange, options?: { replace?: boolean }) => void };

/** Header plus the hints / steps / compare / events tabs for the selected run. Mount with `key={run.id}`. */
export function RunDetail({ runRef, route, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const hints = useRunHints(experiment.id, run.id);
  const live = isLive(run);
  useEffect(() => {
    if (hints.data && isFinished(run)) rememberHintSummary(run.id, hints.data.hints);
  }, [hints.data, run.id, run.state]);
  const at = (tab: RunTab, step?: number) => navigate({ task: run.taskId, run: run.id, tab, ...(step !== undefined ? { step } : {}) }, { replace: step === undefined });
  const openRun = (runId: string, taskId = run.taskId) => navigate({ task: taskId, run: runId, tab: route.tab });
  return <div className="grid gap-6">
    <RunHeader runRef={runRef} hints={hints.data} pageProps={pageProps} onOpenRun={openRun} />
    <Tabs value={route.tab} onValueChange={tab => at(tab as RunTab)}>
      <TabsList aria-label={t('run.tabsLabel')}>
        <TabsTrigger value="hints">{t('run.tabs.hints')}{hints.data ? ` ${hints.data.hints.length}` : ''}</TabsTrigger>
        <TabsTrigger value="steps">{t('run.tabs.steps')}</TabsTrigger>
        <TabsTrigger value="compare">{t('run.tabs.compare')}</TabsTrigger>
        <TabsTrigger value="events">{t('run.tabs.events')}</TabsTrigger>
      </TabsList>
      <TabsContent value="hints" className="pt-4">
        <h2 className="sr-only">{t('hints.title')}</h2>
        <HintsPanel hints={hints.data} error={hints.error} loading={hints.loading} live={live} onJump={step => at('steps', step)} />
      </TabsContent>
      <TabsContent value="steps" className="pt-4">
        <h2 className="sr-only">{t('steps.title')}</h2>
        <StepsTab experimentId={experiment.id} runId={run.id} highlightStep={route.step} />
      </TabsContent>
      <TabsContent value="compare" className="pt-4">
        <h2 className="sr-only">{t('compare.title')}</h2>
        <CompareTab experimentId={experiment.id} runId={run.id} hints={hints.data} onOpenRun={id => openRun(id)} />
      </TabsContent>
      <TabsContent value="events" className="pt-4">
        <h2 className="sr-only">{t('run.tabs.events')}</h2>
        <EventsPanel experimentId={experiment.id} run={run} />
      </TabsContent>
    </Tabs>
  </div>;
}

function StepsTab({ experimentId, runId, highlightStep }: { experimentId: string; runId: string; highlightStep: number | undefined }) {
  const steps = useRunSteps(experimentId, runId);
  return <StepTimeline view={steps.data} error={steps.error} loading={steps.loading} highlightStep={highlightStep} experimentId={experimentId} runId={runId} />;
}

function CompareTab({ experimentId, runId, hints, onOpenRun }: { experimentId: string; runId: string; hints: Parameters<typeof RunCompare>[0]['hints']; onOpenRun: (runId: string) => void }) {
  const steps = useRunSteps(experimentId, runId);
  return <RunCompare experimentId={experimentId} runId={runId} steps={steps.data?.steps} hints={hints} onOpenRun={onOpenRun} />;
}
