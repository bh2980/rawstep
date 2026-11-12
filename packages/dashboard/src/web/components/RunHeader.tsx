import { useState } from 'react';
import { Download, Ellipsis, ExternalLink, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { RunStepsView } from '../../shared/api';
import type { Experiment, RetryPreview } from '../../shared/config';
import { api } from '../api';
import type { RouteChange } from '../hooks/useRoute';
import { useNow } from '../hooks/useNow';
import { describeHint } from '../lib/describe';
import { describeAfterRunFailure, describeRunFailure } from '../lib/errors';
import { formatClock } from '../lib/format';
import { plannerWait } from '../lib/plan';
import { runStatus } from '../lib/runStrip';
import { durationSeconds, isLive, runConditions, runModelsName, runPath, runStepCount, type RunRef } from '../lib/runs';
import { liveCurrentLine } from '../lib/stepDots';
import type { PageProps } from '../pages/types';
import { DeleteRunsDialog } from './DeleteRunsDialog';
import { ErrorState } from './layout/ErrorState';
import { PageHeader } from './PageHeader';
import { RetryDialog } from './RetryDialog';
import { StatusMark, StatusShape } from './StatusMark';
import { Time } from './Time';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

type Props = {
  runRef: RunRef;
  /** Run numbers of the task. */
  numbers: ReadonlyMap<string, number>;
  view: RunStepsView | undefined;
  pageProps: PageProps; navigate: (change: RouteChange) => void;
};

/**
 * The crumb back to the task, the title (status shape + run number), one meta line (when, profile, model, moves, seconds, planner wait
 * and, once, that it was a simulation) and the actions: stop while live, run again when done, the rest in ⋯ with delete set apart.
 * A live run adds what it is doing now; run-level hints and a failure follow.
 */
export function RunHeader({ runRef, numbers, view, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  // The task may have been renamed since this run; the crumb says where it goes now.
  const taskName = pageProps.view.config.tasks.find(task => task.id === run.taskId)?.name ?? run.snapshot.taskName;
  const [retry, setRetry] = useState<RetryPreview>(), [deleting, setDeleting] = useState(false);
  const base = runPath(experiment.id, run.id), live = isLive(run);
  const steps = runStepCount(run), seconds = durationSeconds(run);
  const latest = view?.steps.at(-1)?.step ?? 0, maxSteps = run.snapshot.spec.task.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps;
  const conditions = runConditions(run, pageProps.view.config);
  const { act, busy } = pageProps;
  const post = (path: string) => () => void act(() => api(path, { method: 'POST' }));
  const previewRetry = () => void act(async () => setRetry(await api<RetryPreview>(`${base}/retry`)));
  const confirmRetry = () => void act(async () => {
    if (!retry) return;
    const created = await api<Experiment>(`${base}/retry`, { method: 'POST', body: { revision: retry.revision } });
    setRetry(undefined);
    navigate({ task: run.taskId, run: created.runs[0]!.id });
  });
  const remove = () => { setDeleting(false); void act(async () => {
    await api(base, { method: 'DELETE' });
    navigate({ task: run.taskId, tab: 'runs' });
    pageProps.notify(t('runDelete.done', { count: 1 }));
  }); };
  const runLevel = view?.hints.filter(hint => hint.steps.length === 0) ?? [];
  const now = useNow(live && run.state === 'running');
  const elapsed = run.startedAt && run.state === 'running' ? Math.max(0, (now - Date.parse(run.startedAt)) / 1000) : undefined;
  const newest = view?.steps.at(-1);
  const failure = describeRunFailure(run), afterRun = describeAfterRunFailure(run);
  const { status, by } = runStatus(run);
  const wait = view?.plan ? plannerWait(view.plan.calls) : 0;
  const simulated = run.snapshot.spec.backend === 'simulation';

  const meta = [
    <Time key="time" value={run.startedAt ?? experiment.createdAt} />,
    live && <StatusMark key="live" status={status} />,
    elapsed !== undefined && <span key="clock" className="tabular-nums">{formatClock(elapsed)}</span>,
    by && <StatusMark key="by" status={status} why={t(`taskPage.results.by.${by}`)} />,
    conditions.profile,
    <span key="model" title={conditions.planner}>{runModelsName(run)}</span>,
    live ? run.state === 'running' && <span key="n" className="tabular-nums">{t('runHeader.liveStep', { n: latest })} / {maxSteps}</span>
      : steps !== undefined && <span key="n" className="tabular-nums">{t('runHeader.factSteps', { steps, count: steps })}</span>,
    !live && seconds !== undefined && <span key="s" className="tabular-nums">{t('runHeader.factSeconds', { seconds: seconds.toFixed(1) })}</span>,
    wait > 0 && <span key="w" className="tabular-nums">{t('planDoc.factWait', { seconds: wait.toFixed(1) })}</span>,
    conditions.analysis && <span key="a" title={t('runConditions.noEffect')}>{t('runHeader.analysis', { model: conditions.analysis })}</span>,
    simulated && t('run.simulationNotice'),
  ];

  const actions = <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t('runPage.moreActions')}><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {live && <DropdownMenuItem disabled={busy} onSelect={post(`/experiments/${experiment.id}/cancel`)}><Square aria-hidden="true" />{t('run.stopQueue')}</DropdownMenuItem>}
        {run.reportStatus === 'complete' && <DropdownMenuItem asChild><a href={`/api${base}/report`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t('run.openReport')}</a></DropdownMenuItem>}
        {run.outcome && <DropdownMenuItem asChild><a href={`/api${base}/trace`}><Download aria-hidden="true" />{t('run.downloadTrace')}</a></DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy || live} onSelect={() => setDeleting(true)}><Trash2 aria-hidden="true" />{t('runDelete.action')}{live && <span className="sr-only"> — {t('runDelete.liveReason')}</span>}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {live
      ? <Button variant="outline" disabled={busy} onClick={post(`${base}/cancel`)}><X aria-hidden="true" />{t('runPage.stop')}</Button>
      : <Button variant="outline" disabled={busy || !run.taskFile} title={run.taskFile ? undefined : t('run.noTaskFile')} onClick={previewRetry}><RotateCcw aria-hidden="true" />{t('runPage.rerun')}</Button>}
  </>;

  return <>
    <PageHeader navigate={navigate} crumbs={[{ label: t('nav.tasks'), to: { view: 'tasks' } }, { label: taskName, to: { task: run.taskId, tab: 'runs' } }]}
      title={<><StatusShape status={status} className="size-3" />{t('runPage.number', { n: numbers.get(run.id) ?? '' })}<span className="text-md font-normal text-ink-2">{t(`status.${status}`)}</span></>}
      meta={meta} actions={actions} className={live || runLevel.length || failure || afterRun ? 'mb-3' : 'mb-6'} />
    {run.state === 'running' && <div className="mb-6 grid gap-0.5 text-sm">
      <p><span className="text-ink-2">{t('runHeader.liveCurrent')} </span>
        {newest ? <span className="break-words">{liveCurrentLine(newest)}</span> : <span className="text-ink-2">{t('runHeader.liveWaiting')}</span>}</p>
      {view?.plannerWaiting && <p className="text-ink-2">{t('runHeader.plannerThinking', { seconds: Math.max(0, Math.round((now - Date.parse(view.plannerWaiting.since)) / 1000)) })}</p>}
    </div>}
    {runLevel.length > 0 && <ul aria-label={t('runPage.runHints')} className="mb-6 grid gap-0.5 text-sm text-ink-2">{runLevel.map((hint, index) => <li key={index}>{describeHint(hint)}</li>)}</ul>}
    {failure && <div className="mb-6"><ErrorState view={failure} navigate={navigate} /></div>}
    {afterRun && <div className="mb-6"><ErrorState view={afterRun} /></div>}
    <DeleteRunsDialog open={deleting} onOpenChange={setDeleting} count={1} onConfirm={remove} />
    <RetryDialog preview={retry} busy={busy} onConfirm={confirmRetry} onClose={() => setRetry(undefined)} />
  </>;
}
