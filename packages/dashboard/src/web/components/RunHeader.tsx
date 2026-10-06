import { useState } from 'react';
import { Download, ExternalLink, LoaderCircle, RotateCcw, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { RunStepsView } from '../../shared/api';
import type { Experiment, RetryPreview } from '../../shared/config';
import { api } from '../api';
import type { RouteChange } from '../hooks/useRoute';
import { outcomeReasonLabel, runStateLabel } from '../i18n/labels';
import { describeHint } from '../lib/describe';
import { durationSeconds, fastestRun, isLive, runPath, runProfileName, runStepCount, type RunRef } from '../lib/runs';
import type { PageProps } from '../pages/types';
import { Link } from './Link';
import { RetryDialog } from './RetryDialog';
import { RunStateLabel } from './RunStateLabel';
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
  const pill = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium';
  const own = (id: string) => numbers.get(id);
  const runLevel = view?.hints.filter(hint => hint.steps.length === 0) ?? [];
  return <header className="grid gap-3">
    <nav aria-label={t('runPage.breadcrumb')} className="text-[13px] text-muted-foreground">
      <Link to={{ task: run.taskId }} navigate={navigate} className="rounded-sm underline-offset-2 hover:underline">{run.snapshot.taskName}</Link> / {t('runPage.number', { n: own(run.id) ?? '' })}
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{t('runPage.number', { n: own(run.id) ?? '' })}</h1>
        {live
          ? <span className={`${pill} border-primary/40 bg-primary/10 text-primary`}><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{run.state === 'queued' ? runStateLabel('queued') : t('runPage.liveStatus', { n: latest, max: maxSteps })}</span>
          : <RunStateLabel state={run.state} className={pill} />}
        <span className="text-sm text-muted-foreground">{run.snapshot.model.name} · {profile} · {t(`sidebar.modes.${run.snapshot.mode}`)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {live && <Button variant="outline" disabled={busy} onClick={post(`${base}/cancel`)}><X aria-hidden="true" />{t('runPage.stop')}</Button>}
        {live && <Button variant="ghost" disabled={busy} onClick={post(`/experiments/${experiment.id}/cancel`)}><Square aria-hidden="true" />{t('run.stopQueue')}</Button>}
        {!live && <Button variant="outline" disabled={busy || !run.taskFile} title={run.taskFile ? undefined : t('run.noTaskFile')} onClick={previewRetry}><RotateCcw aria-hidden="true" />{t('runPage.rerun')}</Button>}
      </div>
    </div>
    {!live && steps !== undefined && <p className="text-sm">
      {t('runPage.facts', { steps })}{seconds !== undefined && ` · ${t('run.duration', { seconds: seconds.toFixed(1) })}`}
      {fastest && (fastest.ref.run.id === run.id
        ? ` · ${t('runPage.isFastest')}`
        : <> · {t('runPage.fastestLabel')} <Link to={{ task: run.taskId, run: fastest.ref.run.id }} navigate={navigate} className="rounded-sm text-primary underline-offset-2 hover:underline">{t('runPage.fastestLink', { number: own(fastest.ref.run.id) ?? '', steps: fastest.steps })}</Link></>)}
    </p>}
    {runLevel.length > 0 && <ul aria-label={t('runPage.runHints')} className="grid gap-0.5 text-sm leading-6 text-muted-foreground">{runLevel.map((hint, index) => <li key={index}>{describeHint(hint)}</li>)}</ul>}
    <div className="flex flex-wrap gap-2">
      {run.reportStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/report`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t('run.openReport')}</a></Button>}
      {run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/trace`}><Download aria-hidden="true" />{t('run.downloadTrace')}</a></Button>}
      {run.analysisStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/analysis`}><Download aria-hidden="true" />{t('run.downloadAnalysis')}</a></Button>}
      {run.diagnoseStop && run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/stop-reason`}><Download aria-hidden="true" />{t('run.downloadStopReason')}</a></Button>}
    </div>
    <div className="grid gap-1 text-sm">
      {run.snapshot.mode === 'screenreader' && run.snapshot.globals.backend === 'simulation' && <p className="text-muted-foreground">{t('run.simulationNotice')}</p>}
      {run.outcome && <p title={run.outcome.reason}>{t('run.outcome', { status: runStateLabel(run.state), reason: run.outcome.reason ? outcomeReasonLabel(run.outcome.reason) : t('run.noReason') })}</p>}
      {run.error && <p role="alert" className="text-destructive">{run.error}</p>}
      {run.analysisError && <p role="alert" className="text-destructive">{run.analysisError}</p>}
    </div>
    <RetryDialog preview={retry} busy={busy} onConfirm={confirmRetry} onClose={() => setRetry(undefined)} />
  </header>;
}
