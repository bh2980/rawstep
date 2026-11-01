import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { compareSummaries, type SummaryCell, type SummaryComparison } from '@rawstep/reports/compare';
import type { Experiment } from '../../shared/config';
import { batchLabel } from '../components/BatchCompare';
import { CliMark, startedFromCli } from '../components/CliMark';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { FilterSelect } from '../components/layout/FilterBar';
import { InfoTip } from '../components/layout/InfoTip';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useBatchSummary } from '../hooks/useBatchSummary';
import type { RouteChange } from '../hooks/useRoute';
import { serverText } from '../i18n';
import { MAX_COMPARE, differingParts } from '../lib/compare';
import { dataFailureView } from '../lib/errors';
import { batchesNewestFirst, cellFacts, comparisonCell, describeCellChange, experimentBatch, exportName, noChangeText, stuckText, summaryCsv } from '../lib/batchSummary';
import { downloadText } from '../lib/download';
import { countOf, formatDate, formatSteps } from '../lib/format';
import { isLive, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = { pageProps: PageProps; experiments: readonly Experiment[]; runs: readonly RunRef[]; batchId: string; against: string | undefined; navigate: (change: RouteChange) => void };

const NONE = '__none__';
const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-2.5 align-top text-[13px] whitespace-normal';

/**
 * One batch summed up per task and run profile: how the runs ended, what reaching the goal cost, the stuck places and how many page
 * findings came up, with a link to the runs behind each row. Another batch can be picked as the baseline; the table then adds what
 * changed beyond the spread between repeats. Counts only: it never says which side is better. The summary can be downloaded as the
 * JSON a CLI baseline reads, or as a CSV.
 */
export function BatchSummaryPage({ pageProps, experiments, runs, batchId, against, navigate }: Props) {
  const { t } = useTranslation();
  const experiment = experiments.find(item => item.id === batchId);
  const summary = useBatchSummary(batchId), baseline = useBatchSummary(against);
  const comparison = useMemo<SummaryComparison | undefined>(() => summary.data && baseline.data && baseline.data.batch.id === against ? compareSummaries(baseline.data, summary.data) : undefined, [summary.data, baseline.data, against]);
  const others = useMemo(() => batchesNewestFirst(experiments, batchId), [experiments, batchId]);
  const back = <Link to={{ view: 'runs' }} navigate={navigate} className="text-sm text-muted-foreground underline-offset-2 hover:underline">← {t('run.backToRuns')}</Link>;
  const open = (change: RouteChange) => navigate({ view: 'runs', batch: batchId, ...change });

  if (summary.missing || (!experiment && !summary.data && !summary.loading)) return <div className="grid gap-4">
    <PageHeader title={t('batchSummary.title')} crumb={back} />
    <EmptyState title={t('batchSummary.notFound')} action={<Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>} />
  </div>;

  const data = summary.data;
  const download = (kind: 'json' | 'csv') => {
    if (!data) return;
    const name = exportName('rawstep-summary', data.batch.createdAt, kind);
    downloadText(name, kind === 'json' ? JSON.stringify(data, null, 2) + '\n' : summaryCsv(data), kind === 'json' ? 'application/json' : 'text/csv');
    pageProps.notify(t('batchSummary.export.done', { name }));
  };
  const baseBatch = others.find(item => item.id === against);
  const differing = experiment && baseBatch ? differingParts(baseBatch.runs, experiment.runs) : [];
  const gone = comparison?.cells.filter(item => !item.head) ?? [];
  return <div className="grid gap-4">
    <PageHeader title={t('batchSummary.title')} crumb={back}
      meta={experiment && <span className="flex flex-wrap items-center gap-x-2">
        <span className="font-mono tabular-nums">{formatDate(Date.parse(experiment.createdAt))}</span>
        {experiment.request.note && <span>· {experiment.request.note}</span>}
        <span>· {t('batchSummary.runs', { count: experiment.runs.length })}</span>
        {startedFromCli(experiment) && <CliMark />}
      </span>}
      actions={<div role="group" aria-label={t('batchSummary.export.label')} className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!data} onClick={() => download('json')}><Download aria-hidden="true" />{t('batchSummary.export.json')}</Button>
        <Button variant="outline" disabled={!data} onClick={() => download('csv')}><Download aria-hidden="true" />{t('batchSummary.export.csv')}</Button>
      </div>} />
    {others.length > 0 && <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FilterSelect label={t('batchSummary.compare.pick')} value={against ?? NONE} onChange={value => open({ against: value === NONE ? undefined : value })} className="max-w-md"
          options={[{ id: NONE, name: t('batchSummary.compare.none') }, ...others.map(item => ({ id: item.id, name: batchLabel(experimentBatch(item), t) }))]} />
      </div>
      {against && <div className="grid gap-1 text-xs text-muted-foreground">
        <p>{t('batchSummary.compare.note')}</p>
        {comparison && <p className={differing.length ? 'text-inspect' : undefined}>
          {differing.length ? t('taskPage.batch.conditionsDiffer', { parts: differing.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') }) : t('taskPage.batch.conditionsSame')}</p>}
      </div>}
    </div>}
    {summary.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-8" /><Skeleton className="h-32" /></div>}
    {summary.waiting && <p role="status" className="border-l-2 border-edge-strong pl-4 text-sm text-muted-foreground">{serverText({ code: 'summary-not-ready' })}</p>}
    {summary.error && !data && <ErrorState view={dataFailureView(t('batchSummary.failed'), summary.error)} />}
    {against && baseline.loading && !baseline.data && <p role="status" className="text-xs text-muted-foreground">{t('batchSummary.compare.loading')}</p>}
    {against && (baseline.error || baseline.missing || baseline.waiting) && !baseline.data && <ErrorState view={dataFailureView(t('batchSummary.compare.failed'), baseline.error || (baseline.waiting ? serverText({ code: 'summary-not-ready' }) : undefined))} />}
    {data && (data.cells.length === 0
      ? <EmptyState title={t('batchSummary.empty')} />
      : <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <Table>
          <TableCaption className="sr-only">{t('batchSummary.caption')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head}>{t('batchSummary.columns.task')}</TableHead>
            <TableHead scope="col" className={head}>{t('batchSummary.columns.profile')}</TableHead>
            <TableHead scope="col" className={head}>{t('batchSummary.columns.result')}</TableHead>
            <TableHead scope="col" className={head}>{t('batchSummary.columns.cost')}</TableHead>
            <TableHead scope="col" className={head}>{t('batchSummary.columns.stuck')}<InfoTip term={t('batchSummary.columns.stuck')}>{t('batchSummary.stuckInfo')}</InfoTip></TableHead>
            <TableHead scope="col" className={head + ' text-right'}>{t('batchSummary.columns.findings')}</TableHead>
            {comparison && <TableHead scope="col" className={head}>{t('batchSummary.columns.change')}</TableHead>}
            <TableHead scope="col" className={head}>{t('batchSummary.columns.runs')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.cells.map(item => <Row key={`${item.taskId}\u0000${item.profileId}`} cell={item} runs={runs} batchId={batchId} comparison={comparison} navigate={navigate} />)}</TableBody>
        </Table>
      </div>)}
    {gone.length > 0 && <section aria-label={t('batchSummary.compare.onlyBase')} className="grid gap-1 text-[13px]">
      <h2 className="text-xs font-medium text-muted-foreground">{t('batchSummary.compare.onlyBase')}</h2>
      <ul className="grid gap-0.5">{gone.map(item => <li key={`${item.taskId}\u0000${item.profileId}`}>{t('batchSummary.compare.onlyBaseItem', { task: item.taskName, profile: item.profileName })}</li>)}</ul>
    </section>}
  </div>;
}

function Row({ cell: item, runs, batchId, comparison, navigate }: { cell: SummaryCell; runs: readonly RunRef[]; batchId: string; comparison: SummaryComparison | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const f = cellFacts(item), compared = comparison && comparisonCell(comparison, item), change = compared && describeCellChange(compared);
  // The runs behind the row, oldest first. One opens itself, several open side by side (when they fit), more open the task.
  const mine = runs.filter(ref => ref.experiment.id === batchId && ref.run.taskId === item.taskId && ref.run.profileId === item.profileId && !isLive(ref.run)).reverse();
  const to: RouteChange = mine.length === 1 ? { task: item.taskId, run: mine[0]!.run.id } : mine.length <= MAX_COMPARE ? { view: 'runs', compare: mine.map(ref => ref.run.id) } : { task: item.taskId };
  const others = (['gave-up', 'mistaken', 'unmeasured', 'error'] as const).map(key => ({ key, count: item.endings[key] })).filter(entry => entry.count > 0);
  return <TableRow className="align-top">
    <TableHead scope="row" className={cell + ' h-auto font-medium text-foreground'}>{item.taskName}</TableHead>
    <TableCell className={cell}>{item.profileName}</TableCell>
    <TableCell className={cell}>
      <span className="block tabular-nums">{f.measured > 0 ? t('batchSummary.reached', { reached: f.reached, n: f.measured }) : t('batchSummary.nothingMeasured')}</span>
      {others.length > 0 && <span className="block text-xs text-muted-foreground">{others.map(entry => t(`batchSummary.others.${entry.key}`, { count: entry.count })).join(' · ')}</span>}
    </TableCell>
    <TableCell className={cell + ' tabular-nums'}>{f.median === null ? <span className="text-muted-foreground">{t('taskPage.results.costNone')}</span>
      : <>{t('batchSummary.costMedian', { n: formatSteps(f.median), ...countOf(f.median) })}{f.min !== f.max && <span className="block text-xs text-muted-foreground">{t('taskPage.results.costRange', { min: f.min ?? 0, max: f.max ?? 0 })}</span>}</>}</TableCell>
    <TableCell className={cell}>{item.stuck.length === 0 ? <span className="text-muted-foreground">{t('taskPage.results.none')}</span>
      : <ul className="grid gap-1">{item.stuck.map(place => <li key={`${place.role}\u0000${place.name ?? ''}`}>{stuckText(item, place)}</li>)}</ul>}</TableCell>
    <TableCell className={cell + ' text-right tabular-nums'}>{t('batchSummary.findingsCount', { count: item.pageFindings.length })}</TableCell>
    {comparison && <TableCell className={cell}>{!change ? '—' : change.status === 'changed'
      ? <ul className="grid gap-1">{change.sentences.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
      : <span className="text-muted-foreground">{noChangeText(change.status)}</span>}</TableCell>}
    <TableCell className={cell}>{mine.length === 0 ? '—'
      : <Link to={to} navigate={navigate} aria-label={t('batchSummary.runsLinkLabel', { task: item.taskName, profile: item.profileName, count: mine.length })} className="text-trace underline underline-offset-2">{t('batchSummary.runsLink', { count: mine.length })}</Link>}</TableCell>
  </TableRow>;
}
