import { Inbox } from 'lucide-react';
import type { OverviewRow } from '../../shared/api';
import { ko } from '../i18n/ko';
import type { RunRef } from '../lib/runs';
import type { RouteChange } from '../hooks/useRoute';
import { Button } from './ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { HintBadge } from './HintBadge';

type Props = { rows: OverviewRow[]; runs: RunRef[]; error: string; navigate: (change: RouteChange) => void };

const number = (value: number | null) => value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Task × model summary. Each row links into the tree: the task, or its newest run. */
export function OverviewTable({ rows, runs, error, navigate }: Props) {
  const c = ko.overview.columns;
  const latest = (row: OverviewRow) => runs.find(ref => ref.run.taskId === row.taskId && ref.run.modelId === row.modelId && ref.run.snapshot.mode === row.mode);
  return <section aria-labelledby="overview-title" className="grid gap-6">
    <div>
      <h1 id="overview-title" className="text-2xl font-semibold tracking-tight">{ko.overview.title}</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{ko.overview.description}</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{ko.overview.loadFailed} {error}</p>}
    {rows.length === 0
      ? <div className="grid place-content-center gap-3 rounded-lg border border-dashed py-20 text-center">
        <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{ko.overview.empty}</p>
        <p className="text-sm text-muted-foreground">{ko.overview.emptyHint}</p>
      </div>
      : <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption>{ko.overview.caption}</TableCaption>
          <TableHeader><TableRow>
            <TableHead>{c.task}</TableHead><TableHead>{c.model}</TableHead><TableHead>{c.mode}</TableHead>
            <TableHead className="text-right">{c.runs}</TableHead><TableHead className="text-right">{c.reached}</TableHead>
            <TableHead className="text-right">{c.median}</TableHead>
            <TableHead className="text-right" title={ko.overview.referenceHelp}>{c.reference}</TableHead>
            <TableHead>{c.hints}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(row => {
            const newest = latest(row);
            return <TableRow key={`${row.taskId}|${row.modelId}|${row.mode}`}>
              <TableCell className="font-medium">
                <Button variant="link" className="h-auto p-0 whitespace-normal text-left" onClick={() => navigate({ task: row.taskId })}>{row.taskName}</Button>
                {newest && <Button variant="ghost" size="xs" className="mt-1 block" onClick={() => navigate({ task: row.taskId, run: newest.run.id })}>{ko.overview.openLatest}</Button>}
              </TableCell>
              <TableCell>{row.modelName}</TableCell>
              <TableCell>{ko.sidebar.modes[row.mode]}</TableCell>
              <TableCell className="text-right tabular-nums">{ko.overview.runsOf(row.finished, row.runs)}</TableCell>
              <TableCell className="text-right tabular-nums">{ko.overview.reachedOf(row.goalReached, row.finished)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(row.medianSteps)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(row.referenceSteps)}</TableCell>
              <TableCell>{row.topHints.length
                ? <div className="flex flex-wrap gap-1">{row.topHints.map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}</div>
                : <span className="text-muted-foreground">{ko.overview.noHints}</span>}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
  </section>;
}
