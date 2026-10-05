import { GitCompare } from 'lucide-react';
import type { RunHintsView, StepView } from '../../shared/api';
import { ko } from '../i18n/ko';
import { describeStep } from '../lib/describe';
import { cn } from '../lib/utils';
import { useRunSteps } from '../hooks/useRunData';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { HintBadge } from './HintBadge';
import { ScreenshotThumb } from './ScreenshotThumb';

type Props = {
  experimentId: string; runId: string; steps: StepView[] | undefined;
  hints: RunHintsView | undefined; onOpenRun: (runId: string) => void;
};

/** This run next to the shortest goal-reaching run of the same task and mode, aligned by step number. */
export function RunCompare({ experimentId, runId, steps, hints, onOpenRun }: Props) {
  const reference = hints?.referenceRun;
  if (!reference) return <div className="grid place-content-center gap-2 rounded-lg border border-dashed py-14 text-center">
    <GitCompare className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
    <p className="font-medium">{ko.compare.none}</p>
    <p className="max-w-lg text-sm text-muted-foreground">{ko.compare.noneBody}</p>
  </div>;
  return <CompareTable experimentId={experimentId} runId={runId} steps={steps ?? []} reference={reference} onOpenRun={onOpenRun} />;
}

type TableProps = {
  experimentId: string; runId: string; steps: StepView[];
  reference: { experimentId: string; runId: string }; onOpenRun: (runId: string) => void;
};

function firstDivergence(mine: Map<number, StepView>, theirs: Map<number, StepView>, last: number): number | undefined {
  for (let n = 1; n <= last; n++) {
    const a = mine.get(n), b = theirs.get(n);
    if (!a || !b || describeStep(a) !== describeStep(b)) return n;
  }
  return undefined;
}

function CompareTable({ experimentId, runId, steps, reference, onOpenRun }: TableProps) {
  const other = useRunSteps(reference.experimentId, reference.runId);
  if (other.loading && !other.data) return <div aria-busy="true" role="status" className="grid gap-3"><p className="text-sm text-muted-foreground">{ko.compare.loading}</p><Skeleton className="h-24" /></div>;
  if (!other.data) return <p role="alert" className="text-sm text-muted-foreground">{ko.compare.loadFailed} {other.error}</p>;
  const mine = new Map(steps.map(step => [step.step, step])), theirs = new Map(other.data.steps.map(step => [step.step, step]));
  const last = Math.max(0, ...mine.keys(), ...theirs.keys());
  const diverged = firstDivergence(mine, theirs, last);
  const numbers = Array.from({ length: last + 1 }, (_, n) => n);
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-medium">{ko.compare.title}</h3>
        <p className="text-sm text-muted-foreground">{ko.compare.description}</p>
        <p className="mt-1 text-sm" role="status">{diverged === undefined ? ko.compare.identical : ko.compare.divergedAt(diverged)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => onOpenRun(reference.runId)}>{ko.compare.openReference}</Button>
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableCaption>{ko.compare.caption}</TableCaption>
        <TableHeader><TableRow>
          <TableHead className="w-20">{ko.compare.stepColumn}</TableHead>
          <TableHead>{ko.compare.thisRun} · {ko.compare.stepCount(steps.filter(s => s.step > 0).length)}</TableHead>
          <TableHead>{ko.compare.referenceRun} · {ko.compare.stepCount(other.data.steps.filter(s => s.step > 0).length)}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{numbers.map(n => <TableRow key={n} id={`compare-${n}`} className={cn(n === diverged && 'bg-muted ring-2 ring-inset ring-ring')}>
          <TableCell className="align-top tabular-nums">
            {n === 0 ? ko.steps.start : n}
            {n === diverged && <Badge variant="default" className="mt-1 block w-fit">{ko.compare.diverged}</Badge>}
          </TableCell>
          <CompareCell step={mine.get(n)} experimentId={experimentId} runId={runId} />
          <CompareCell step={theirs.get(n)} experimentId={reference.experimentId} runId={reference.runId} />
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </div>;
}

function CompareCell({ step, experimentId, runId }: { step: StepView | undefined; experimentId: string; runId: string }) {
  if (!step) return <TableCell className="align-top text-muted-foreground">{ko.compare.missing}</TableCell>;
  return <TableCell className="align-top whitespace-normal">
    <div className="flex items-start gap-3">
      {step.screenshot && !step.redacted && <ScreenshotThumb experimentId={experimentId} runId={runId} eventId={step.screenshot.eventId} step={step.step} className="h-14 w-24 shrink-0" />}
      <div className="grid gap-1">
        <span className="text-sm">{describeStep(step)}</span>
        {step.hints.length > 0 && <span className="flex flex-wrap gap-1">{step.hints.map(kind => <HintBadge key={kind} kind={kind} />)}</span>}
      </div>
    </div>
  </TableCell>;
}
