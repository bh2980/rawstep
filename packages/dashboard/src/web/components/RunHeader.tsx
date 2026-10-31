import { useState } from 'react';
import { ArrowLeft, Download, Ellipsis, ExternalLink, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { RunStepsView } from '../../shared/api';
import type { Experiment, RetryPreview } from '../../shared/config';
import { api } from '../api';
import { useTaskFindings } from '../hooks/useTaskFindings';
import type { RouteChange } from '../hooks/useRoute';
import { outcomeReasonLabel, runStateLabel } from '../i18n/labels';
import { useNow } from '../hooks/useNow';
import { formatClock } from '../lib/format';
import { liveCurrentLine } from '../lib/stepDots';
import { runGlyphKind } from '../lib/runStrip';
import { runEnding } from '@rawstep/reports/endings';
import { roleLabel } from '../i18n/labels';
import { describeHint } from '../lib/describe';
import { durationSeconds, isLive, runConditions, runModelsName, runPath, runStepCount, type RunRef } from '../lib/runs';
import type { PageProps } from '../pages/types';
import { describeAfterRunFailure, describeRunFailure } from '../lib/errors';
import { ErrorState } from './layout/ErrorState';
import { DeleteRunsDialog } from './DeleteRunsDialog';
import { Link } from './Link';
import { RetryDialog } from './RetryDialog';
import { FactLine } from './trace/FactLine';
import { RunGlyph } from './trace/RunStrip';
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
 * One title row (run number and result left, actions right: stop while live, run again when done, the rest in a ⋯ menu with delete
 * set apart), then one line of facts and the run-level hints and failure when there are any.
 */
export function RunHeader({ runRef, numbers, view, pageProps, navigate }: Props) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  // The task may have been renamed since this run; the link says where it goes now.
  const taskName = pageProps.view.config.tasks.find(task => task.id === run.taskId)?.name ?? run.snapshot.taskName;
  const [retry, setRetry] = useState<RetryPreview>(), [deleting, setDeleting] = useState(false);
  const base = runPath(experiment.id, run.id), live = isLive(run);
  const steps = runStepCount(run), seconds = durationSeconds(run);
  // The fastest run of the run's own batch, as the server defines it (reached runs only, oldest wins a tie): the task overview of that batch shows the same one.
  const fastest = useTaskFindings(run.taskId, experiment.id).data?.facts.fastest;
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
  const own = (id: string) => numbers.get(id);
  const runLevel = view?.hints.filter(hint => hint.steps.length === 0) ?? [];
  const now = useNow(live && run.state === 'running');
  const elapsed = run.startedAt && run.state === 'running' ? Math.max(0, (now - Date.parse(run.startedAt)) / 1000) : undefined;
  const newest = view?.steps.at(-1);
  const failure = describeRunFailure(run), afterRun = describeAfterRunFailure(run);
  const reason = run.outcome?.reason && run.outcome.reason !== 'verified' && !failure ? outcomeReasonLabel(run.outcome.reason) : undefined;
  const simulated = run.snapshot.spec.backend === 'simulation';
  // How the run ended in the question's terms; a run saved before the stop source was kept has it in its hints.
  const early = view?.hints.find(hint => hint.kind === 'early-stop');
  const ended = !live && !failure ? runEnding(run.outcome, run.outcome?.stopSource ?? (typeof early?.detail.stopSource === 'string' ? early.detail.stopSource : undefined)) : undefined;
  const stretch = view?.hints.find(hint => hint.kind === 'goal-word-stretch')?.detail.moves;
  return <header className="grid gap-2">
    <nav aria-label={t('runPage.breadcrumb')}>
      <Link to={{ task: run.taskId, tab: 'runs' }} navigate={navigate} className="inline-flex min-h-7 items-center gap-1 rounded-sm text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" /><span className="sr-only">{t('runPage.backToTask')}: </span>{taskName}
      </Link>
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('runPage.number', { n: own(run.id) ?? '' })}</h1>
        {!live && <span className="inline-flex items-center gap-1.5 text-sm font-medium" title={run.outcome?.reason}>
          {ended ? <><RunGlyph kind={ended.ending === 'reached' ? 'reached' : ended.ending === 'unmeasured' ? 'inconclusive' : 'missed'} />{t(`taskPage.results.endings.${ended.ending}`)}{ended.by && <span className="font-normal text-muted-foreground">({t(`taskPage.results.by.${ended.by}`)})</span>}</>
            : <><RunGlyph kind={runGlyphKind(run.state)} />{runStateLabel(run.state)}</>}
        </span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {live && <Button variant="outline" disabled={busy} onClick={post(`${base}/cancel`)}><X aria-hidden="true" />{t('runPage.stop')}</Button>}
        {!live && <Button variant="outline" disabled={busy || !run.taskFile} title={run.taskFile ? undefined : t('run.noTaskFile')} onClick={previewRetry}><RotateCcw aria-hidden="true" />{t('runPage.rerun')}</Button>}
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
      </div>
    </div>
    {live && <div className="grid gap-1 border-l-2 border-trace pl-3">
      <div className="flex flex-wrap items-center gap-x-2 text-sm"><span aria-hidden="true" className="size-2 rounded-full bg-trace" />
        <FactLine items={[
          <strong key="s" className="font-semibold">{run.state === 'queued' ? t('runHeader.liveQueued') : t('runHeader.liveState')}</strong>,
          run.state === 'running' && t('runHeader.liveStep', { n: latest }),
          elapsed !== undefined && <span key="c" className="font-mono">{formatClock(elapsed)}</span>,
          t('runHeader.liveMax', { max: maxSteps, count: maxSteps }),
        ]} />
      </div>
      {run.state === 'running' && <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-muted-foreground">{t('runHeader.liveCurrent')}</span>
        {newest ? <span className="font-mono break-words">{liveCurrentLine(newest)}</span> : <span className="text-muted-foreground">{t('runHeader.liveWaiting')}</span>}
      </p>}
    </div>}
    <FactLine className="text-[13px] text-muted-foreground" items={[
      !live && steps !== undefined && t('runHeader.factSteps', { steps, count: steps }),
      !live && seconds !== undefined && t('runHeader.factSeconds', { seconds: seconds.toFixed(1) }),
      !live && fastest && (fastest.runId === run.id
        ? t('runHeader.factFastest')
        : <Link key="f" to={{ task: run.taskId, run: fastest.runId }} navigate={navigate} className="rounded-sm text-trace underline-offset-2 hover:underline">{t('runHeader.factFastestOther', { steps: fastest.steps, count: fastest.steps, number: own(fastest.runId) ?? '' })}</Link>),
      ended?.ending === 'reached' || ended?.ending === 'gave-up' ? undefined : reason,
      typeof stretch === 'number' && t('runHeader.factStretch', { n: stretch, count: stretch }),
      conditions.profile,
      <span key="m" title={conditions.planner}>{runModelsName(run)}</span>,
      conditions.analysis && <span key="a" title={t('runConditions.noEffect')}>{t('runHeader.analysis', { model: conditions.analysis })}</span>,
      simulated && t('run.simulationNotice'),
    ]} />
    {ended?.ending === 'gave-up' && view && <GiveUpNote view={view} step={run.outcome?.step} taskId={run.taskId} runId={run.id} navigate={navigate} />}
    {runLevel.length > 0 && <ul aria-label={t('runPage.runHints')} className="grid gap-0.5 text-sm leading-6 text-muted-foreground">{runLevel.map((hint, index) => <li key={index}>{describeHint(hint)}</li>)}</ul>}
    {failure && <ErrorState view={failure} navigate={navigate} />}
    {afterRun && <ErrorState view={afterRun} />}
    <DeleteRunsDialog open={deleting} onOpenChange={setDeleting} count={1} onConfirm={remove} />
    <RetryDialog preview={retry} busy={busy} onConfirm={confirmRetry} onClose={() => setRetry(undefined)} />
  </header>;
}

/** Why the user gave up, and the broken expectations (approaches tried) the give-up rests on, each linked to where it broke. */
function GiveUpNote({ view, step, taskId, runId, navigate }: { view: RunStepsView; step: number | undefined; taskId: string; runId: string; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const detail = view.hints.find(hint => hint.kind === 'early-stop')?.detail.giveUp as { reason?: unknown; tried?: unknown } | undefined;
  if (!detail) return null;
  const tried = Array.isArray(detail.tried) ? detail.tried.filter((id): id is string => typeof id === 'string') : [];
  const assumptions = view.plan?.document.assumptions ?? [];
  const broke = (id: string) => view.hints.find(hint => hint.kind === 'expectation-broken' && (hint.detail.assumption as { id?: unknown } | undefined)?.id === id);
  return <section aria-labelledby="giveup-reason" className="grid gap-2 rounded-md border border-edge border-l-[3px] border-l-missed bg-surface p-4">
    <h2 id="giveup-reason" className="text-sm font-semibold">{step !== undefined ? t('runHeader.giveUpTitle', { n: step }) : t('runHeader.giveUpTitleNoStep')}</h2>
    <blockquote className="text-[15px]">“{String(detail.reason ?? '')}”</blockquote>
    {tried.length > 0 && <table className="text-[13px]">
      <thead><tr className="text-xs text-muted-foreground"><th scope="col" className="pr-3 text-left font-normal">{t('runHeader.giveUpBasis')}</th><th scope="col" className="pr-3 text-left font-normal">{t('runHeader.giveUpExpected')}</th><th scope="col" className="text-left font-normal">{t('runHeader.giveUpWhere')}</th></tr></thead>
      <tbody>{tried.map(id => { const hint = broke(id), text = assumptions.find(a => a.id === id)?.text ?? (hint?.detail.assumption as { text?: string } | undefined)?.text;
        return <tr key={id} className="align-top">
          <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{id}</td>
          <td className="py-1 pr-3">{text ?? '—'}</td>
          <td className="py-1">{hint ? <Link to={{ task: taskId, run: runId, step: hint.steps[0] ?? 0 }} navigate={navigate} className="rounded-sm text-trace underline-offset-2 hover:underline">
            {[hint.target ? (hint.target.name ? `${roleLabel(hint.target.role)} “${hint.target.name}”` : roleLabel(hint.target.role)) : undefined, t('runHeader.giveUpAtStep', { n: hint.steps[0] ?? 0 })].filter(Boolean).join(' · ')}</Link> : '—'}</td>
        </tr>; })}</tbody>
    </table>}
    <p className="text-xs text-muted-foreground">{t('taskPage.results.giveUpNote')}</p>
  </section>;
}
