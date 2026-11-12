import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComparedRun } from '../../shared/api';
import { CompareSummary } from '../components/CompareSummary';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { Dash, PageHeader } from '../components/PageHeader';
import { Link } from '../components/Link';
import { stopReason } from '../components/RunsTable';
import { StatusMark } from '../components/StatusMark';
import { Time } from '../components/Time';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useRunComparison } from '../hooks/useRunComparison';
import type { RouteChange } from '../hooks/useRoute';
import { targetLabel } from '../i18n/labels';
import { MAX_COMPARE, compareDifferences, describeRuns, groupRuns, type CompareRun } from '../lib/compare';
import { dataFailureView } from '../lib/errors';
import { countOf } from '../lib/format';
import { runStatus } from '../lib/runStrip';
import { cn } from '../lib/utils';
import { findRun, runConditions, runStartedAt, taskNameOf, taskRunNumbers, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = { pageProps: PageProps; runs: readonly RunRef[]; ids: readonly string[]; navigate: (change: RouteChange) => void };

const link = 'underline decoration-edge-strong underline-offset-4 hover:decoration-foreground';

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
  const crumbs = [{ label: t('runList.title'), to: { view: 'runs' as const } }];

  if (refs.length < 2) return <>
    <PageHeader title={t('runCompare.title')} crumbs={crumbs} navigate={navigate} />
    <EmptyState title={t('runCompare.notEnough')} action={<Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>} />
  </>;
  const differs = differences.profiles.length > 0 || differences.goals.length > 0 || differences.parts.length > 0;
  return <>
    <PageHeader title={t('runCompare.title')} crumbs={crumbs} navigate={navigate}
      meta={[t('runCompare.meta', { count: refs.length }), missing > 0 && t('runCompare.missing', { count: missing })]} />
    {comparison.loading && !comparison.data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-48" /></div>}
    {comparison.error && !comparison.data && <ErrorState view={dataFailureView(t('runCompare.failed'), comparison.error)} />}
    {comparison.data && <>
      <section aria-label={t('runCompare.summaryLabel')} className="mb-4 grid gap-2">
        <CompareSummary lines={describeRuns(items)} />
        <div aria-label={t('runCompare.differencesLabel')} role="group" className={cn('grid gap-0.5 text-sm', differs ? 'text-foreground' : 'text-ink-2')}>
          {differences.profiles.length > 0 && <p>{t('runCompare.profilesDiffer', { list: differences.profiles.join(', ') })}</p>}
          {differences.goals.length > 0 && <p>{t('runCompare.goalsDiffer')}</p>}
          {differences.parts.length > 0 && <p>{t('runCompare.partsDiffer', { parts: differences.parts.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') })}</p>}
          {!differs && <p>{t('runCompare.conditionsSame')}</p>}
        </div>
      </section>
      <Table className="table-fixed" style={{ minWidth: `${10 + columns.length * 13}rem` }}>
        <TableCaption className="sr-only">{t('runCompare.tableCaption')}</TableCaption>
        <colgroup><col className="w-40" />{columns.map(({ ref }) => <col key={ref.run.id} />)}</colgroup>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead><span className="sr-only">{t('runCompare.rows.measure')}</span></TableHead>
          {columns.map(({ ref, taskName }) => <TableHead key={ref.run.id} scope="col" className="h-auto py-2 align-bottom">
            <span className="block truncate text-base text-foreground">{taskName}<span className="ml-1 tabular-nums text-ink-3">#{numbers.get(ref.run.id) ?? '—'}</span></span>
            <span className="block font-normal tabular-nums"><Time value={runStartedAt(ref)} /></span>
          </TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          <Row label={t('runCompare.rows.task')}>{columns.map(({ ref, taskName }) => <TableCell key={ref.run.id} className="whitespace-normal">
            <Link to={{ task: ref.run.taskId }} navigate={navigate} className={'font-medium ' + link}>{taskName}</Link>
            <span className="mt-0.5 line-clamp-3 block text-sm text-ink-2">{String(ref.run.snapshot.spec.task.goal ?? '')}</span>
          </TableCell>)}</Row>
          <Row label={t('runCompare.rows.profile')}>{columns.map(({ ref }) => <TableCell key={ref.run.id} className="truncate">{runConditions(ref.run, config).profile}</TableCell>)}</Row>
          <Row label={t('runCompare.rows.ending')}>{columns.map(({ ref, compared }) => { const { status, by } = runStatus(ref.run);
            return <TableCell key={ref.run.id} className="whitespace-normal">
              {compared?.result ? <StatusMark status={status} why={stopReason(t, by)} className="whitespace-normal" /> : <span className="text-ink-2">{t('runCompare.noResult')}</span>}
              {compared && !compared.result && <span className="block text-sm text-ink-2">{t('runCompare.noResultWhy')}</span>}
            </TableCell>; })}</Row>
          <Row label={t('runCompare.rows.moves')}>{columns.map(({ ref, compared }) => <TableCell key={ref.run.id} className="tabular-nums">{moves(compared, compared?.result?.steps)}</TableCell>)}</Row>
          <Row label={t('runCompare.rows.stretch')}>{columns.map(({ ref, compared }) => <TableCell key={ref.run.id} className="tabular-nums">{moves(compared, compared?.result?.stretch)}</TableCell>)}</Row>
          <Row label={t('runCompare.rows.wrongGuesses')}>{columns.map(({ ref, compared }) => <TableCell key={ref.run.id} className="tabular-nums">
            {compared?.result ? t('taskPage.results.guesses', { n: compared.result.wrongGuesses }) : <Dash />}</TableCell>)}</Row>
          <Row label={t('runCompare.rows.stuck')}>{columns.map(({ ref, compared }) => <TableCell key={ref.run.id} className="whitespace-normal">
            {!compared?.result || compared.stuck.length === 0 ? <Dash />
              : <ul className="grid gap-1">{firstSteps(compared).map(item => <li key={`${item.label}`}>
                <Link to={{ task: ref.run.taskId, run: ref.run.id, step: item.step }} navigate={navigate} title={t('runCompare.openAt', { step: item.step })} className={link}>{item.label}</Link>
              </li>)}</ul>}
          </TableCell>)}</Row>
          <Row label={t('runCompare.rows.open')}>{columns.map(({ ref }) => <TableCell key={ref.run.id}>
            <Link to={{ task: ref.run.taskId, run: ref.run.id }} navigate={navigate} className={link}>{t('runCompare.open')}<span className="sr-only"> {t('runCompare.runName', { n: numbers.get(ref.run.id) ?? '—' })}</span></Link>
          </TableCell>)}</Row>
        </TableBody>
      </Table>
    </>}
  </>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <TableRow className="align-top hover:bg-transparent"><TableHead scope="row" className="h-auto py-2.5 whitespace-normal">{label}</TableHead>{children}</TableRow>;
}

/** A number of moves in words; a dash when the run has no result or no such number. */
function moves(compared: ComparedRun | undefined, value: number | null | undefined) {
  if (!compared?.result) return <Dash />;
  return value === null || value === undefined ? <Dash /> : <MoveCount n={value} />;
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
