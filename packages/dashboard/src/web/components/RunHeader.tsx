import { useState, type ReactNode } from 'react';
import { Download, ExternalLink, RotateCcw, Square, X } from 'lucide-react';
import type { RunHintsView } from '../../shared/api';
import type { Experiment, RetryPreview } from '../../shared/config';
import { api } from '../api';
import { useTranslation } from 'react-i18next';
import { outcomeReasonLabel, runStateLabel, versusLabel } from '../i18n/labels';
import { durationSeconds, isLive, runPath, runProfileName, runStepCount, type RunRef } from '../lib/runs';
import type { PageProps } from '../pages/types';
import { Button } from './ui/button';
import { RunStateLabel } from './RunStateLabel';
import { RetryDialog } from './RetryDialog';

type Props = { runRef: RunRef; hints: RunHintsView | undefined; pageProps: PageProps; onOpenRun: (runId: string, taskId: string) => void };

/** Run title, facts (state, steps, duration, vs reference) and run actions. */
export function RunHeader({ runRef, hints, pageProps, onOpenRun }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const [retry, setRetry] = useState<RetryPreview>();
  const base = runPath(experiment.id, run.id), live = isLive(run);
  const steps = runStepCount(run), seconds = durationSeconds(run);
  const extra = hints?.reference && steps !== undefined ? steps - hints.reference.steps : undefined;
  const profile = runProfileName(pageProps.view.config.profiles, run);
  const { act, busy } = pageProps;
  const post = (path: string) => () => void act(() => api(path, { method: 'POST' }));
  const previewRetry = () => void act(async () => setRetry(await api<RetryPreview>(`${base}/retry`)));
  const confirmRetry = () => void act(async () => {
    if (!retry) return;
    const created = await api<Experiment>(`${base}/retry`, { method: 'POST', body: { revision: retry.revision } });
    setRetry(undefined);
    onOpenRun(created.runs[0]!.id, run.taskId);
  });
  return <header className="grid gap-4">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{run.snapshot.taskName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {run.snapshot.model.name} · {run.snapshot.prompt.name} · {profile} · {t(`sidebar.modes.${run.snapshot.mode}`)} · {t('sidebar.repeat', { n: run.repeat })}
      </p>
    </div>
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <Fact label={t('run.facts.state')}><RunStateLabel state={run.state} className="font-medium" /></Fact>
      {steps !== undefined && <Fact label={t('run.facts.steps')}>{t('run.steps', { n: steps })}</Fact>}
      {seconds !== undefined && <Fact label={t('run.facts.duration')}>{t('run.duration', { seconds: seconds.toFixed(1) })}</Fact>}
      {extra !== undefined && <Fact label={t('run.facts.reference')}><span className="font-medium">{versusLabel(extra)}</span></Fact>}
    </dl>
    <div className="flex flex-wrap gap-2">
      {live && <Button variant="outline" size="sm" disabled={busy} onClick={post(`${base}/cancel`)}><X aria-hidden="true" />{t('run.cancel')}</Button>}
      {live && <Button variant="ghost" size="sm" disabled={busy} onClick={post(`/experiments/${experiment.id}/cancel`)}><Square aria-hidden="true" />{t('run.stopQueue')}</Button>}
      {!live && <Button variant="outline" size="sm" disabled={busy || !run.taskFile} title={run.taskFile ? undefined : t('run.noTaskFile')} onClick={previewRetry}><RotateCcw aria-hidden="true" />{t('run.retry')}</Button>}
      {run.reportStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/report`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t('run.openReport')}</a></Button>}
      {run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/trace`}><Download aria-hidden="true" />{t('run.downloadTrace')}</a></Button>}
      {run.analysisStatus === 'complete' && <Button variant="outline" size="sm" asChild><a href={`/api${base}/analysis`}><Download aria-hidden="true" />{t('run.downloadAnalysis')}</a></Button>}
      {run.diagnoseStop && run.outcome && <Button variant="outline" size="sm" asChild><a href={`/api${base}/stop-reason`}><Download aria-hidden="true" />{t('run.downloadStopReason')}</a></Button>}
    </div>
    <RunNotices runRef={runRef} />
    <RetryDialog preview={retry} busy={busy} onConfirm={confirmRetry} onClose={() => setRetry(undefined)} />
  </header>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline gap-2"><dt className="sr-only">{label}</dt><dd>{children}</dd></div>;
}

function RunNotices({ runRef }: { runRef: RunRef }) {
  const { t } = useTranslation();
  const { run } = runRef;
  return <div className="grid gap-1 text-sm">
    {run.snapshot.mode === 'screenreader' && run.snapshot.globals.backend === 'simulation' && <p className="text-muted-foreground">{t('run.simulationNotice')}</p>}
    {run.promptSource === 'server' && <p className="text-muted-foreground">{t('run.serverPromptNotice')}</p>}
    {run.outcome && <p title={run.outcome.reason}>{t('run.outcome', { status: runStateLabel(run.state), reason: run.outcome.reason ? outcomeReasonLabel(run.outcome.reason) : t('run.noReason') })}</p>}
    {run.error && <p role="alert" className="text-destructive">{run.error}</p>}
    {run.analysisError && <p role="alert" className="text-destructive">{run.analysisError}</p>}
  </div>;
}
