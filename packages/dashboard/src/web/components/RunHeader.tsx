import { useState } from 'react';
import { Download, ExternalLink, RotateCcw, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { RunStepsView } from '../../shared/api';
import type { Experiment, RetryPreview } from '../../shared/config';
import { api } from '../api';
import type { RouteChange } from '../hooks/useRoute';
import { outcomeReasonLabel, runStateLabel } from '../i18n/labels';
import { useNow } from '../hooks/useNow';
import { formatClock } from '../lib/format';
import { liveCurrentLine } from '../lib/stepDots';
import { runGlyphKind } from '../lib/runStrip';
import { describeHint } from '../lib/describe';
import { durationSeconds, fastestRun, isLive, runPath, runProfileName, runStepCount, type RunRef } from '../lib/runs';
import type { PageProps } from '../pages/types';
import { describeAfterRunFailure, describeRunFailure } from '../lib/errors';
import { ErrorState } from './layout/ErrorState';
import { Link } from './Link';
import { RetryDialog } from './RetryDialog';
import { FactLine } from './trace/FactLine';
import { RunGlyph } from './trace/RunStrip';
import { Button } from './ui/button';

type Props = {
  runRef: RunRef;
  /** Every run of the task, for the fastest run and the run numbers. */
  taskRuns: RunRef[]; numbers: ReadonlyMap<string, number>;
  view: RunStepsView | undefined;
  pageProps: PageProps; navigate: (change: RouteChange) => void;
};

/** Run title with its state, the facts of the run, the run-level hints and the actions: stop while live, run again when done. */
export function RunHeader({ runRef, taskRuns, numbers, view, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const [retry, setRetry] = useState<RetryPreview>();
  const base = runPath(experiment.id, run.id), live = isLive(run);
  const steps = runStepCount(run), seconds = durationSeconds(run), fastest = fastestRun(taskRuns);
  const latest = view?.steps.at(-1)?.step ?? 0, maxSteps = run.snapshot.task.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps;
  const profile = runProfileName(pageProps.view.config.profiles, run);
  const { act, busy } = pageProps;
  const post = (path: string) => () => void act(() => api(path, { method: 'POST' }));
  const previewRetry = () => void act(async () => setRetry(await api<RetryPreview>(`${base}/retry`)));
  const confirmRetry = () => void act(async () => {
    if (!retry) return;
    const created = await api<Experiment>(`${base}/retry`, { method: 'POST', body: { revision: retry.revision } });
    setRetry(undefined);
    navigate({ task: run.taskId, run: created.runs[0]!.id });
  });
  const own = (id: string) => numbers.get(id);
  const runLevel = view?.hints.filter(hint => hint.steps.length === 0) ?? [];
  const now = useNow(live && run.state === 'running');
  const elapsed = run.startedAt && run.state === 'running' ? Math.max(0, (now - Date.parse(run.startedAt)) / 1000) : undefined;
  const newest = view?.steps.at(-1);
  const failure = describeRunFailure(run), afterRun = describeAfterRunFailure(run);
  return <header className="grid gap-3">
    <nav aria-label={t('runPage.breadcrumb')} className="text-[13px] text-muted-foreground">
      <Link to={{ task: run.taskId }} navigate={navigate} className="rounded-sm underline-offset-2 hover:underline">{run.snapshot.taskName}</Link> / {t('runPage.number', { n: own(run.id) ?? '' })}
    </nav>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{t('runPage.number', { n: own(run.id) ?? '' })}</h1>
          {!live && <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge-strong px-2 py-0.5 text-[13px]">
            <RunGlyph kind={runGlyphKind(run.state)} /><span className="text-muted-foreground">{t('runHeader.outcomeLabel')}</span><span className="font-medium">{runStateLabel(run.state)}</span>
          </span>}
        </div>
        <p className="text-sm text-muted-foreground">{t('runHeader.conditions', { mode: t(`sidebar.modes.${run.snapshot.mode}`), model: run.snapshot.model.name, profile })}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {live && <Button variant="outline" disabled={busy} onClick={post(`${base}/cancel`)}><X aria-hidden="true" />{t('runPage.stop')}</Button>}
        {live && <Button variant="ghost" disabled={busy} onClick={post(`/experiments/${experiment.id}/cancel`)}><Square aria-hidden="true" />{t('run.stopQueue')}</Button>}
        {!live && <Button variant="outline" disabled={busy || !run.taskFile} title={run.taskFile ? undefined : t('run.noTaskFile')} onClick={previewRetry}><RotateCcw aria-hidden="true" />{t('runPage.rerun')}</Button>}
      </div>
    </div>
    {live && <div className="grid gap-1 border-l-2 border-trace pl-3">
      <div className="flex flex-wrap items-center gap-x-2 text-sm"><span aria-hidden="true" className="size-2 rounded-full bg-trace" />
        <FactLine items={[
          <strong key="s" className="font-semibold">{run.state === 'queued' ? t('runHeader.liveQueued') : t('runHeader.liveState')}</strong>,
          run.state === 'running' && t('runHeader.liveStep', { n: latest }),
          elapsed !== undefined && <span key="c" className="font-mono">{formatClock(elapsed)}</span>,
          t('runHeader.liveMax', { max: maxSteps }),
        ]} />
      </div>
      {run.state === 'running' && <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-muted-foreground">{t('runHeader.liveCurrent')}</span>
        {newest ? <span className="font-mono break-words">{liveCurrentLine(newest)}</span> : <span className="text-muted-foreground">{t('runHeader.liveWaiting')}</span>}
      </p>}
    </div>}
    {!live && steps !== undefined && <FactLine items={[
      t('runHeader.factSteps', { steps }),
      seconds !== undefined && t('runHeader.factSeconds', { seconds: seconds.toFixed(1) }),
      fastest && (fastest.ref.run.id === run.id
        ? t('runHeader.factFastest')
        : <Link key="f" to={{ task: run.taskId, run: fastest.ref.run.id }} navigate={navigate} className="rounded-sm text-trace underline-offset-2 hover:underline">{t('runHeader.factFastestOther', { steps: fastest.steps, number: own(fastest.ref.run.id) ?? '' })}</Link>),
    ]} />}
    {runLevel.length > 0 && <ul aria-label={t('runPage.runHints')} className="grid gap-0.5 text-sm leading-6 text-muted-foreground">{runLevel.map((hint, index) => <li key={index}>{describeHint(hint)}</li>)}</ul>}
    <div className="flex flex-wrap gap-2">
      {run.reportStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/report`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t('run.openReport')}</a></Button>}
      {run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/trace`}><Download aria-hidden="true" />{t('run.downloadTrace')}</a></Button>}
      {run.analysisStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/analysis`}><Download aria-hidden="true" />{t('run.downloadAnalysis')}</a></Button>}
      {run.diagnoseStop && run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/stop-reason`}><Download aria-hidden="true" />{t('run.downloadStopReason')}</a></Button>}
    </div>
    <div className="grid gap-1 text-sm">
      {run.snapshot.mode === 'screenreader' && run.snapshot.globals.backend === 'simulation' && <p className="text-muted-foreground">{t('run.simulationNotice')}</p>}
      {run.outcome && !failure && <p title={run.outcome.reason}>{t('run.outcome', { status: runStateLabel(run.state), reason: run.outcome.reason ? outcomeReasonLabel(run.outcome.reason) : t('run.noReason') })}</p>}
    </div>
    {failure && <ErrorState view={failure} navigate={navigate} />}
    {afterRun && <ErrorState view={afterRun} />}
    <RetryDialog preview={retry} busy={busy} onConfirm={confirmRetry} onClose={() => setRetry(undefined)} />
  </header>;
}
