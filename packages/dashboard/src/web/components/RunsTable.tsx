import { useTranslation } from 'react-i18next';
import { useHintSummaries, useRequestHintSummaries } from '../hooks/useHintSummaries';
import type { RouteChange } from '../hooks/useRoute';
import { formatDate } from '../lib/format';
import { isFinished, runProfileName, runStartedAt, runStepCount, durationSeconds, type RunRef } from '../lib/runs';
import { HintBadge } from './HintBadge';
import { Link } from './Link';
import { RunStateLabel } from './RunStateLabel';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Props = {
  runs: RunRef[]; profiles: { id: string; name: string }[]; navigate: (change: RouteChange) => void;
  /** Adds the start time and duration columns of the full run history. */
  detailed?: boolean;
  /** Leaves out the task column, for a table of one task's runs. */
  hideTask?: boolean;
  /** "Run #n" of each run by id; adds a column with the number. */
  numbers?: ReadonlyMap<string, number>;
};

/** Dense table of runs: task, conditions, result, action count and the friction hints worth a look. */
export function RunsTable({ runs, profiles, navigate, detailed, hideTask, numbers }: Props) {
  const { t } = useTranslation();
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })));
  return <div className="overflow-x-auto rounded-lg border">
    <Table>
      <TableCaption className="sr-only">{t('runList.caption')}</TableCaption>
      <TableHeader><TableRow className="h-9 text-xs">
        {numbers && <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.number')}</TableHead>}
        {detailed && <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.started')}</TableHead>}
        {!hideTask && <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.task')}</TableHead>}
        <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.condition')}</TableHead>
        <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.result')}</TableHead>
        <TableHead scope="col" className="px-3 text-right text-muted-foreground">{t('runList.columns.steps')}</TableHead>
        {detailed && <TableHead scope="col" className="px-3 text-right text-muted-foreground">{t('runList.columns.duration')}</TableHead>}
        <TableHead scope="col" className="px-3 text-muted-foreground">{t('runList.columns.hints')}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{runs.map(ref => {
        const { run } = ref, steps = runStepCount(run), seconds = durationSeconds(run), hints = hintsFor(run.id) ?? [];
        return <TableRow key={run.id} className="h-10">
          {numbers && <TableCell className="px-3 tabular-nums"><Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="rounded-sm text-primary underline-offset-2 hover:underline">#{numbers.get(run.id) ?? '—'}</Link></TableCell>}
          {detailed && <TableCell className="px-3 text-xs tabular-nums text-muted-foreground">{formatDate(runStartedAt(ref))}</TableCell>}
          {!hideTask && <TableCell className="px-3 font-medium">
            <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="rounded-sm hover:underline">{run.snapshot.taskName}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Link>
          </TableCell>}
          <TableCell className="px-3 text-muted-foreground">{run.snapshot.model.name} · {runProfileName(profiles, run)}</TableCell>
          <TableCell className="px-3"><RunStateLabel state={run.state} /></TableCell>
          <TableCell className="px-3 text-right tabular-nums">{steps ?? '—'}</TableCell>
          {detailed && <TableCell className="px-3 text-right tabular-nums text-muted-foreground">{seconds === undefined ? '—' : t('run.duration', { seconds: seconds.toFixed(1) })}</TableCell>}
          <TableCell className="px-3">{hints.length
            ? <span className="flex flex-wrap gap-1">{hints.slice(0, 2).map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}</span>
            : <span className="text-muted-foreground">{isFinished(run) && hintsFor(run.id) ? t('runList.noHints') : '—'}</span>}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
