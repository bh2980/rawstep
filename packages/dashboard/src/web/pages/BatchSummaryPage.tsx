import { useId, useMemo } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { compareSummaries, type SummaryCell, type SummaryComparison } from '@rawstep/reports/compare';
import type { Experiment } from '../../shared/config';
import { CliMark, startedFromCli } from '../components/CliMark';
import { EmptyState } from '../components/layout/EmptyState';
import { ErrorState } from '../components/layout/ErrorState';
import { Dash, PageHeader, SectionHead } from '../components/PageHeader';
import { Link } from '../components/Link';
import { StatusMark } from '../components/StatusMark';
import { Time } from '../components/Time';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { useBatchSummary } from '../hooks/useBatchSummary';
import type { RouteChange } from '../hooks/useRoute';
import { serverText } from '../i18n';
import { MAX_COMPARE, differingParts } from '../lib/compare';
import { dataFailureView } from '../lib/errors';
import { batchesNewestFirst, cellFacts, comparisonCell, describeCellChange, exportName, noChangeText, stuckText, summaryCsv } from '../lib/batchSummary';
import { downloadText } from '../lib/download';
import { countOf, formatSteps } from '../lib/format';
import { isLive, type RunRef } from '../lib/runs';
import type { PageProps } from './types';

type Props = { pageProps: PageProps; experiments: readonly Experiment[]; runs: readonly RunRef[]; batchId: string; against: string | undefined; navigate: (change: RouteChange) => void };

const NONE = '__none__';
const link = 'text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground';

/**
 * One batch summed up per task and run profile: how the runs ended, what reaching the goal cost, the stuck places and how many page
 * findings came up, with a link to the runs behind each row. Another batch can be picked as the baseline; the table then adds what
 * changed beyond the spread between repeats. Counts only: it never says which side is better. The summary can be downloaded as the
 * JSON a CLI baseline reads, or as a CSV.
 */
export function BatchSummaryPage({ pageProps, experiments, runs, batchId, against, navigate }: Props) {
  const { t } = useTranslation();
  const pickId = useId();
  const experiment = experiments.find(item => item.id === batchId);
  const summary = useBatchSummary(batchId), baseline = useBatchSummary(against);
  const comparison = useMemo<SummaryComparison | undefined>(() => summary.data && baseline.data && baseline.data.batch.id === against ? compareSummaries(baseline.data, summary.data) : undefined, [summary.data, baseline.data, against]);
  const others = useMemo(() => batchesNewestFirst(experiments, batchId), [experiments, batchId]);
  const crumbs = [{ label: t('runList.title'), to: { view: 'runs' as const } }];
  const open = (change: RouteChange) => navigate({ view: 'runs', batch: batchId, ...change });

  if (summary.missing || (!experiment && !summary.data && !summary.loading)) return <>
    <PageHeader title={t('batchSummary.title')} crumbs={crumbs} navigate={navigate} />
    <EmptyState title={t('batchSummary.notFound')} action={<Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>} />
  </>;

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
  const counts = experiment && t('batchSummary.counts', {
    tasks: t('batchSummary.tasks', { count: new Set(experiment.runs.map(run => run.taskId)).size }),
    profiles: t('batchSummary.profiles', { count: new Set(experiment.runs.map(run => run.profileId)).size }),
    runs: t('batchSummary.runs', { count: experiment.runs.length }),
  });
  return <>
    <PageHeader title={<span className="truncate">{experiment?.request.note || t('batchSummary.title')}</span>} crumbs={crumbs} navigate={navigate}
      meta={experiment ? [<Time value={experiment.createdAt} className="tabular-nums" />, counts, t('batchSummary.repeats', { count: experiment.request.repeats }), startedFromCli(experiment) && <CliMark className="ml-0" />] : []}
      actions={<div role="group" aria-label={t('batchSummary.export.label')} className="flex items-center gap-2">
        <Button variant="outline" disabled={!data} aria-label={t('batchSummary.export.json')} onClick={() => download('json')}><Download aria-hidden="true" />JSON</Button>
        <Button variant="outline" disabled={!data} aria-label={t('batchSummary.export.csv')} onClick={() => download('csv')}><Download aria-hidden="true" />CSV</Button>
      </div>} />
    {others.length > 0 && <div className="mb-3 grid gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={pickId} className="w-24 font-medium text-ink-2">{t('batchSummary.compare.pick')}</label>
        <Select value={against ?? NONE} onValueChange={value => open({ against: value === NONE ? undefined : value })}>
          <SelectTrigger id={pickId} className="w-full max-w-110 justify-between"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('batchSummary.compare.none')}</SelectItem>
            {others.map(item => <SelectItem key={item.id} value={item.id}>
              <Time value={item.createdAt} className="tabular-nums" />
              <span className="truncate text-ink-2">{item.request.note || t('runList.group.noNote')}</span>
            </SelectItem>)}
          </SelectContent>
        </Select>
        <p className="ml-auto text-ink-2">{t('batchSummary.compare.note')}</p>
      </div>
      {comparison && <p className={differing.length ? 'text-foreground' : 'text-ink-2'}>
        {differing.length ? t('taskPage.batch.conditionsDiffer', { parts: differing.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') }) : t('taskPage.batch.conditionsSame')}</p>}
    </div>}
    {summary.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-8" /><Skeleton className="h-32" /></div>}
    {summary.waiting && <p role="status" className="py-2 text-ink-2">{serverText({ code: 'summary-not-ready' })}</p>}
    {summary.error && !data && <ErrorState view={dataFailureView(t('batchSummary.failed'), summary.error)} />}
    {against && baseline.loading && !baseline.data && <p role="status" className="py-1 text-sm text-ink-2">{t('batchSummary.compare.loading')}</p>}
    {against && (baseline.error || baseline.missing || baseline.waiting) && !baseline.data && <ErrorState view={dataFailureView(t('batchSummary.compare.failed'), baseline.error || (baseline.waiting ? serverText({ code: 'summary-not-ready' }) : undefined))} />}
    {data && (data.cells.length === 0
      ? <EmptyState title={t('batchSummary.empty')} />
      : <Table className="min-w-4xl table-fixed">
        <TableCaption className="sr-only">{t('batchSummary.caption')}</TableCaption>
        <colgroup>
          <col />
          <col className="w-38" />
          <col className="w-34" />
          <col className="w-46" />
          <col className="w-20" />
          {comparison && <col className="w-72" />}
          <col className="w-28" />
        </colgroup>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead scope="col">{t('batchSummary.columns.taskProfile')}</TableHead>
          <TableHead scope="col">{t('batchSummary.columns.result')}</TableHead>
          <TableHead scope="col">{t('batchSummary.columns.cost')}</TableHead>
          <TableHead scope="col">{t('batchSummary.columns.stuck')}</TableHead>
          <TableHead scope="col" className="text-right">{t('batchSummary.columns.findings')}</TableHead>
          {comparison && <TableHead scope="col">{t('batchSummary.columns.change')}</TableHead>}
          <TableHead scope="col" className="text-right"><span className="sr-only">{t('batchSummary.columns.runs')}</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{data.cells.map(item => <Row key={`${item.taskId}\u0000${item.profileId}`} cell={item} runs={runs} batchId={batchId} comparison={comparison} navigate={navigate} />)}</TableBody>
      </Table>)}
    {gone.length > 0 && <section aria-labelledby="batch-only-base" className="mt-6">
      <SectionHead id="batch-only-base" title={t('batchSummary.compare.onlyBase')} count={gone.length} />
      <ul className="border-t border-edge">{gone.map(item => <li key={`${item.taskId}\u0000${item.profileId}`} className="flex h-10 items-center border-b border-edge px-3">
        {t('batchSummary.compare.onlyBaseItem', { task: item.taskName, profile: item.profileName })}</li>)}</ul>
    </section>}
  </>;
}

/** The ending to draw for a row: reaching the goal when any run did, otherwise the most common other ending. */
const ENDINGS = ['reached', 'gave-up', 'mistaken', 'unmeasured', 'error'] as const;

function Row({ cell: item, runs, batchId, comparison, navigate }: { cell: SummaryCell; runs: readonly RunRef[]; batchId: string; comparison: SummaryComparison | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const f = cellFacts(item), compared = comparison && comparisonCell(comparison, item), change = compared && describeCellChange(compared);
  // The runs behind the row, oldest first. One opens itself, several open side by side (when they fit), more open the task.
  const mine = runs.filter(ref => ref.experiment.id === batchId && ref.run.taskId === item.taskId && ref.run.profileId === item.profileId && !isLive(ref.run)).reverse();
  const to: RouteChange = mine.length === 1 ? { task: item.taskId, run: mine[0]!.run.id } : mine.length <= MAX_COMPARE ? { view: 'runs', compare: mine.map(ref => ref.run.id) } : { task: item.taskId };
  const other = ENDINGS.filter((key): key is Exclude<typeof key, 'reached'> => key !== 'reached').sort((a, b) => item.endings[b] - item.endings[a])[0]!;
  const lead = f.reached > 0 ? 'reached' : other;
  const leadLabel = f.reached > 0 ? t('batchSummary.reached', { reached: f.reached, n: f.measured }) : t(`batchSummary.others.${other}`, { count: item.endings[other] });
  const rest = ENDINGS.filter((key): key is Exclude<typeof key, 'reached'> => key !== 'reached' && key !== lead && item.endings[key] > 0).map(key => t(`batchSummary.others.${key}`, { count: item.endings[key] }));
  const stuck = item.stuck.map(place => stuckText(item, place));
  const sentences = change?.status === 'changed' ? change.sentences.join(' ') : undefined;
  return <TableRow>
    <TableHead scope="row" className="h-13 py-1.5 text-base font-normal text-foreground">
      <span className="block truncate font-medium">{item.taskName}</span>
      <span className="block truncate text-sm text-ink-2">{item.profileName}</span>
    </TableHead>
    <TableCell className="h-13">
      {item.runs === 0 ? <Dash /> : <StatusMark status={lead} label={leadLabel} />}
      {rest.length > 0 && <span className="block truncate text-sm text-ink-2">{rest.join(' · ')}</span>}
    </TableCell>
    <TableCell className="h-13 truncate tabular-nums">{f.median === null ? <Dash />
      : <>{t('batchSummary.costMedian', { n: formatSteps(f.median), ...countOf(f.median) })}{f.min !== f.max && <span className="text-ink-2"> · {t('taskPage.results.costRange', { min: f.min ?? 0, max: f.max ?? 0 })}</span>}</>}</TableCell>
    <TableCell className="h-13" title={stuck.join('\n') || undefined}>{stuck.length === 0 ? <Dash />
      : <>
        <span className="block truncate">{stuck[0]}</span>
        {stuck.length > 1 && <span className="block truncate text-sm text-ink-2">{t('batchSummary.stuckMore', { count: stuck.length - 1 })}</span>}
      </>}</TableCell>
    <TableCell className="h-13 text-right tabular-nums">{item.pageFindings.length || <Dash />}</TableCell>
    {comparison && <TableCell className="h-13 whitespace-normal" title={sentences}>{!change ? <Dash /> : change.status === 'changed'
      ? sentences ? <span className="line-clamp-2">{sentences}</span> : <Dash />
      : <span className="text-ink-2">{noChangeText(change.status)}</span>}</TableCell>}
    <TableCell className="h-13 text-right">{mine.length === 0 ? <Dash />
      : <Link to={to} navigate={navigate} aria-label={t('batchSummary.runsLinkLabel', { task: item.taskName, profile: item.profileName, count: mine.length })} className={link}>{t('batchSummary.runsLink', { count: mine.length })}</Link>}</TableCell>
  </TableRow>;
}
