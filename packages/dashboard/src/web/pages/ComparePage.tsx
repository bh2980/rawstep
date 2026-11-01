import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComparedRun } from '../../shared/api';
import { CompareSummary, ENOUGH_RUNS } from '../components/CompareSummary';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { RunGlyph } from '../components/trace/RunStrip';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { useRunComparison } from '../hooks/useRunComparison';
import type { RouteChange } from '../hooks/useRoute';
import { targetLabel } from '../i18n/labels';
import { MAX_COMPARE, compareDifferences, describeRuns, groupRuns, type CompareRun } from '../lib/compare';
import { dataFailureView } from '../lib/errors';
import { countOf, formatDate } from '../lib/format';
import { endingGlyph, finishedEnding, resultLabel } from '../lib/runStrip';
import { cn } from '../lib/utils';
import { findRun, runConditions, runStartedAt, taskNameOf, taskRunNumbers, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = { pageProps: PageProps; runs: readonly RunRef[]; ids: readonly string[]; navigate: (change: RouteChange) => void };

const head = 'px-3 py-2 text-left align-top text-xs font-medium text-muted-foreground';
const cell = 'min-w-48 px-3 py-2.5 align-top';

/**
 * Runs of any tasks and batches as columns, one row per measure: the task and its goal, the profile, how each ended, what it cost,
 * the longest stretch without a goal word, wrong guesses and the stuck places. At the top, a few sentences say what changed and
 * whether the runs differ in something other than the page. It counts and never says which run is better.
 */
export function ComparePage({ pageProps, runs, ids, navigate }: Props) {
  const { t } = useTranslation();
  const { config } = pageProps.view;
  const refs = useMemo(() => ids.map(id => findRun(runs, id)).filter((ref): ref is RunRef => !!ref).slice(0, MAX_COMPARE), [ids, runs]);
  const comparison = useRunComparison(refs.map(ref => ({ experiment: ref.experiment.id, run: ref.run.id })));
  const numbers = useMemo(() => new Map([...new Set(runs.map(ref => ref.run.taskId))].flatMap(id => [...taskRunNumbers(runs, id)])), [runs]);
  const items: CompareRun[] = refs.map(ref => ({ ref, taskName: taskNameOf(ref.run, config.tasks), compared: comparison.data?.runs.find(item => item.runId === ref.run.id) }));
  const { groups } = groupRuns(items), columns = groups.flatMap(group => group.items);
  const differences = compareDifferences(refs.map(ref => ({ run: ref.run, profile: runConditions(ref.run, config).profile })));
  const missing = ids.length - refs.length;
  const back = <Link to={{ view: 'runs' }} navigate={navigate} className="text-sm text-muted-foreground underline-offset-2 hover:underline">← {t('run.backToRuns')}</Link>;

  if (refs.length < 2) return <div className="grid gap-4">
    <PageHeader title={t('runCompare.title')} crumb={back} />
    <EmptyState title={t('runCompare.notEnough')} action={<Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>} />
  </div>;
  const differs = differences.profiles.length > 0 || differences.goals.length > 0 || differences.parts.length > 0;
  return <div className="grid gap-4">
    <PageHeader title={t('runCompare.title')} meta={t('runCompare.meta', { count: refs.length })} crumb={back} />
    {missing > 0 && <p className="text-xs text-muted-foreground">{t('runCompare.missing', { count: missing })}</p>}
    {comparison.loading && !comparison.data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-48" /></div>}
    {comparison.error && !comparison.data && <ErrorState view={dataFailureView(t('runCompare.failed'), comparison.error)} />}
    {comparison.data && <>
      <section aria-label={t('runCompare.summaryLabel')} className="grid gap-3 rounded-md border border-edge bg-surface px-4 py-3">
        <CompareSummary lines={describeRuns(items)} few={groups.some(group => group.items.length < ENOUGH_RUNS)} />
        <div aria-label={t('runCompare.differencesLabel')} role="group" className={cn('grid gap-1 text-xs', differs ? 'text-inspect' : 'text-muted-foreground')}>
          {differences.profiles.length > 0 && <p>{t('runCompare.profilesDiffer', { list: differences.profiles.join(', ') })}</p>}
          {differences.goals.length > 0 && <p>{t('runCompare.goalsDiffer')}</p>}
          {differences.parts.length > 0 && <p>{t('runCompare.partsDiffer', { parts: differences.parts.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') })}</p>}
          {!differs && <p>{t('runCompare.conditionsSame')}</p>}
        </div>
      </section>
      <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <table className="w-full text-[13px]">
          <caption className="sr-only">{t('runCompare.tableCaption')}</caption>
          <thead><tr className="bg-raised">
            <td className={head} />
            {columns.map(({ ref }) => <th key={ref.run.id} scope="col" className={head + ' text-foreground'}>
              <span className="block text-sm font-semibold">{t('runCompare.runName', { n: numbers.get(ref.run.id) ?? '—' })}</span>
              <span className="block font-mono font-normal tabular-nums text-muted-foreground">{formatDate(runStartedAt(ref))}</span>
            </th>)}
          </tr></thead>
          <tbody>
            <Row label={t('runCompare.rows.task')}>{columns.map(({ ref, taskName }) => <td key={ref.run.id} className={cell}>
              <Link to={{ task: ref.run.taskId }} navigate={navigate} className="font-medium underline-offset-2 hover:underline">{taskName}</Link>
              <span className="mt-0.5 line-clamp-4 block text-xs text-muted-foreground">{String(ref.run.snapshot.spec.task.goal ?? '')}</span>
            </td>)}</Row>
            <Row label={t('runCompare.rows.profile')}>{columns.map(({ ref }) => <td key={ref.run.id} className={cell}>{runConditions(ref.run, config).profile}</td>)}</Row>
            <Row label={t('runCompare.rows.ending')}>{columns.map(({ ref, compared }) => <td key={ref.run.id} className={cell}>
              <span className="inline-flex items-center gap-1.5">{compared?.result && finishedEnding(ref.run) ? <RunGlyph kind={endingGlyph(compared.result.ending)} /> : null}{compared?.result ? resultLabel(ref.run) : t('runCompare.noResult')}</span>
              {compared && !compared.result && <span className="block text-xs text-muted-foreground">{t('runCompare.noResultWhy')}</span>}
            </td>)}</Row>
            <Row label={t('runCompare.rows.moves')}>{columns.map(({ ref, compared }) => <td key={ref.run.id} className={cell + ' tabular-nums'}>{moves(compared, compared?.result?.steps)}</td>)}</Row>
            <Row label={t('runCompare.rows.stretch')}>{columns.map(({ ref, compared }) => <td key={ref.run.id} className={cell + ' tabular-nums'}>{moves(compared, compared?.result?.stretch)}</td>)}</Row>
            <Row label={t('runCompare.rows.wrongGuesses')}>{columns.map(({ ref, compared }) => <td key={ref.run.id} className={cell + ' tabular-nums'}>
              {compared?.result ? t('taskPage.results.guesses', { n: compared.result.wrongGuesses }) : '—'}</td>)}</Row>
            <Row label={t('runCompare.rows.stuck')}>{columns.map(({ ref, compared }) => <td key={ref.run.id} className={cell}>
              {!compared?.result ? '—' : compared.stuck.length === 0 ? <span className="text-muted-foreground">{t('taskPage.results.none')}</span>
                : <ul className="grid gap-1">{firstSteps(compared).map(item => <li key={`${item.label}`}>
                  <Link to={{ task: ref.run.taskId, run: ref.run.id, step: item.step }} navigate={navigate} title={t('runCompare.openAt', { step: item.step })} className="underline-offset-2 hover:underline">{item.label}</Link>
                </li>)}</ul>}
            </td>)}</Row>
            <Row label={t('runCompare.rows.open')}>{columns.map(({ ref }) => <td key={ref.run.id} className={cell}>
              <Link to={{ task: ref.run.taskId, run: ref.run.id }} navigate={navigate} className="font-medium text-trace underline underline-offset-2">{t('runCompare.open')}<span className="sr-only"> {t('runCompare.runName', { n: numbers.get(ref.run.id) ?? '—' })}</span></Link>
            </td>)}</Row>
          </tbody>
        </table>
      </div>
    </>}
  </div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <tr className="border-t border-edge"><th scope="row" className={head + ' min-w-32 whitespace-normal'}>{label}</th>{children}</tr>;
}

/** A number of moves in words; a dash when the run has no result or no such number. */
function moves(compared: ComparedRun | undefined, value: number | null | undefined) {
  if (!compared?.result) return '—';
  return value === null || value === undefined ? '—' : <MoveCount n={value} />;
}
function MoveCount({ n }: { n: number }) {
  const { t } = useTranslation();
  return <>{t('taskPage.results.moves', { n, ...countOf(n) })}</>;
}

/** The stuck places of a run once each, with the first step it got stuck at. */
function firstSteps(compared: ComparedRun): { label: string; step: number }[] {
  const seen = new Map<string, number>();
  for (const item of compared.stuck) { const label = targetLabel(item.target); if (!seen.has(label) || item.step < seen.get(label)!) seen.set(label, item.step); }
  return [...seen].map(([label, step]) => ({ label, step }));
}
